import { ipcMain, shell } from 'electron';
import { getBody, getInbox } from './mail';
import { MAIL_CONFIG } from './config';

/** 메일(비즈박스) 관련 IPC 핸들러 등록 */
export function registerMailIpc() {
  // 받은편지함 — 안읽은 수 + 최근 목록
  ipcMain.handle('mail:inbox', (_e, limit?: number) => getInbox(limit));
  // 본문 조회 (unread=true 면 열 때 읽음 처리)
  ipcMain.handle('mail:body', (_e, muid: number, unread: boolean) =>
    getBody(muid, unread),
  );
  // 브라우저로 비즈박스 메일함 바로 열기 (SPA 진입점)
  ipcMain.handle('mail:open-web', async () => {
    await shell.openExternal(MAIL_CONFIG.webUrl);
    return { ok: true };
  });
}
