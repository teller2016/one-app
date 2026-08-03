import { ipcMain, shell } from 'electron';
import { handleShared } from '../../lib/moIpc';
import { getBody, getInbox, getUnreadCount } from './mail';
import { MAIL_CONFIG } from './config';
import type { MailListQuery } from '../../../shared/types';

/** 메일(비즈박스) 관련 IPC 핸들러 등록 */
export function registerMailIpc() {
  // 안읽은 수만 (위젯 폴링용 경량)
  handleShared('mail:unread-count', () => getUnreadCount());
  // 메일 목록 — 안읽은 수 + 폴더(받은편지함·스팸)의 요청 페이지 목록
  handleShared('mail:inbox', (query?: MailListQuery) => getInbox(query));
  // 본문 조회 (unread=true 면 열 때 읽음 처리)
  handleShared('mail:body', (muid: number, unread: boolean) =>
    getBody(muid, unread),
  );
  // 브라우저로 비즈박스 메일함 바로 열기 (SPA 진입점)
  ipcMain.handle('mail:open-web', async () => {
    await shell.openExternal(MAIL_CONFIG.webUrl);
    return { ok: true };
  });
}
