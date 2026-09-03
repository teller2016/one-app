// 결재 표기 규칙 — 렌더러 폼(미리보기)과 main 자동화(실제 입력)가 **같은 문자열**을 만들어야 한다.
//
// 예전엔 세 쌍이 양쪽에 복사돼 있었고(`vacationTitle`/`formatVacationTitle`,
// `KIND_DAY_FACTOR` ×2, `hoursTotal`/`formatHoursTotal`), 규칙 문서에 "두 곳을 함께 고칠 것"
// 이라고 적어 관리하던 위험이었다. 여기가 정본이다.
import { toMinutes } from "./date";

// ── 야근 결재 (연장근무내역서) ──

/**
 * 근무시간 합계 문구 — 자정을 넘겨도 계산되도록 wrap-around. 예: 2시간 · 2.5시간.
 * 형식이 어긋나거나 시작=종료면 빈 문자열.
 */
export function formatHoursTotal(startTime: string, endTime: string): string {
  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  if (Number.isNaN(start) || Number.isNaN(end) || start === end) return "";
  const diff = (end - start + 24 * 60) % (24 * 60);
  return `${parseFloat((diff / 60).toFixed(1))}시간`;
}

// ── 휴가신청서 ──

/**
 * 근태구분별 하루 환산 계수 — 반차 0.5일, 시차는 8시간 근무 기준 0.125·0.25일.
 *
 * ⚠️ 그룹웨어 신청일수(`#dayCnt`)는 반차·시차도 **달력 기준 1일**로 센다(2026-08-13 실측) —
 * 본문 기간의 `( N 일간)` 과 완료 카드는 계수가 있는 종류면 이 값으로 바꿔 적는다.
 */
export const KIND_DAY_FACTOR: Record<string, number> = {
  오전반차: 0.5,
  오후반차: 0.5,
  시차_1시간: 0.125,
  시차_2시간: 0.25,
};

/** 신청자 이름을 아직 모를 때 제목 미리보기에 넣는 자리표시 */
export const APPLICANT_PLACEHOLDER = "성명";

/** 소속(챕터·부문)을 아직 모를 때 제목 미리보기에 넣는 자리표시 */
export const DEPT_PLACEHOLDER = "소속";

/**
 * 제목에 자리표시가 남아 있는가 — 남아 있으면 사용자가 고친 것으로 치지 않고 main 이 다시 만든다.
 * (자리표시가 그대로 상신되면 곤란하다)
 */
export const hasTitlePlaceholder = (title: string): boolean =>
  title.includes(APPLICANT_PLACEHOLDER) || title.includes(DEPT_PLACEHOLDER);

/** 제목 앞 태그 — 표기 표준: 시차_1시간·시차_2시간 → 시차, 오전·오후반차 → 반차 */
export const titleTag = (attDivName: string) =>
  /시차/.test(attDivName) ? "시차" : /반차/.test(attDivName) ? "반차" : attDivName;

/** 시차·반차 — 제목에 사용 시간대 (00:00~00:00) 를 명시해야 하는 종류 */
export const isTimedKind = (attDivName: string) => /반차|시차/.test(attDivName);

/** 대체휴가 — 제목에 휴일근무일을 명시해야 하는 종류 */
export const isSubstituteKind = (attDivName: string) => attDivName === "대체휴가";

/** "YYYY-MM-DD" → "7월 24일" (형식이 어긋나면 입력 그대로) */
const dayText = (d: string) => {
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${Number(m[2])}월 ${Number(m[3])}일` : d;
};

/** "YYYY-MM-DD" → "07/24" — 대체휴가 제목의 휴일근무일 표기 */
const shortDayText = (d: string) => {
  const m = d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[2]}/${m[3]}` : d;
};

/**
 * 소속 문구 — 환경설정 '결재 소속' 값을 **그대로** 쓰고 공백만 밑줄로 바꾼다.
 * (`FE챕터 플랫폼기술부문` → `FE챕터_플랫폼기술부문`). 비어 있으면 자리표시.
 *
 * ⚠️ 값을 쪼개 조립하지 말 것 — 예전엔 그룹웨어에서 읽은 챕터 + 설정값의 첫 단어를
 * 이어 붙였는데, 사용자가 설정에 `FE챕터 플랫폼기술부문` 을 넣자 챕터가 두 번 들어가
 * `정수범_FE챕터_FE챕터` 가 됐다(2026-09-03 사용자 신고). 소속은 설정 한 곳에서만 온다.
 */
const deptText = (dept?: string): string => {
  const d = (dept ?? "").trim().replace(/\s+/g, "_");
  return d || DEPT_PLACEHOLDER;
};

/**
 * 휴가신청서 제목 — `[종류] 성명_소속 (날짜·시간)` (2026-09-03 사용자 지정 형식).
 * 이름과 소속을 밑줄로 잇고, 괄호에 사용 날짜를 넣는다. 시차·반차는 정확한 시간대를,
 * 대체휴가는 근거 휴일근무일을 괄호 안에 함께 명시한다.
 * ```
 * [연차]     정수범_FE챕터_플랫폼기술부문 (9월 1일)
 * [연차]     정수범_FE챕터_플랫폼기술부문 (9월 1일~9월 2일)
 * [반차]     정수범_FE챕터_플랫폼기술부문 (9월 1일 09:00~14:00)
 * [시차]     정수범_FE챕터_플랫폼기술부문 (9월 1일 09:00~10:00)
 * [대체휴가] 정수범_FE챕터_플랫폼기술부문 (9월 1일, 휴일근무일: 08/09)
 * ```
 * 이름은 그룹웨어 화면에서만 알 수 있고 소속은 환경설정의 '결재 소속'에서 온다 —
 * 이름을 모를 때(조회 전 미리보기)는 자리표시를 넣어 형태만 보여주고, 실제 제목은
 * main 이 이름을 읽어 다시 만든다.
 */
export function vacationTitle(opts: {
  attDivName: string;
  fromDate: string;
  toDate: string;
  name?: string;
  /** 소속 문구 — 환경설정 '결재 소속' 값 그대로 (예: `FE챕터 플랫폼기술부문`) */
  dept?: string;
  useStartTime?: string;
  useEndTime?: string;
  holidayWorkDate?: string;
}): string {
  const period =
    opts.fromDate === opts.toDate
      ? dayText(opts.fromDate)
      : `${dayText(opts.fromDate)}~${dayText(opts.toDate)}`;
  const extra =
    isTimedKind(opts.attDivName) && opts.useStartTime && opts.useEndTime
      ? ` ${opts.useStartTime}~${opts.useEndTime}`
      : isSubstituteKind(opts.attDivName) && opts.holidayWorkDate
        ? `, 휴일근무일: ${shortDayText(opts.holidayWorkDate)}`
        : "";
  const who = `${opts.name || APPLICANT_PLACEHOLDER}_${deptText(opts.dept)}`;
  return `[${titleTag(opts.attDivName)}] ${who} (${period}${extra})`;
}
