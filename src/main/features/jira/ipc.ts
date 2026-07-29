import { ipcMain } from 'electron';
import {
  fetchIssueDetail,
  fetchMyIssues,
  getTransitions,
  resolveIssue,
  transitionIssue,
} from './jira';

/** Jira(내 이슈) 관련 IPC 핸들러 등록 */
export function registerJiraIpc() {
  ipcMain.handle('jira:list', () => fetchMyIssues());
  // 이슈 상세 — 본문·댓글 HTML (앱 내 패널 표시용)
  ipcMain.handle('jira:detail', (_e, key: string) => fetchIssueDetail(key));
  ipcMain.handle('jira:transitions', (_e, key: string) => getTransitions(key));
  ipcMain.handle('jira:transition', (_e, key: string, id: string) =>
    transitionIssue(key, id),
  );
  // PR 머지 직후 원클릭 해결 처리 — 해결/완료 계열 전환 자동 선택
  ipcMain.handle('jira:resolve', (_e, key: string) => resolveIssue(key));
}
