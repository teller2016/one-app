// 일정 등록 누락 판정 (순수 로직 — Electron 의존 없음, 단위 테스트 대상)
import type { ScheduleStartConfig } from '../../../shared/types';

/** 직전 평일 — 월요일이면 금요일, 주말이면 그 주 금요일 */
export function previousWeekday(now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  do {
    d.setDate(d.getDate() - 1);
  } while (d.getDay() === 0 || d.getDay() === 6);
  return d;
}

const toMinutes = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};

/**
 * 지금 전날 등록 여부를 확인할 때인가 — 평일이고, 그날 기준 시작 시각(재택/출근)이 지났을 때.
 * 출근 전(새벽·이른 아침)에 알럿을 띄우지 않기 위한 하한이다.
 */
export function isCheckTime(now: Date, cfg: ScheduleStartConfig): boolean {
  const day = now.getDay();
  if (day === 0 || day === 6) return false;
  const start = cfg.remoteDays.includes(day) ? cfg.remoteStart : cfg.officeStart;
  return now.getHours() * 60 + now.getMinutes() >= toMinutes(start);
}

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

/** 알럿 표기용 날짜 — `9/29(화)` */
export function formatShortDate(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAY[d.getDay()]})`;
}
