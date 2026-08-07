import { handleShared } from '../../lib/moIpc';
import {
  fetchIssueDetail,
  fetchMyIssues,
  getTransitions,
  resolveIssue,
  transitionIssue,
} from './jira';

/**
 * Jira(내 이슈) 관련 IPC 핸들러 등록.
 * 전부 `handleShared` — 데스크톱과 MO(폰)가 같은 핸들러를 쓴다 (순수 REST 호출이라 폰에서도 안전).
 */
export function registerJiraIpc() {
  // force=true 는 수동 새로고침·전환 직후 — TTL 캐시를 우회한다
  handleShared('jira:list', (force?: boolean) => fetchMyIssues(force === true));
  // 이슈 상세 — 본문·댓글 HTML (앱 내 패널 표시용)
  handleShared('jira:detail', (key: string) => fetchIssueDetail(key));
  handleShared('jira:transitions', (key: string) => getTransitions(key));
  handleShared('jira:transition', (key: string, id: string) =>
    transitionIssue(key, id),
  );
  // PR 머지 직후 원클릭 해결 처리 — 해결/완료 계열 전환 자동 선택
  handleShared('jira:resolve', (key: string) => resolveIssue(key));
}
