import { ipcMain } from 'electron';
import { fetchMyIssues, getTransitions, transitionIssue } from './jira';

/** Jira(내 이슈) 관련 IPC 핸들러 등록 */
export function registerJiraIpc() {
  ipcMain.handle('jira:list', () => fetchMyIssues());
  ipcMain.handle('jira:transitions', (_e, key: string) => getTransitions(key));
  ipcMain.handle('jira:transition', (_e, key: string, id: string) =>
    transitionIssue(key, id),
  );
}
