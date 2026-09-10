import { ipcMain, shell } from 'electron';
import { handleShared } from '../../lib/moIpc';
import { getBody, getInbox, getUnreadCount } from './mail';
import { forgetAltSession, getAuthCode } from './authcode';
import {
  listAltAccounts,
  removeAltAccount,
  saveAltAccount,
} from './altAccounts';
import { MAIL_CONFIG } from './config';
import type { MailListQuery } from '../../../shared/types';

// 안읽은 수 캐시 — 위젯(30초)과 홈 카드(120초)가 같은 조회를 각자 폴링하므로
// 짧은 TTL + 동시 요청 공유로 그룹웨어 왕복을 반으로 줄인다(2026-08-07 성능 감사)
const UNREAD_TTL_MS = 15_000;
type UnreadResult = Awaited<ReturnType<typeof getUnreadCount>>;
let unreadCache: { at: number; res: UnreadResult } | null = null;
let unreadInFlight: Promise<UnreadResult> | null = null;
// 캐시 세대 — 무효화 뒤에 도착하는 "그 전에 나간" 조회 결과는 이미 옛 값이라 캐시에 앉히지 않는다
let unreadGen = 0;

/**
 * 안읽은 수 캐시 무효화 — 메일을 읽어 서버 카운트가 바뀐 직후에 부른다.
 * ⚠️ 안 비우면 위젯이 로컬에서 −1 한 뒤 도착하는 폴링이 캐시된 읽기 전 값을 되씌워
 *    "읽었는데 사이드바 카운트가 남는" 현상이 된다(2026-09-08 사용자 신고).
 */
function invalidateUnreadCache(): void {
  unreadCache = null;
  unreadInFlight = null; // 진행 중 조회는 읽기 전 값 — 새 요청을 거기에 합류시키지 않는다
  unreadGen += 1;
}

/** 다른 경로(목록 조회)가 방금 서버에서 받은 카운트로 캐시를 갱신 — 다음 폴링이 그 값을 쓴다 */
function primeUnreadCache(unreadCount: number): void {
  unreadCache = {
    at: Date.now(),
    res: { ok: true, configured: true, unreadCount },
  };
}

async function getUnreadCountCached(): Promise<UnreadResult> {
  if (unreadCache && Date.now() - unreadCache.at < UNREAD_TTL_MS) {
    return unreadCache.res;
  }
  if (unreadInFlight) return unreadInFlight;
  const gen = unreadGen;
  const p = getUnreadCount()
    .then((res) => {
      if (res.ok && gen === unreadGen) unreadCache = { at: Date.now(), res };
      return res;
    })
    .finally(() => {
      if (unreadInFlight === p) unreadInFlight = null;
    });
  unreadInFlight = p;
  return p;
}

/** 메일(비즈박스) 관련 IPC 핸들러 등록 */
export function registerMailIpc() {
  // 안읽은 수만 (위젯 폴링용 경량 — TTL 캐시로 중복 폴링 흡수)
  handleShared('mail:unread-count', () => getUnreadCountCached());
  // 메일 목록 — 안읽은 수 + 폴더(받은편지함·스팸)의 요청 페이지 목록.
  // 같은 getMailBoxCount 를 방금 떠 왔으므로 그 카운트로 위젯 캐시도 최신으로 맞춘다
  handleShared('mail:inbox', async (query?: MailListQuery) => {
    const res = await getInbox(query);
    if (res.ok) primeUnreadCache(res.unreadCount);
    return res;
  });
  // 본문 조회 (unread=true 면 열 때 읽음 처리) — 읽음 처리됐으면 안읽은 수 캐시를 버린다
  handleShared('mail:body', async (muid: number, unread: boolean) => {
    const res = await getBody(muid, unread);
    if (unread && res.ok) invalidateUnreadCache();
    return res;
  });
  // 브라우저로 비즈박스 메일함 바로 열기 (SPA 진입점)
  ipcMain.handle('mail:open-web', async () => {
    await shell.openExternal(MAIL_CONFIG.webUrl);
    return { ok: true };
  });

  // ── 팀 공용 계정 인증코드 (피그마) ──
  // 조회 둘은 폰(MO)에도 연다 — 폰 메일 탭의 [인증코드] 가 같은 패널(AuthCodePanel)을 마운트하는데,
  // 2026-09-10 까지는 채널이 닫혀 있어 탭을 누르는 순간 메일 탭 전체가 오류 카드가 됐다.
  // 계정 목록은 loginId 만 나가고, 코드 조회는 맥에서 로그인해 결과 문자열만 돌려준다
  // (피그마 코드를 폰에서 받아 붙이는 실사용 흐름).
  handleShared('mail:authcode:accounts', () => listAltAccounts());
  handleShared('mail:authcode:fetch', (loginId: string) => getAuthCode(loginId));

  // ⚠️ 등록·삭제는 `handleShared` 가 아니다 — 비밀번호를 받는 쓰기 채널이라 MO(폰) 셸에는
  //    열지 않는다(등록 화면 자체가 환경설정 = 데스크톱 전용).
  ipcMain.handle(
    'mail:authcode:save-account',
    (_e, loginId: string, password: string) => {
      try {
        const accounts = saveAltAccount(loginId, password);
        // 비밀번호가 바뀌었을 수 있으니 캐시된 세션을 버린다
        forgetAltSession(loginId);
        return { ok: true, accounts };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  ipcMain.handle('mail:authcode:remove-account', (_e, loginId: string) => {
    forgetAltSession(loginId);
    return { ok: true, accounts: removeAltAccount(loginId) };
  });
}
