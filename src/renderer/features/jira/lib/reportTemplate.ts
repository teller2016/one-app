// 복사 템플릿 — `{key} {summary}` 같은 자리표시자를 티켓 값으로 바꾼다.
// 순수 함수라 vitest 로 검증한다(reportTemplate.test.ts). 폰 셸·단독 배포판도 같은 파일을 쓴다.
import type { JiraReportIssue } from '../../../../shared/types';
import { dayKey } from '../../../../shared/date';

export type TemplateVar = {
  name: string; // 자리표시자 이름 — `{name}`
  label: string; // 도움말 표시용
  get: (it: JiraReportIssue) => string;
};

/** ISO 시각 → "YYYY-MM-DD" (로컬). 비었거나 깨졌으면 빈 문자열 */
const isoToDay = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : dayKey(d);
};

/** 쓸 수 있는 자리표시자 전부 — 화면 도움말도 이 목록으로 그린다 */
export const TEMPLATE_VARS: TemplateVar[] = [
  { name: 'key', label: '티켓 번호', get: (it) => it.key },
  { name: 'summary', label: '티켓명', get: (it) => it.summary },
  { name: 'status', label: '상태', get: (it) => it.status },
  { name: 'type', label: '유형', get: (it) => it.issueType },
  { name: 'assignee', label: '담당자', get: (it) => it.assignee ?? '' },
  { name: 'reporter', label: '보고자', get: (it) => it.reporter ?? '' },
  { name: 'priority', label: '우선순위', get: (it) => it.priority ?? '' },
  { name: 'labels', label: '레이블(쉼표 구분)', get: (it) => it.labels.join(', ') },
  { name: 'project', label: '프로젝트 키', get: (it) => it.projectKey },
  { name: 'parent', label: '상위 항목 번호', get: (it) => it.parentKey ?? '' },
  { name: 'parentSummary', label: '상위 항목 제목', get: (it) => it.parentSummary ?? '' },
  { name: 'url', label: '링크', get: (it) => it.url },
  { name: 'created', label: '생성일', get: (it) => isoToDay(it.createdAt) },
  { name: 'resolved', label: '해결일', get: (it) => isoToDay(it.resolvedAt) },
  { name: 'updated', label: '갱신일', get: (it) => isoToDay(it.updatedAt) },
];

/** 기본 템플릿 — "SSB-111 티켓명" */
export const DEFAULT_TEMPLATE = '{key} {summary}';

/**
 * 자주 쓰는 형식 — 셀렉트로 고르면 템플릿 입력칸에 채워진다.
 * 맨 위 둘은 **한 항목만** 뽑는 형식이다(번호만·티켓명만 붙여넣는 경우 — 2026-09-03 사용자 요청).
 */
export const TEMPLATE_PRESETS: { label: string; template: string }[] = [
  { label: '번호', template: '{key}' },
  { label: '티켓명', template: '{summary}' },
  { label: '번호 티켓명', template: DEFAULT_TEMPLATE },
  { label: '번호 티켓명 (상태)', template: '{key} {summary} ({status})' },
  { label: '번호 · 티켓명 · 담당자 · 상태 (탭 구분)', template: '{key}\\t{summary}\\t{assignee}\\t{status}' },
  { label: '링크만', template: '{url}' },
];

/** `\t` `\n` 이스케이프를 실제 문자로 — 한 줄 입력칸에 탭·개행을 넣는 방법이라 이렇게 받는다 */
export function unescapeTemplate(template: string): string {
  return template.replace(/\\t/g, '\t').replace(/\\n/g, '\n');
}

const VAR_RE = /\{([a-zA-Z]+)\}/g;
const VAR_MAP = new Map(TEMPLATE_VARS.map((v) => [v.name.toLowerCase(), v]));

/** 티켓 하나 → 한 줄. 모르는 자리표시자는 그대로 둔다(오타를 눈으로 알아볼 수 있게) */
export function renderTemplateLine(template: string, it: JiraReportIssue): string {
  return unescapeTemplate(template).replace(VAR_RE, (whole, name: string) => {
    const v = VAR_MAP.get(name.toLowerCase());
    return v ? v.get(it) : whole;
  });
}

/** 여러 티켓 → 줄바꿈으로 이은 본문 (붙여넣기 대상) */
export function renderReport(template: string, issues: JiraReportIssue[]): string {
  return issues.map((it) => renderTemplateLine(template, it)).join('\n');
}
