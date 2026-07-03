// 출퇴근 리마인더 스케줄러 — 메인 프로세스에서 매 30초 현재 시각을 확인해,
// 설정된 요일·시각이 되면 근태 상태를 조회(스마트 스킵)한 뒤 데스크톱 알림을 띄운다.
// 창을 닫아도(맥) 앱 프로세스가 살아 있는 한 동작한다.
import { runAttendance } from './attend';
import { getReminderConfig } from './reminders';
import { getCredentials } from '../settings/store';
import { notify } from '../notify/notify';

let timer: ReturnType<typeof setInterval> | null = null;

// 오늘 이미 울린 리마인더 (중복 방지). 날짜가 바뀌면 초기화한다.
const firedToday = new Set<string>();
let firedDate = '';

const toMinutes = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

const localDateKey = (d: Date) =>
  `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

async function handleReminder(type: 'come' | 'leave') {
  // 스마트 스킵 — 이미 찍었으면 알림하지 않는다. 상태 확인이 실패하면(계정 없음·VPN 등)
  // 놓치는 것보다 낫도록 알림을 띄운다.
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
      return; // 이미 출근함
    }
    console.log('[reminder] 출근 알림 발화', checkFailed ? '(상태 확인 실패)' : '');
    notify({
      title: '🕘 출근 체크',
      body: checkFailed
        ? '출근 찍는 것을 잊지 마세요.'
        : '아직 출근을 안 찍었어요 — 사이드바 근태 위젯에서 출근을 눌러주세요.',
    });
  } else {
    if (info?.leaveTime) {
      console.log('[reminder] 퇴근 알림 건너뜀 (이미 퇴근:', info.leaveTime, ')');
      return; // 이미 퇴근함
    }
    if (!checkFailed && !info?.comeTime) {
      console.log('[reminder] 퇴근 알림 건너뜀 (출근 기록 없음)');
      return; // 출근 기록이 없으면(휴무 등) 퇴근 알림 생략
    }
    console.log('[reminder] 퇴근 알림 발화', checkFailed ? '(상태 확인 실패)' : '');
    notify({
      title: '🕕 퇴근 체크',
      body: checkFailed
        ? '퇴근 찍는 것을 잊지 마세요.'
        : '아직 퇴근을 안 찍었어요 — 사이드바 근태 위젯에서 퇴근을 눌러주세요.',
    });
  }
}

function tick() {
  const now = new Date();
  const dateKey = localDateKey(now);
  if (dateKey !== firedDate) {
    firedToday.clear();
    firedDate = dateKey;
  }

  const day = now.getDay(); // 0=일 … 6=토
  if (day < 1 || day > 5) return; // 주말 제외

  const nowMin = now.getHours() * 60 + now.getMinutes();
  const dayCfg = getReminderConfig().days.find((d) => d.day === day);
  if (!dayCfg) return;

  (['come', 'leave'] as const).forEach((type) => {
    const slot = dayCfg[type];
    if (!slot.enabled) return;
    const slotMin = toMinutes(slot.time);
    // 설정 시각부터 2분 이내(슬립 복귀 대비)에 한 번만 발화
    if (nowMin < slotMin || nowMin > slotMin + 2) return;
    const key = `${dateKey}-${day}-${type}`;
    if (firedToday.has(key)) return;
    firedToday.add(key);
    void handleReminder(type);
  });
}

/** 리마인더 스케줄러 시작 (앱 ready 후 1회 호출) */
export function startReminderScheduler() {
  if (timer) return;
  timer = setInterval(tick, 30000);
}
