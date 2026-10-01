// 일정 등록 누락 알림 — 등록 성공한 날짜를 기록해 두고, 다음 평일 아침에 직전 평일이
// 기록에 없으면 알럿 1회로 알린다(일정 등록을 깜빡하고 초안을 지우는 사고 방지 — 2026-09-30).
import { notify } from '../notify/notify';
import { isSystemAsleep } from '../power';
import { readUserJson, writeUserJson } from '../../lib/store';
import { localDateKey } from '../../lib/util';
import { formatShortDate, isCheckTime, previousWeekday } from './registerCheck';
import type { ScheduleStartConfig } from '../../../shared/types';

const REGISTERED_FILE = 'schedule-registered.json';
const KEEP_DAYS = 60; // 오래된 기록은 버린다 (직전 평일만 보므로 넉넉한 상한)
const CHECK_INTERVAL_MS = 5 * 60_000;
const FIRST_CHECK_DELAY_MS = 60_000; // 앱 시작 직후 알럿이 창보다 먼저 뜨지 않게

type RegisteredState = {
  dates: string[]; // 등록 성공한 날짜 (localDateKey)
  notifiedOn?: string; // 누락 알럿을 띄운 날 — 하루 1회
};

function readState(): RegisteredState {
  const raw = readUserJson<Partial<RegisteredState> | null>(REGISTERED_FILE, null);
  return {
    dates: Array.isArray(raw?.dates)
      ? raw.dates.filter((d): d is string => typeof d === 'string')
      : [],
    notifiedOn: typeof raw?.notifiedOn === 'string' ? raw.notifiedOn : undefined,
  };
}

/** 일정 등록 성공 기록 — 테스트 모드는 부르지 않는다 */
export function markScheduleRegistered(date: Date): void {
  const state = readState();
  const key = localDateKey(date);
  const dates = [...state.dates.filter((d) => d !== key), key].slice(-KEEP_DAYS);
  writeUserJson(REGISTERED_FILE, { ...state, dates });
}

let timer: ReturnType<typeof setInterval> | null = null;
let alertOpen = false;

async function check(getStartConfig: () => ScheduleStartConfig) {
  if (alertOpen || isSystemAsleep()) return;
  const now = new Date();
  if (!isCheckTime(now, getStartConfig())) return;

  const state = readState();
  const today = localDateKey(now);
  if (state.notifiedOn === today) return;

  const target = previousWeekday(now);
  if (state.dates.includes(localDateKey(target))) return;

  // 알럿을 띄우기 전에 먼저 기록 — 개발 인스턴스와 빌드 앱이 같은 파일을 보므로 중복 발화를 줄인다
  writeUserJson(REGISTERED_FILE, { ...state, notifiedOn: today });
  console.log('[schedule] 등록 누락 알림:', localDateKey(target));
  alertOpen = true;
  try {
    await notify({
      title: '📝 일정 등록 확인',
      body: `${formatShortDate(target)} 일정을 등록한 기록이 없어요.`,
      section: 'schedule',
    });
  } finally {
    alertOpen = false;
  }
}

/** 누락 알림 스케줄러 시작 — 시작 설정은 매번 읽는다(저장 후 재시작 불필요) */
export function startScheduleRegisterReminder(
  getStartConfig: () => ScheduleStartConfig,
): void {
  if (timer) return;
  const run = () => void check(getStartConfig).catch((err) => {
    console.warn('[schedule] 등록 누락 확인 실패:', err);
  });
  setTimeout(run, FIRST_CHECK_DELAY_MS);
  timer = setInterval(run, CHECK_INTERVAL_MS);
}
