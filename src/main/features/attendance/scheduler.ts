// 출퇴근 리마인더 스케줄러 — 메인 프로세스에서 매 30초 현재 시각을 확인해,
// 설정된 요일·시각이 되면 근태 상태를 조회(스마트 스킵)한 뒤 알림(알럿)을 띄운다.
// 반복 알림이 켜져 있으면 설정 시각 이후 안 찍은 동안 N분 간격으로 재알림한다.
// 창을 닫아도(맥) 앱 프로세스가 살아 있는 한 동작한다.
import { runAttendance } from './attend';
import { getReminderConfig } from './reminders';
import { getCredentials } from '../settings/store';
import { notify } from '../notify/notify';

let timer: ReturnType<typeof setInterval> | null = null;

// 하루 단위 상태 — 날짜가 바뀌면 초기화한다. key = `${dateKey}-${day}-${type}`
const lastAttempt = new Map<string, number>(); // 마지막 시도 시각(분) — 반복 간격 판정
const doneToday = new Set<string>(); // 찍은 게 확인됨 → 오늘은 더 안 봄
const failSafeFired = new Set<string>(); // 상태 확인 실패 알림은 하루 1회만
const alertOpen = new Set<'come' | 'leave'>(); // 알럿이 떠 있는 동안 반복 억제
let stateDate = '';

const toMinutes = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

const nowMinutes = (d: Date) => d.getHours() * 60 + d.getMinutes();

const localDateKey = (d: Date) =>
  `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

async function handleReminder(type: 'come' | 'leave', key: string) {
  // 스마트 스킵 — 이미 찍었으면 알림하지 않는다. 상태 확인이 실패하면(계정 없음·VPN 등)
  // 놓치는 것보다 낫도록 알림을 띄운다 (단, 실패 알림은 하루 1회 — 반복 소음 방지).
  const cred = getCredentials();
  let info: Awaited<ReturnType<typeof runAttendance>> | null = null;
  let checkFailed = false;
  if (cred) {
    try {
      info = await runAttendance('status', cred);
    } catch {
      checkFailed = true;
    }
  } else {
    checkFailed = true;
  }

  if (type === 'come') {
    if (info?.comeTime) {
      console.log('[reminder] 출근 알림 건너뜀 (이미 출근:', info.comeTime, ')');
      doneToday.add(key);
      return; // 이미 출근함
    }
  } else {
    if (info?.leaveTime) {
      console.log('[reminder] 퇴근 알림 건너뜀 (이미 퇴근:', info.leaveTime, ')');
      doneToday.add(key);
      return; // 이미 퇴근함
    }
    if (!checkFailed && !info?.comeTime) {
      console.log('[reminder] 퇴근 알림 건너뜀 (출근 기록 없음)');
      doneToday.add(key);
      return; // 출근 기록이 없으면(휴무 등) 퇴근 알림 생략
    }
  }

  if (checkFailed) {
    if (failSafeFired.has(key)) return;
    failSafeFired.add(key);
  }

  const label = type === 'come' ? '출근' : '퇴근';
  console.log(`[reminder] ${label} 알림 발화`, checkFailed ? '(상태 확인 실패)' : '');
  alertOpen.add(type);
  try {
    await notify({
      title: type === 'come' ? '🕘 출근 체크' : '🕕 퇴근 체크',
      body: checkFailed
        ? `${label} 찍는 것을 잊지 마세요.`
        : `아직 ${label}을 안 찍었어요 — 사이드바 근태 위젯에서 ${label}을 눌러주세요.`,
    });
  } finally {
    // 반복 간격은 알럿을 닫은 시점부터 다시 센다 (방치 중 중복 알럿 방지)
    alertOpen.delete(type);
    lastAttempt.set(key, nowMinutes(new Date()));
  }
}

function tick() {
  const now = new Date();
  const dateKey = localDateKey(now);
  if (dateKey !== stateDate) {
    lastAttempt.clear();
    doneToday.clear();
    failSafeFired.clear();
    stateDate = dateKey;
  }

  const day = now.getDay(); // 0=일 … 6=토
  if (day < 1 || day > 5) return; // 주말 제외

  const nowMin = nowMinutes(now);
  const config = getReminderConfig();
  const dayCfg = config.days.find((d) => d.day === day);
  if (!dayCfg) return;
  const { repeat } = config;

  (['come', 'leave'] as const).forEach((type) => {
    const slot = dayCfg[type];
    if (!slot.enabled) return;
    const key = `${dateKey}-${day}-${type}`;
    if (doneToday.has(key)) return; // 오늘 찍은 게 확인됨
    if (alertOpen.has(type)) return; // 이전 알럿이 아직 떠 있음

    const slotMin = toMinutes(slot.time);
    const last = lastAttempt.get(key);
    const due = repeat.enabled
      ? // 반복 — 설정 시각 이후(앱을 늦게 켜도) 마지막 시도에서 N분 지나면 재확인
        nowMin >= slotMin && (last === undefined || nowMin - last >= repeat.minutes)
      : // 1회 — 설정 시각부터 2분 이내(슬립 복귀 대비)에 한 번만 발화
        last === undefined && nowMin >= slotMin && nowMin <= slotMin + 2;
    if (!due) return;

    lastAttempt.set(key, nowMin);
    void handleReminder(type, key);
  });
}

/** 리마인더 스케줄러 시작 (앱 ready 후 1회 호출) */
export function startReminderScheduler() {
  if (timer) return;
  timer = setInterval(tick, 30000);
}
