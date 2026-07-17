import type { JiraIssue } from '../../../../shared/types';

/**
 * 해결 상태 판별 — 카테고리가 done 이거나, 이름이 해결/완료 계열이면 해결로 본다.
 * (이 팀 워크플로우는 '해결됨' 상태가 카테고리상 '진행 중'이라 이름 휴리스틱 병행)
 */
export const isDone = (it: JiraIssue) =>
  it.statusCategory === 'done' ||
  /해결|완료|resolved|done|closed/i.test(it.status);
