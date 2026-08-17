// 날짜·시간 문자열 유틸 — main · preload · renderer 3개 컨텍스트 공용 정본.
//
// 예전엔 `String(n).padStart(2,'0')` 이 22곳에 흩어져 있었고 "YYYY-MM-DD" 를 만드는 함수만
// 다섯 벌이었다(approval/calc·jira/week·changes/diff·schedule/scheduleUtils·weekly/collect).
// 새 날짜 포맷이 필요하면 여기에 더할 것.
//
// ⚠️ **`new Date("2026-08-10")` 로 파싱하지 말 것** — 그 형식은 UTC 로 해석돼 한국 시간대에서
// 하루 앞으로 밀린다. 항상 `parseDayKey` 처럼 연·월·일을 쪼개 로컬 Date 를 만든다.

/** 두 자리 0패딩 — 9 → "09" */
export const pad2 = (n: number) => String(n).padStart(2, "0");

/** 로컬 기준 "YYYY-MM-DD" */
export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** 오늘 "YYYY-MM-DD" (로컬) */
export const todayKey = () => dayKey(new Date());

/** 로컬 기준 "YYYY-MM" */
export const monthKey = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;

/** 오늘 "YYYY-MM" (로컬) */
export const thisMonthKey = () => monthKey(new Date());

/** "YYYY-MM-DD" → 로컬 Date(자정). 형식이 어긋나면 null */
export const parseDayKey = (key: string): Date | null => {
  const m = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};

/** "YYYY-MM" ± n개월 → "YYYY-MM". 형식이 어긋나면 입력 그대로 */
export const shiftMonthKey = (month: string, delta: number) => {
  const m = month.match(/^(\d{4})-(\d{2})$/);
  if (!m) return month;
  return monthKey(new Date(Number(m[1]), Number(m[2]) - 1 + delta, 1));
};

/** "YYYY-MM" → 그 달 말일의 "YYYY-MM-DD". 형식이 어긋나면 빈 문자열 */
export const monthEndDayKey = (month: string) => {
  const m = month.match(/^(\d{4})-(\d{2})$/);
  // Date(y, m, 0) = 그 달의 마지막 날 (월은 1-based 그대로 넘긴다)
  return m ? dayKey(new Date(Number(m[1]), Number(m[2]), 0)) : "";
};

/** 로컬 기준 "HH:MM" */
export const hhmm = (d: Date) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

/** "HH:MM" → 자정부터의 분. 형식이 어긋나면 NaN */
export const toMinutes = (t: string) => {
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

/** 분 → "HH:MM" (24시간을 넘으면 wrap) */
export const fromMinutes = (min: number) => {
  const wrapped = ((min % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(wrapped / 60))}:${pad2(wrapped % 60)}`;
};

/** getDay() 색인용 한글 요일 — 일요일이 0 */
export const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"];
