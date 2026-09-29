// Jira 티켓 보고 — 조회 조건 → JQL 조립.
// main(실제 검색)과 렌더러(화면의 JQL 미리보기)가 **같은 문자열**을 만들어야 해서 shared 에 둔다.
import type {
  JiraReportDateField,
  JiraReportPeriod,
  JiraReportQuery,
} from "./types";
import { dayKey, parseDayKey, shiftMonthKey } from "./date";

const PROJECT_KEY_RE = /^[A-Z][A-Z0-9_]*$/;
const ISSUE_KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 기간 기준 필드의 표시 이름 — 렌더러 Select 와 결과 표의 날짜 열 제목이 함께 쓴다 */
export const REPORT_DATE_FIELDS: { value: JiraReportDateField; label: string }[] = [
  { value: "updated", label: "갱신일" },
  { value: "created", label: "생성일" },
  { value: "resolved", label: "해결일" },
];

/** 한 번에 보낼 레이블 상한 — JQL 이 지나치게 길어지는 것을 막는 방어값 */
const LABEL_MAX = 200;
/** 한 번에 보낼 에픽 상한 — 같은 이유 (에픽은 키가 두 번 들어간다) */
const EPIC_MAX = 100;

/** JQL 문자열 리터럴 — 역슬래시·따옴표를 이스케이프한다 */
const jqlString = (v: string): string =>
  `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** 레이블 정리 — 공백 제거·빈 값·중복 제거 (Jira 레이블에는 공백이 없다) */
export function normalizeLabels(labels: string[] | undefined): string[] {
  const out: string[] = [];
  for (const raw of labels ?? []) {
    const v = String(raw ?? "").trim();
    if (v && !out.includes(v)) out.push(v);
    if (out.length >= LABEL_MAX) break;
  }
  return out;
}

/** 에픽 키 정리 — 대문자·`KEY-123` 형식 검증·중복 제거. 형식이 어긋난 값은 조용히 버린다 */
export function normalizeEpicKeys(keys: string[] | undefined): string[] {
  const out: string[] = [];
  for (const raw of keys ?? []) {
    const k = String(raw ?? "")
      .trim()
      .toUpperCase();
    if (ISSUE_KEY_RE.test(k) && !out.includes(k)) out.push(k);
    if (out.length >= EPIC_MAX) break;
  }
  return out;
}

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
 * - 아니면 `project IN (…) AND labels IN (…) AND parentEpic IN (…) AND <기간>` 으로 조립한다.
 * - **프로젝트·레이블·에픽 중 하나는 있어야 한다** — 조건 없는 전 프로젝트 조회는 상한에 바로
 *   걸려 보고용으로 의미가 없다. 반대로 레이블·에픽이 있으면 그 자체로 충분히 좁으므로 프로젝트
 *   없이도 허용한다(운영배포 레이블처럼 여러 프로젝트에 걸친 축을 그대로 뽑을 수 있다).
 * - 에픽은 `parentEpic` 이다 — `parent IN (…)` 는 **바로 아래 자식만** 주고 하위 작업이 빠진다.
 *   `parentEpic` 은 에픽 자신 + 자식 + 하위 작업을 주므로(2026-09-29 실측) 에픽 자신만
 *   `key NOT IN` 으로 뺀다(사용자 선택 — 에픽은 묶음일 뿐 보고 대상이 아니다).
 * - ORDER BY 는 페이징 안정성용이다. 화면 정렬은 렌더러가 따로 한다.
 */
export function buildReportJql(q: JiraReportQuery): string {
  const custom = (q.jql ?? "").trim();
  if (custom) return custom;
  const keys = normalizeProjectKeys(q.projectKeys);
  const labels = normalizeLabels(q.labels);
  const epics = normalizeEpicKeys(q.epics);
  if (keys.length === 0 && labels.length === 0 && epics.length === 0) {
    throw new Error("프로젝트·레이블·에픽 중 하나 이상 고르세요.");
  }
  const clauses: string[] = [];
  if (keys.length > 0) clauses.push(`project IN (${keys.join(", ")})`);
  if (labels.length > 0) {
    clauses.push(`labels IN (${labels.map(jqlString).join(", ")})`);
  }
  if (epics.length > 0) {
    const list = epics.join(", ");
    clauses.push(`parentEpic IN (${list}) AND key NOT IN (${list})`);
  }
  const period = periodClause(q.period, q.dateField);
  if (period) clauses.push(period);
  return `${clauses.join(" AND ")} ORDER BY created ASC`;
}
