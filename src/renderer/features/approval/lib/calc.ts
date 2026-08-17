// 결재 폼의 표시용 계산.
// 표기 규칙(제목·시간합계·일수 환산)은 main 자동화와 **같은 문자열**이어야 하므로
// `shared/approval-format.ts` 가 정본이고 여기서는 재수출만 한다.
import {
  fromMinutes,
  monthEndDayKey,
  parseDayKey,
  shiftMonthKey,
  thisMonthKey,
  todayKey,
} from '../../../../shared/date';
import {
  KIND_DAY_FACTOR,
  formatHoursTotal,
} from '../../../../shared/approval-format';

export {
  APPLICANT_PLACEHOLDER,
  isSubstituteKind,
  isTimedKind,
  titleTag,
  vacationTitle,
} from '../../../../shared/approval-format';

/** 오늘 "YYYY-MM-DD" (로컬 기준) */
export const today = todayKey;

/** 오늘 기준 "YYYY-MM" */
export const thisMonth = thisMonthKey;

/** 월 이동 — "YYYY-MM" ± n개월 */
export const shiftMonth = shiftMonthKey;

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
  return fromMinutes(mins);
};

/** 시간합계 표시 — 자정을 넘겨도 계산 */
export const hoursTotal = formatHoursTotal;

// ── 지출결의서 ──

/** 주차요금 공급대가 — (만원권 × 10,000 + 5천원권 × 5,000) ÷ 2 */
export const parkingAmount = (manCount: number, halfCount: number) =>
  Math.floor((manCount * 10000 + halfCount * 5000) / 2);

/** "YYYY-MM" → 그 달 말일 "YYYY-MM-DD" */
export const monthEndDate = monthEndDayKey;

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

/** 근태구분별 사용 시간대 기본값 [시작, 종료] — 시차는 출근(09:00) 기준, 반차는 점심 포함 */
export const defaultTimeRange = (attDivName: string): [string, string] => {
  if (attDivName === '오전반차') return ['09:00', '14:00'];
  if (attDivName === '오후반차') return ['14:00', '18:00'];
  if (attDivName === '시차_2시간') return ['09:00', '11:00'];
  return ['09:00', '10:00']; // 시차_1시간
};

/** 반차·시차는 하루짜리라 종료일자를 시작일자에 고정한다 */
export const isSingleDayKind = (attDivName: string) =>
  /반차|시차/.test(attDivName);

/**
 * 예상 신청일수 — 기간을 입력하는 즉시 연차 1일·반차 0.5일·시차 0.125일 식으로 보여준다.
 * 주말(토·일)은 제외하지만 공휴일은 앱이 모르므로 어디까지나 표시용이다 —
 * 확정값(신청일수·연차차감)은 그룹웨어가 계산한다(main 의 waitCalculated).
 */
export const expectedDayCount = (
  attDivName: string,
  fromDate: string,
  toDate: string,
): number | null => {
  const factor = KIND_DAY_FACTOR[attDivName];
  if (factor !== undefined) return factor; // 반차·시차는 하루짜리 고정
  const from = parseDayKey(fromDate);
  const to = parseDayKey(toDate);
  if (!from || !to || from.getTime() > to.getTime()) return null;
  let days = 0;
  for (const d = new Date(from); d.getTime() <= to.getTime(); d.setDate(d.getDate() + 1)) {
    if (d.getDay() !== 0 && d.getDay() !== 6) days += 1;
  }
  return days;
};

/** 전자결재 본문 '사유' 체크 항목 — 문구는 그룹웨어 화면과 같아야 한다 */
export const DOC_REASONS = [
  '휴식',
  '여행',
  '가정대소사 또는 가족모임',
  '가족건강문제',
  '개인건강문제(병원, 약국)',
  '기타',
];
