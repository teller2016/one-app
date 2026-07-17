import { ipcMain } from 'electron';
import { fetchMyIssues } from './jira';

/** Jira(내 이슈) 관련 IPC 핸들러 등록 */
export function registerJiraIpc() {
  ipcMain.handle('jira:list', () => fetchMyIssues());
}
