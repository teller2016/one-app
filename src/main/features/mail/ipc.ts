import { ipcMain, shell } from 'electron';
import { handleShared } from '../../lib/moIpc';
import { getBody, getInbox, getUnreadCount } from './mail';
import { MAIL_CONFIG } from './config';
import type { MailListQuery } from '../../../shared/types';

// 안읽은 수 캐시 — 위젯(30초)과 홈 카드(120초)가 같은 조회를 각자 폴링하므로
// 짧은 TTL + 동시 요청 공유로 그룹웨어 왕복을 반으로 줄인다(2026-08-07 성능 감사)
const UNREAD_TTL_MS = 15_000;
type UnreadResult = Awaited<ReturnType<typeof getUnreadCount>>;
let unreadCache: { at: number; res: UnreadResult } | null = null;
let unreadInFlight: Promise<UnreadResult> | null = null;

async function getUnreadCountCached(): Promise<UnreadResult> {
  if (unreadCache && Date.now() - unreadCache.at < UNREAD_TTL_MS) {
    return unreadCache.res;
  }
  if (unreadInFlight) return unreadInFlight;
  unreadInFlight = getUnreadCount()
    .then((res) => {
      if (res.ok) unreadCache = { at: Date.now(), res };
      return res;
    })
    .finally(() => {
      unreadInFlight = null;
    });
  return unreadInFlight;
}

/** 메일(비즈박스) 관련 IPC 핸들러 등록 */
export function registerMailIpc() {
  // 안읽은 수만 (위젯 폴링용 경량 — TTL 캐시로 중복 폴링 흡수)
  handleShared('mail:unread-count', () => getUnreadCountCached());
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
