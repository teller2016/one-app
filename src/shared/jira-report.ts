// Jira 티켓 보고 — 조회 조건 → JQL 조립.
// main(실제 검색)과 렌더러(화면의 JQL 미리보기)가 **같은 문자열**을 만들어야 해서 shared 에 둔다.
import type {
  JiraReportDateField,
  JiraReportPeriod,
  JiraReportQuery,
} from "./types";
import { dayKey, parseDayKey, shiftMonthKey } from "./date";

const PROJECT_KEY_RE = /^[A-Z][A-Z0-9_]*$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 기간 기준 필드의 표시 이름 — 렌더러 Select 와 결과 표의 날짜 열 제목이 함께 쓴다 */
export const REPORT_DATE_FIELDS: { value: JiraReportDateField; label: string }[] = [
  { value: "updated", label: "갱신일" },
  { value: "created", label: "생성일" },
  { value: "resolved", label: "해결일" },
];

/** 프로젝트 키 정리 — 대문자·형식 검증·중복 제거. 형식이 어긋난 값은 조용히 버린다 */
export function normalizeProjectKeys(keys: string[]): string[] {
  const out: string[] = [];
  for (const raw of keys) {
    const k = String(raw ?? "")
      .trim()
      .toUpperCase();
    if (PROJECT_KEY_RE.test(k) && !out.includes(k)) out.push(k);
  }
  return out;
}

/**
 * 기간 → JQL 조건 조각. 기간 없음이면 null, 값이 잘못됐으면 throw.
 *
 * ⚠️ 끝 경계는 항상 **다음 날(다음 달 1일) 미만**으로 쓴다 — Jira 의 `field <= "2026-08-31"` 은
 * 그날 00:00 까지라 말일의 활동이 통째로 빠진다(주간 활동에서 겪은 DURING 경계 함정과 같다).
 */
function periodClause(
  period: JiraReportPeriod,
  field: JiraReportDateField,
): string | null {
  if (period.mode === "all") return null;
  if (period.mode === "month") {
    if (!MONTH_RE.test(period.month)) throw new Error("월 형식이 잘못되었습니다.");
    const next = shiftMonthKey(period.month, 1);
    return `${field} >= "${period.month}-01" AND ${field} < "${next}-01"`;
  }
  const start = DAY_RE.test(period.start) ? parseDayKey(period.start) : null;
  const end = DAY_RE.test(period.end) ? parseDayKey(period.end) : null;
  if (!start || !end) throw new Error("기간 날짜 형식이 잘못되었습니다.");
  if (start.getTime() > end.getTime()) {
    throw new Error("기간의 시작이 끝보다 늦습니다.");
  }
  const after = new Date(end);
  after.setDate(after.getDate() + 1);
  return `${field} >= "${period.start}" AND ${field} < "${dayKey(after)}"`;
}

/**
 * 조회 조건 → JQL.
 * - 고급 JQL 이 있으면 그대로 보낸다(앞뒤 공백만 정리).
 * - 아니면 `project IN (…) AND <기간>` 으로 조립한다. 프로젝트가 없으면 throw —
 *   전 프로젝트 조회는 상한에 바로 걸려 보고용으로 의미가 없다.
 * - ORDER BY 는 페이징 안정성용이다. 화면 정렬은 렌더러가 따로 한다.
 */
export function buildReportJql(q: JiraReportQuery): string {
  const custom = (q.jql ?? "").trim();
  if (custom) return custom;
  const keys = normalizeProjectKeys(q.projectKeys);
  if (keys.length === 0) throw new Error("프로젝트를 하나 이상 고르세요.");
  const clauses = [`project IN (${keys.join(", ")})`];
  const period = periodClause(q.period, q.dateField);
  if (period) clauses.push(period);
  return `${clauses.join(" AND ")} ORDER BY created ASC`;
}
