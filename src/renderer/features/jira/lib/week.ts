// 주간 활동 탭의 기간 계산 — 월요일 시작 주(월~일)
//
// ⚠️ 날짜 문자열을 `new Date('2026-08-10')` 로 파싱하지 말 것 — 그 형식은 UTC 로 해석돼
// 한국 시간대에서 하루 앞으로 밀린다. 항상 연·월·일을 쪼개 로컬 Date 를 만든다.

/** 조회 기간 — main 의 `jira:activity` 인자와 같은 형식(YYYY-MM-DD) */
export type WeekRange = {
  offset: number; // 0 = 이번 주, -1 = 지난 주
  start: string; // 월요일
  end: string; // 일요일
};

/** 과거로 이동할 수 있는 한계 — 1년이면 회고 용도로 충분하다 */
export const MAX_WEEKS_BACK = 52;

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];
const pad = (n: number) => String(n).padStart(2, '0');

/** 로컬 기준 YYYY-MM-DD */
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** YYYY-MM-DD → 로컬 Date (자정) */
const parseKey = (key: string): Date => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** offset 주만큼 이동한 월~일 주 (0 = 이번 주) */
export function weekRange(offset: number): WeekRange {
  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // getDay(): 일=0 → 월요일까지 되돌릴 일수는 (day + 6) % 7
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) + offset * 7);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { offset, start: dayKey(monday), end: dayKey(sunday) };
}

/** 주 표시 — "8.10(월) ~ 8.16(일)", 올해가 아니면 연도를 앞에 붙인다 */
export function weekLabel(range: WeekRange): string {
  const s = parseKey(range.start);
  const e = parseKey(range.end);
  const md = (d: Date) => `${d.getMonth() + 1}.${d.getDate()}(${WEEKDAY[d.getDay()]})`;
  const year = s.getFullYear() !== new Date().getFullYear() ? `${s.getFullYear()}. ` : '';
  return `${year}${md(s)} ~ ${md(e)}`;
}

/** 이력 시각 — "화 14:20" (한 주 안이라 요일까지면 충분하다) */
export function eventTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${WEEKDAY[d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
