// 출퇴근 리마인더 스케줄러 — 메인 프로세스에서 매 30초 현재 시각을 확인해,
// 설정된 요일·시각이 되면 근태 상태를 조회(스마트 스킵)한 뒤 알림(알럿)을 띄운다.
// 반복 알림이 켜져 있으면 설정 시각 이후 안 찍은 동안 N분 간격으로 재알림한다.
// 창을 닫아도(맥) 앱 프로세스가 살아 있는 한 동작한다.
import { runAttendance, getKnownAttendanceToday } from './attend';
import { getReminderConfig } from './reminders';
import { getCredentials } from '../settings/store';
import { notify, getNotifyWindow } from '../notify/notify';
import type { AttendanceInfo } from '../../../shared/types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 근태 상태 조회 — 순간 실패(VPN 블립·동시 실행 충돌)를 흡수하도록 재시도한다 */
async function fetchStatusWithRetry(
  cred: NonNullable<ReturnType<typeof getCredentials>>,
): Promise<AttendanceInfo | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await runAttendance('status', cred);
    } catch {
      if (attempt < 2) await sleep(5000);
    }
  }
  return null;
}

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
  // 스마트 스킵 — 이미 찍었으면 알림하지 않는다.
  // 조회는 재시도하고, 그래도 실패하면 오늘 다른 경로(위젯 등)로 확인된 근태로 판단한다.
  // 그 근거조차 없을 때만(계정 없음·VPN 지속 불가) 놓치지 않도록 알림한다(하루 1회).
  const cred = getCredentials();
  let comeTime: string | null = null;
  let leaveTime: string | null = null;
  let checkFailed = false;

  if (cred) {
    const info = await fetchStatusWithRetry(cred);
    if (info) {
      comeTime = info.comeTime;
      leaveTime = info.leaveTime;
    } else {
      // 조회 실패 → 오늘 확인된 근태의 '찍음' 신호만 신뢰한다.
      // (출퇴근은 한 번 찍으면 하루 유지되므로 양성은 신뢰 가능. 반대로 '아직 안 찍음'은
      //  캐시가 찍기 전 값일 수 있어 신뢰 못 함 → 확인 불가로 처리해 폴백 알림 1회.)
      const known = getKnownAttendanceToday();
      const stamped = type === 'come' ? known?.comeTime : known?.leaveTime;
      if (stamped) {
        if (type === 'come') comeTime = known?.comeTime ?? null;
        else leaveTime = known?.leaveTime ?? null;
        console.log('[reminder] 조회 실패 — 오늘 확인된 근태로 스킵:', stamped);
      } else {
        checkFailed = true;
      }
    }
  } else {
    checkFailed = true;
  }

  if (type === 'come') {
    if (comeTime) {
      console.log('[reminder] 출근 알림 건너뜀 (이미 출근:', comeTime, ')');
      doneToday.add(key);
      return; // 이미 출근함
    }
  } else {
    if (leaveTime) {
      console.log('[reminder] 퇴근 알림 건너뜀 (이미 퇴근:', leaveTime, ')');
      doneToday.add(key);
      return; // 이미 퇴근함
    }
    if (!checkFailed && !comeTime) {
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
    const stampNow = await notify({
      title: type === 'come' ? '🕘 출근 체크' : '🕕 퇴근 체크',
      body: checkFailed
        ? `${label} 찍는 것을 잊지 마세요.`
        : `아직 ${label}을 안 찍었어요.`,
      // 계정이 있으면 알럿에서 바로 찍기 제공 (알럿 자체가 확인 대화상자 역할)
      action: cred ? `지금 ${label} 찍기` : undefined,
    });
    if (stampNow && cred) await stampFromAlert(type, key, cred);
  } finally {
    // 반복 간격은 알럿(결과 알럿 포함)을 닫은 시점부터 다시 센다 (방치 중 중복 알럿 방지)
    alertOpen.delete(type);
    lastAttempt.set(key, nowMinutes(new Date()));
  }
}

// 알럿의 '지금 찍기' — 찍은 뒤 결과 알럿을 띄우고, 성공하면 그날 리마인더를 멈춘다
async function stampFromAlert(
  type: 'come' | 'leave',
  key: string,
  cred: NonNullable<ReturnType<typeof getCredentials>>,
) {
  const label = type === 'come' ? '출근' : '퇴근';
  // 알럿에서 찍기 시작 → 사이드바 위젯도 앱에서 누른 것처럼 '처리중' 비활성 상태로
  pushStamping(type);
  try {
    const info = await runAttendance(type, cred);
    doneToday.add(key);
    pushAttendanceChanged(info);
    const time = type === 'come' ? info.comeTime : info.leaveTime;
    console.log(`[reminder] 알럿에서 ${label} 찍기 완료`, time ?? '');
    await notify({
      title: `✅ ${label} 완료`,
      body: time ? `${time} 에 ${label} 처리됐습니다.` : `${label} 처리됐습니다.`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[reminder] 알럿에서 ${label} 찍기 실패:`, msg);
    await notify({
      title: `❌ ${label} 찍기 실패`,
      body: `${msg}\n사이드바 근태 위젯에서 직접 시도해주세요.`,
    });
  } finally {
    // 성공·실패 모두 위젯의 '처리중' 상태를 푼다 (성공은 changed 로 시각도 갱신됨)
    pushStamping(null);
  }
}

// 알럿에서 찍으면 사이드바 근태 위젯이 즉시 갱신되도록 렌더러에 알린다
function pushAttendanceChanged(info: AttendanceInfo) {
  getNotifyWindow()?.webContents.send('attendance:changed', info);
}

// 알럿에서 찍는 동안 위젯 버튼을 비활성('처리중')으로 동기화한다. 끝나면 null 로 해제.
function pushStamping(action: 'come' | 'leave' | null) {
  getNotifyWindow()?.webContents.send('attendance:stamping', action);
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
