// 일정 등록 누락 판정 (순수 로직 — Electron 의존 없음, 단위 테스트 대상)
import { WEEKDAY_KO, toMinutes } from '../../../shared/date';
import type { ScheduleStartConfig } from '../../../shared/types';

/** 직전 평일 — 월요일이면 금요일, 주말이면 그 주 금요일 */
export function previousWeekday(now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  do {
    d.setDate(d.getDate() - 1);
  } while (d.getDay() === 0 || d.getDay() === 6);
  return d;
}

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

/** 알럿 표기용 날짜 — `9/29(화)` */
export function formatShortDate(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAY_KO[d.getDay()]})`;
}

/**
 * 저장된 날짜 키를 `YYYY-MM-DD` 로 맞춘다 — 첫 버전이 0패딩 없는 `2026-10-1` 형식으로 썼고,
 * 옛 설치본과 새 코드가 같은 파일을 번갈아 쓰면 서로의 '오늘 알림 함'을 못 알아봐 알림이
 * 반복됐다(2026-10-01 실측). 형식이 아니면 null.
 */
export function normalizeDayKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
}
