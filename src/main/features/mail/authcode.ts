// 팀 공용 계정의 피그마 인증코드 조회 — 메일 목록에서 인증 메일만 골라 본문에서 코드를 뽑는다.
//
// **왜 별도 세션인가**: 공용 세션(`groupware/session.ts`)은 환경설정의 내 계정 전용이다.
// 팀 공용 계정으로 로그인하려면 별도 파티션·별도 캐시가 필요하다(`loginWithAccount`).
//
// ⚠️ **읽음 상태를 건드리지 않는다** — 팀원들이 함께 보는 메일함이라, 읽음 처리를 겸하는
//    `readMail.do` 를 쓰지 않고 `readMailCont.do` 만 GET 한다(2026-08-13 실측으로 확인).
import { MAIL_CONFIG } from './config';
import { getAltAccountCred } from './altAccounts';
import {
  decodeEntities,
  htmlToText,
  looksLikeLogin,
  parseDate,
  parseJson,
} from './parse';
import {
  AuthError,
  bootstrapMail,
  mailBoxCountParams,
  mailGet,
  mailListParams,
  mailPost,
  type MailIdentity,
} from './session';
import { loginWithAccount } from '../groupware/session';
import type { AuthCodeResult } from '../../../shared/types';

/** 계정별 메일 세션 — 로그인이 무거우니 메모리에만 캐시한다(디스크에 남기지 않는다) */
type AltSession = MailIdentity & { cookie: string; at: number };

const SESSION_TTL_MS = 15 * 60 * 1000;
const sessions = new Map<string, AltSession>();
// 같은 계정에 동시 요청이 겹치면 하나의 로그인을 공유한다(그룹웨어는 동시 로그인을 거부한다)
const inFlight = new Map<string, Promise<AltSession>>();

/** 세션 캐시 폐기 — 계정을 지우거나 비밀번호를 바꿨을 때 호출한다 */
export function forgetAltSession(loginId: string): void {
  sessions.delete(loginId);
}

async function establishAlt(loginId: string): Promise<AltSession> {
  const cred = getAltAccountCred(loginId);
  if (!cred) {
    throw new Error(`저장된 계정 정보가 없습니다 — ${loginId}`);
  }
  const gw = await loginWithAccount(cred);
  const identity = await bootstrapMail(gw.header);
  return { ...identity, cookie: gw.header, at: Date.now() };
}

async function getAltSession(
  loginId: string,
  force: boolean,
): Promise<AltSession> {
  if (!force) {
    const cached = sessions.get(loginId);
    if (cached && Date.now() - cached.at < SESSION_TTL_MS) return cached;
  }
  const pending = inFlight.get(loginId);
  if (pending) return pending;

  const task = establishAlt(loginId)
    .then((s) => {
      sessions.set(loginId, s);
      return s;
    })
    .finally(() => {
      inFlight.delete(loginId);
    });
  inFlight.set(loginId, task);
  return task;
}

/** 세션이 서버에서 만료돼 AuthError 가 나면 1회 재로그인 후 재시도한다 */
async function withAltSession<T>(
  loginId: string,
  fn: (s: AltSession) => Promise<T>,
): Promise<T> {
  const s = await getAltSession(loginId, false);
  try {
    return await fn(s);
  } catch (err) {
    if (err instanceof AuthError) {
      sessions.delete(loginId);
      return fn(await getAltSession(loginId, true));
    }
    throw err;
  }
}

type BoxCountResp = {
  mailboxList?: { name?: string; mboxSeq?: number | string }[];
};

type ListResp = {
  Records?: {
    muid: number;
    subject?: string;
    mail_from?: string;
    rfc822date?: string;
  }[];
};

/**
 * 본문 평문에서 인증코드를 뽑는다.
 *
 * ⚠️ 반환은 **문자열**이다 — 코드가 0으로 시작할 수 있어(실측 `0432458`) 숫자로 바꾸면 깨진다.
 * 문맥("이 코드를 입력하여 …") 기반 추출을 먼저 쓰고, 안 잡히면 자릿수 폴백으로 내려간다.
 */
