// 지출결의서 계산 규칙 — main 의 expend.ts 와 같은 규칙을 유지한다 (화면 미리보기용).

/** 주차요금 공급대가 — (만원권 × 10,000 + 5천원권 × 5,000) ÷ 2 */
export const parkingAmount = (manCount: number, halfCount: number) =>
  Math.floor((manCount * 10000 + halfCount * 5000) / 2);

/** "YYYY-MM" → 그 달 말일 "YYYY-MM-DD" */
export const monthEndDate = (month: string) => {
  const m = month.match(/^(\d{4})-(\d{2})$/);
  if (!m) return '';
  const last = new Date(Number(m[1]), Number(m[2]), 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${last.getFullYear()}-${pad(last.getMonth() + 1)}-${pad(last.getDate())}`;
};

/** 주차 적요 — 예: 26년 7월 주차 요금 */
export const parkingNote = (month: string) => {
  const m = month.match(/^(\d{4})-(\d{2})$/);
  return m ? `${m[1].slice(2)}년 ${Number(m[2])}월 주차 요금` : '';
};

/** 석식 적요 — 예: 7월 28일 연장근로 석식비 */
export const dinnerNote = (date: string) => {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${Number(m[2])}월 ${Number(m[3])}일 연장근로 석식비` : '';
};

/** 오늘 기준 "YYYY-MM" */
export const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** 오늘 "YYYY-MM-DD" */
export const today = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** 월 이동 — "YYYY-MM" ± n개월 */
export const shiftMonth = (month: string, delta: number) => {
  const m = month.match(/^(\d{4})-(\d{2})$/);
  if (!m) return month;
  const d = new Date(Number(m[1]), Number(m[2]) - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** 금액 표시 — 12500 → 12,500 */
export const formatWon = (n: number) => n.toLocaleString('ko-KR');
