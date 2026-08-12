// 결재 폼의 표시용 계산 — main 쪽 규칙(approval/expend.ts·overtime.ts)과 같은 식을 유지한다.

/** 오늘 "YYYY-MM-DD" (로컬 기준) */
export const today = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** 오늘 기준 "YYYY-MM" */
export const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
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

// ── 야근 결재 ──

/**
 * 종료 시간 기본값 — 현재 시각을 30분 단위로 올림 (예: 19:10 → 19:30).
 * 아직 18시(퇴근)를 넘지 않았으면 18:30, 자정 직전이면 23:30 으로 고정.
 */
export const defaultEndTime = () => {
  const now = new Date();
  let mins = Math.ceil((now.getHours() * 60 + now.getMinutes()) / 30) * 30;
  mins = Math.max(mins, 18 * 60 + 30);
  mins = Math.min(mins, 23 * 60 + 30);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(mins / 60))}:${p(mins % 60)}`;
};

/** 시간합계 표시 — 자정을 넘겨도 계산 (main 의 formatHoursTotal 과 동일 규칙) */
export const hoursTotal = (start: string, end: string): string => {
  const toMin = (t: string) => {
    const m = t.match(/^(\d{1,2}):(\d{2})$/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
  };
  const s = toMin(start);
  const e = toMin(end);
  if (Number.isNaN(s) || Number.isNaN(e) || s === e) return '';
  const diff = (e - s + 24 * 60) % (24 * 60);
  return `${parseFloat((diff / 60).toFixed(1))}시간`;
};

// ── 지출결의서 ──

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

// ── 휴가신청서 ──

/** 근태구분 목록 — 그룹웨어 콤보의 attDivName 과 같은 문구여야 한다 */
export const ATT_DIV_NAMES = [
  '연차',
  '오전반차',
  '오후반차',
  '시차_1시간',
  '시차_2시간',
  '공가',
  '대체휴가',
];

/** "YYYY-MM-DD" → "7월 24일" */
const dayText = (d: string) => {
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${Number(m[2])}월 ${Number(m[3])}일` : d;
};

/** "YYYY-MM-DD" → "07/24" — 대체휴가 제목의 휴일근무일 표기 */
const shortDayText = (d: string) => {
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[2]}/${m[3]}` : d;
};

/** 신청자 정보를 아직 모를 때 제목 미리보기에 넣는 자리표시 */
export const APPLICANT_PLACEHOLDER = '성명';

/** 제목 앞 태그 — 표기 표준: 시차_1시간·시차_2시간 → 시차, 오전·오후반차 → 반차 */
export const titleTag = (attDivName: string) =>
  /시차/.test(attDivName) ? '시차' : /반차/.test(attDivName) ? '반차' : attDivName;

/** 시차·반차 — 제목에 사용 시간대 (00:00~00:00) 를 명시해야 하는 종류 */
export const isTimedKind = (attDivName: string) => /반차|시차/.test(attDivName);

/** 대체휴가 — 제목에 휴일근무일을 명시해야 하는 종류 */
export const isSubstituteKind = (attDivName: string) => attDivName === '대체휴가';

/** 근태구분별 사용 시간대 기본값 [시작, 종료] — 시차는 출근(09:00) 기준, 반차는 점심 포함 */
export const defaultTimeRange = (attDivName: string): [string, string] => {
  if (attDivName === '오전반차') return ['09:00', '14:00'];
  if (attDivName === '오후반차') return ['14:00', '18:00'];
  if (attDivName === '시차_2시간') return ['09:00', '11:00'];
  return ['09:00', '10:00']; // 시차_1시간
};

/**
 * 휴가신청서 제목 기본값 — main 의 formatVacationTitle 과 같은 형식.
 * 휴가 신청서 작성 표기 표준: 제목에 성명·사용 날짜를 적고, 시차·반차는 정확한
 * 시간대를, 대체휴가는 휴일근무일을 함께 명시한다.
 *   [연차] 정수범_8월 12일 · [반차] 정수범_8월 12일 (09:00~14:00)
 *   [대체휴가] 정수범_8월 12일 (휴일근무일: 08/09)
 * 신청자 이름은 그룹웨어 화면에서만 알 수 있다. 모를 때는 자리표시를 넣어
 * 형태를 보여주고, 실제 제목은 main 이 채운다(사용자가 고치지 않은 경우).
 */
export const vacationTitle = (opts: {
  attDivName: string;
  fromDate: string;
  toDate: string;
  name?: string;
  useStartTime?: string;
  useEndTime?: string;
  holidayWorkDate?: string;
}) => {
  const period =
    opts.fromDate === opts.toDate
      ? dayText(opts.fromDate)
      : `${dayText(opts.fromDate)}~${dayText(opts.toDate)}`;
  const extra =
    isTimedKind(opts.attDivName) && opts.useStartTime && opts.useEndTime
      ? ` (${opts.useStartTime}~${opts.useEndTime})`
      : isSubstituteKind(opts.attDivName) && opts.holidayWorkDate
        ? ` (휴일근무일: ${shortDayText(opts.holidayWorkDate)})`
        : '';
  return `[${titleTag(opts.attDivName)}] ${opts.name || APPLICANT_PLACEHOLDER}_${period}${extra}`;
};

/** 반차·시차는 하루짜리라 종료일자를 시작일자에 고정한다 */
export const isSingleDayKind = (attDivName: string) =>
  /반차|시차/.test(attDivName);

/** 전자결재 본문 '사유' 체크 항목 — 문구는 그룹웨어 화면과 같아야 한다 */
export const DOC_REASONS = [
  '휴식',
  '여행',
  '가정대소사 또는 가족모임',
  '가족건강문제',
  '개인건강문제(병원, 약국)',
  '기타',
];
