// 메일 조회 — 세션(session.ts)의 쿠키로 그룹웨어 메일 API 를 직접 호출한다.
// getInbox: 안읽은 수(뱃지) + 받은편지함 최근 목록 / getBody: 본문(HTML)
import { MAIL_CONFIG } from './config';
import {
  AuthError,
  mailGet,
  mailPost,
  withSession,
  type MailSession,
} from './session';
import { getCredentials } from '../settings/store';
import type {
  MailBody,
  MailBodyResult,
  MailInboxResult,
  MailItem,
} from '../../../shared/types';

/** 응답 텍스트가 로그인 페이지(세션 만료)인지 — 그러면 재로그인 유도 */
function looksLikeLogin(text: string): boolean {
  return /egovLoginUsr|actionLogin|<title>[^<]*로그인/i.test(text);
}

/** JSON 응답 파싱 (text/plain 로 오는 경우 포함). 로그인 페이지면 AuthError */
async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    if (looksLikeLogin(text)) throw new AuthError('세션이 만료되었습니다.');
    throw new Error('메일 서버 응답을 해석하지 못했습니다.');
  }
}

type BoxCountResp = {
  allunseen?: number | string;
  mailboxList?: {
    name?: string;
    mboxSeq?: number | string;
    unseen?: number | string;
  }[];
};

type MailListResp = {
  TotalRecordCount?: number;
  Records?: {
    muid: number;
    subject?: string;
    mail_from?: string;
    seen?: number | string;
    attach?: boolean;
    size?: number;
    rfc822date?: string;
  }[];
};

/** getMailList 파라미터 — seen=false&flag=false 가 빠지면 서버가 빈 목록을 반환한다(정찰 확인) */
function listParams(s: MailSession, mboxSeq: number, pageSize: number): string {
  return [
    'page=1',
    `pageSize=${pageSize}`,
    'sortField=',
    'sortType=',
    'seen=false',
    'flag=false',
    `id=${encodeURIComponent(s.id)}`,
    `domain=${encodeURIComponent(s.domain)}`,
    `mboxSeq=${mboxSeq}`,
    'sort=',
    'listType=',
    'showType=',
    'externalSeq=undefined',
  ].join('&');
}

/** "2026-07-21 10:21:16" → epoch ms (실패 시 0) */
function parseDate(raw?: string): number {
  if (!raw) return 0;
  const ms = Date.parse(raw.replace(' ', 'T'));
  return Number.isNaN(ms) ? Date.parse(raw) || 0 : ms;
}

/**
 * 받은편지함 조회 — 안읽은 총 수(뱃지) + 최근 메일 목록.
 * 계정 미설정이면 configured:false 로 조용히 반환한다(배너 안내용).
 */
export async function getInbox(limit = 30): Promise<MailInboxResult> {
  if (!getCredentials()) {
    return {
      ok: false,
      configured: false,
      unreadCount: 0,
      error: '환경설정에서 비즈박스 ID·비밀번호를 입력하세요.',
    };
  }

  try {
    return await withSession(async (s) => {
      // 1) 폴더별 개수 — allunseen(뱃지) + INBOX mboxSeq
      const countRes = await mailPost(
        s.cookie,
        MAIL_CONFIG.endpoints.boxCount,
        `id=${encodeURIComponent(s.id)}&domain=${encodeURIComponent(s.domain)}&isExternal=false&isApproval=false`,
      );
      const count = await parseJson<BoxCountResp>(countRes);
      const inbox = (count.mailboxList ?? []).find(
        (m) => m.name === MAIL_CONFIG.inboxName,
      );
      const mboxSeq = Number(inbox?.mboxSeq ?? MAIL_CONFIG.inboxSeqFallback);
      const unreadCount = Number(count.allunseen ?? 0);

      // 2) 받은편지함 최근 목록
      const listRes = await mailPost(
        s.cookie,
        MAIL_CONFIG.endpoints.list,
        listParams(s, mboxSeq, limit),
      );
      const list = await parseJson<MailListResp>(listRes);
      const items: MailItem[] = (list.Records ?? []).map((r) => ({
        muid: r.muid,
        subject: r.subject?.trim() || '(제목 없음)',
        from: r.mail_from?.trim() || '',
        date: parseDate(r.rfc822date),
        // bizbox seen: 1 = 읽음, 0 = 안읽음
        seen: Number(r.seen) === 1,
        hasAttach: !!r.attach,
        size: Number(r.size ?? 0),
      }));

      return { ok: true, configured: true, unreadCount, items };
    });
  } catch (err) {
    return {
      ok: false,
      configured: true,
      unreadCount: 0,
      error: `메일을 불러오지 못했습니다 — ${(err as Error).message}`,
    };
  }
}

type ReadMetaResp = {
  decodeMime?: { date?: string; subject?: string; from?: string; to?: string };
};

/** 위험 태그·인라인 스크립트·이벤트 핸들러 제거 (sandbox iframe 과 함께 이중 방어) */
function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<(object|embed|applet|link|meta|base|form)\b[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
    .replace(/javascript:/gi, '');
}

/**
 * 메일 본문 조회 — readMail(메타: 제목·발신·수신·일시) + readMailCont(HTML 본문).
 * unread(안읽음)인 메일을 열면 그룹웨어에서도 읽음 처리된다(웹에서 여는 것과 동일 동작).
 */
export async function getBody(
  muid: number,
  unread: boolean,
): Promise<MailBodyResult> {
  try {
    return await withSession(async (s) => {
      const enc = encodeURIComponent(s.email);
      // 그룹웨어 readMail 규칙: 안읽음이면 seen=true(=지금 읽음 처리), 읽음이면 seen=false
      const seenParam = unread ? 'true' : 'false';
      const metaRes = await mailPost(
        s.cookie,
        MAIL_CONFIG.endpoints.readMeta,
        `email=${enc}&uid=${muid}&seen=${seenParam}`,
      );
      const meta = await parseJson<ReadMetaResp>(metaRes);
      const dm = meta.decodeMime ?? {};

      const contRes = await mailGet(
        s.cookie,
        `${MAIL_CONFIG.endpoints.readCont}?email=${enc}&uid=${muid}`,
      );
      const rawHtml = await contRes.text();
      if (looksLikeLogin(rawHtml)) throw new AuthError('세션이 만료되었습니다.');

      const body: MailBody = {
        muid,
        subject: dm.subject?.trim() || '(제목 없음)',
        from: dm.from?.trim() || '',
        to: dm.to?.trim() || '',
        date: dm.date?.trim() || '',
        html: sanitizeHtml(rawHtml),
        webUrl: MAIL_CONFIG.webUrl,
      };
      return { ok: true, body };
    });
  } catch (err) {
    return {
      ok: false,
      error: `본문을 불러오지 못했습니다 — ${(err as Error).message}`,
    };
  }
}