function extractCode(text: string): string | null {
  const { codeContext, codeFallback } = MAIL_CONFIG.authCode;
  const ctx = text.match(codeContext);
  // 문맥 정규식이 한국어·영어 두 갈래라 잡힌 캡처가 1번일 수도 2번일 수도 있다
  const fromContext = ctx?.[1] ?? ctx?.[2];
  if (fromContext) return fromContext;
  return text.match(codeFallback)?.[0] ?? null;
}

/** 받은편지함에서 가장 최근 인증 메일을 찾아 본문의 코드를 반환 */
async function readLatestCode(s: AltSession): Promise<AuthCodeResult> {
  const cfg = MAIL_CONFIG.authCode;

  // 1) 받은편지함 mboxSeq — ⚠️ 계정마다 값이 다르다(내 계정 1977 / zeplin_fe1 1990)
  const boxRes = await mailPost(
    s.cookie,
    MAIL_CONFIG.endpoints.boxCount,
    mailBoxCountParams(s),
  );
  const boxes = (await parseJson<BoxCountResp>(boxRes)).mailboxList ?? [];
  const inbox = boxes.find(
    (m) => m.name?.toUpperCase() === MAIL_CONFIG.inboxName,
  );
  const inboxSeq = Number(inbox?.mboxSeq ?? MAIL_CONFIG.inboxSeqFallback);

  // 2) 최근 목록에서 인증 메일만 고른다 — 발신자·제목을 모두 만족해야 한다
  const listRes = await mailPost(
    s.cookie,
    MAIL_CONFIG.endpoints.list,
    mailListParams(s, inboxSeq, 1, cfg.scanCount),
  );
  const records = (await parseJson<ListResp>(listRes)).Records ?? [];
  const latest = records
    .map((r) => ({
      muid: r.muid,
      subject: decodeEntities(r.subject?.trim() || ''),
      from: decodeEntities(r.mail_from?.trim() || ''),
      date: parseDate(r.rfc822date),
    }))
    .filter(
      (m) => cfg.fromPattern.test(m.from) && cfg.subjectPattern.test(m.subject),
    )
    // 응답이 최신순으로 오지만 순서에 기대지 않는다
    .sort((a, b) => b.date - a.date)[0];

  if (!latest) {
    return {
      ok: false,
      error: `최근 메일 ${cfg.scanCount}건에 피그마 인증 메일이 없습니다 — 피그마에서 코드를 다시 보내보세요.`,
    };
  }

  // 3) 본문에서 코드 — readMailCont 만 GET 하므로 읽음 상태가 바뀌지 않는다
  const contRes = await mailGet(
    s.cookie,
    `${MAIL_CONFIG.endpoints.readCont}?email=${encodeURIComponent(s.email)}&uid=${latest.muid}`,
  );
  const html = await contRes.text();
  if (looksLikeLogin(html)) throw new AuthError('세션이 만료되었습니다.');

  const code = extractCode(htmlToText(html));
  if (!code) {
    return {
      ok: false,
      error:
        '인증 메일에서 코드를 찾지 못했습니다 — 메일 형식이 바뀌었을 수 있습니다.',
    };
  }

  return {
    ok: true,
    code,
    receivedAt: latest.date,
    subject: latest.subject,
    // 이 계정엔 인증 메일이 하루 여러 통 온다 — 오래된 코드면 만료 경고를 붙여 보낸다
    stale: Date.now() - latest.date > cfg.freshMs,
  };
}

/** 지정한 팀 공용 계정의 최신 피그마 인증코드를 가져온다 */
export async function getAuthCode(loginId: string): Promise<AuthCodeResult> {
  try {
    return await withAltSession(loginId, readLatestCode);
  } catch (err) {
    return {
      ok: false,
      error: `인증코드를 가져오지 못했습니다 — ${(err as Error).message}`,
    };
  }
}
