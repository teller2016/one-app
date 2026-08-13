// 메일 조회 — 세션(session.ts)의 쿠키로 그룹웨어 메일 API 를 직접 호출한다.
// getInbox: 안읽은 수(뱃지) + 받은편지함 최근 목록 / getBody: 본문(HTML)
import { MAIL_CONFIG } from './config';
import {
  AuthError,
  mailBoxCountParams,
  mailGet,
  mailListParams,
  mailPost,
  withSession,
  type MailSession,
} from './session';
import {
  decodeEntities,
  looksLikeLogin,
  parseDate,
  parseJson,
} from './parse';
import { getCredentials } from '../settings/store';
import { sanitizeHtml } from '../../lib/sanitize';
import type {
  MailBody,
  MailBodyResult,
  MailFolder,
  MailFolderUnread,
  MailInboxResult,
  MailItem,
  MailListQuery,
  MailUnreadCountResult,
} from '../../../shared/types';

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

/**
 * 뱃지 안읽음 수 — 폴더별 unseen 합(보낸·임시·휴지통 제외, **스팸 포함**).
 * 서버의 allunseen 은 스팸을 빼고 집계하므로 그 값을 쓰지 않고 직접 합산한다
 * (allunseen 에 스팸을 더하는 방식은 서버 집계 규칙이 바뀌면 이중 집계가 된다).
 */
function sumUnread(boxes: NonNullable<BoxCountResp['mailboxList']>): number {
  return boxes
    .filter(
      (m) =>
        !MAIL_CONFIG.unreadExcludedBoxes.includes((m.name ?? '').toUpperCase()),
    )
    .reduce((acc, m) => acc + (Number(m.unseen) || 0), 0);
}

/**
 * 폴더별 개수 조회 — 안읽음 수(뱃지)·폴더별 mboxSeq·폴더별 안읽음 수를 함께 반환.
 * 폴더별 안읽음(`folderUnread`)은 이미 받은 mailboxList 에서 뽑으므로 추가 왕복이 없다
 * (리더 모달 세그먼트에서 탭을 전환하기 전에 안읽음 유무를 보여주는 용도).
 */
async function fetchBoxCount(s: MailSession): Promise<{
  unreadCount: number;
  inboxSeq: number;
  spamSeq: number;
  folderUnread: MailFolderUnread;
}> {
  const countRes = await mailPost(
    s.cookie,
    MAIL_CONFIG.endpoints.boxCount,
    mailBoxCountParams(s),
  );
  const count = await parseJson<BoxCountResp>(countRes);
  const boxes = count.mailboxList ?? [];
  const findBox = (name: string) =>
    boxes.find((m) => m.name?.toUpperCase() === name);
  const inbox = findBox(MAIL_CONFIG.inboxName);
  const spam = findBox(MAIL_CONFIG.spamName);
  return {
    // 폴더 목록이 비어 오면(응답 형식 변경 등) 서버 집계값으로 폴백
    unreadCount: boxes.length ? sumUnread(boxes) : Number(count.allunseen ?? 0),
    inboxSeq: Number(inbox?.mboxSeq ?? MAIL_CONFIG.inboxSeqFallback),
    spamSeq: Number(spam?.mboxSeq ?? MAIL_CONFIG.spamSeqFallback),
    folderUnread: {
      inbox: Number(inbox?.unseen) || 0,
      spam: Number(spam?.unseen) || 0,
    },
  };
}

/**
 * 안읽은 메일 수만 조회 (위젯 폴링용 경량) — 목록 없이 getMailBoxCount 한 번.
 * 세션이 캐시돼 있으면 단일 POST 라 자주 호출해도 부담이 적다.
 */
export async function getUnreadCount(): Promise<MailUnreadCountResult> {
  if (!getCredentials()) {
    return { ok: false, configured: false, unreadCount: 0 };
  }
  try {
    return await withSession(async (s) => {
      const { unreadCount } = await fetchBoxCount(s);
      return { ok: true, configured: true, unreadCount };
    });
  } catch (err) {
    return {
      ok: false,
      configured: true,
      unreadCount: 0,
      error: `안읽은 메일 수 조회 실패 — ${(err as Error).message}`,
    };
  }
}

/**
 * 메일 목록 조회 — 안읽은 총 수(뱃지) + 폴더(받은편지함·스팸메일함)의 요청 페이지 목록.
 * 계정 미설정이면 configured:false 로 조용히 반환한다(배너 안내용).
 * 과거 메일은 page 를 올려 조회한다(서버 페이징 — TotalRecordCount 로 전체 건수 확인).
 */
export async function getInbox(
  query: MailListQuery = {},
): Promise<MailInboxResult> {
  const folder: MailFolder = query.folder ?? 'inbox';
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const pageSize = Math.min(200, Math.max(1, Math.trunc(query.pageSize ?? 30)));

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
      // 1) 폴더별 개수 — 안읽음 합(뱃지) + 폴더 mboxSeq + 폴더별 안읽음
      const { unreadCount, inboxSeq, spamSeq, folderUnread } =
        await fetchBoxCount(s);

      // 2) 대상 폴더의 해당 페이지 목록
      const listRes = await mailPost(
        s.cookie,
        MAIL_CONFIG.endpoints.list,
        mailListParams(
          s,
          folder === 'spam' ? spamSeq : inboxSeq,
          page,
          pageSize,
        ),
      );
      const list = await parseJson<MailListResp>(listRes);
      const items: MailItem[] = (list.Records ?? []).map((r) => ({
        muid: r.muid,
        subject: decodeEntities(r.subject?.trim() || '(제목 없음)'),
        from: decodeEntities(r.mail_from?.trim() || ''),
        date: parseDate(r.rfc822date),
        // bizbox seen: 1 = 읽음, 0 = 안읽음
        seen: Number(r.seen) === 1,
        hasAttach: !!r.attach,
        size: Number(r.size ?? 0),
      }));

      return {
        ok: true,
        configured: true,
        unreadCount,
        folderUnread,
        items,
        total: Number(list.TotalRecordCount ?? items.length) || items.length,
        page,
      };
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
        subject: decodeEntities(dm.subject?.trim() || '(제목 없음)'),
        from: decodeEntities(dm.from?.trim() || ''),
        to: decodeEntities(dm.to?.trim() || ''),
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
