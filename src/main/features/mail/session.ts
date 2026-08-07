// 메일 세션 — 공용 그룹웨어 세션(features/groupware/session.ts)의 쿠키에 메일 SPA(/mail2/)
// 부트스트랩과 내 메일 주소를 덧붙인 것. 개수·목록·본문 조회는 전부 순수 HTTP(fetch).
// 로그인은 공용 모듈이 담당하므로 여기서 브라우저를 띄우지 않는다(근태 등과 세션 공유).
import { MAIL_CONFIG } from './config';
// 전역 fetch 를 타임아웃 래퍼로 대체 — 소켓 hang 시 무한 대기 방지
import { fetchWithTimeout as fetch } from '../../lib/http';
import {
  getGroupwareSession,
  invalidateGroupwareSession,
  peekGroupwareSession,
} from '../groupware/session';

export type MailSession = {
  cookie: string; // "JSESSIONID=…; JSESSIONID=…"
  email: string; // 내 메일 주소 (id@domain)
  id: string;
  domain: string;
  establishedAt: number;
};

let cached: MailSession | null = null;
// 부트스트랩이 겹치면 하나의 establish 를 공유한다
let inFlight: Promise<MailSession> | null = null;

// 수립 실패 지수 백오프 — VPN 끊김 등으로 로그인이 실패하면 다음 시도를 점점 늦춘다.
// 없으면 위젯 30초 폴링이 실패할 때마다 Chrome 기동→30초 타임아웃을 무한 반복했다
// (2026-08-07 성능 감사). 백오프 중에는 Chrome 을 띄우지 않고 즉시 실패를 돌려준다.
let failCount = 0;
let retryAt = 0;
const BACKOFF_BASE_MS = 60_000;
const BACKOFF_MAX_MS = 15 * 60_000;

/** 메일 API 호출 공통 헤더 */
function headers(cookie: string, form: boolean): Record<string, string> {
  return {
    ...(form
      ? { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' }
      : {}),
    Cookie: cookie,
    'User-Agent': 'Mozilla/5.0',
    'X-Requested-With': 'XMLHttpRequest',
    Referer: `${MAIL_CONFIG.origin}/mail2/`,
  };
}

export async function mailPost(
  cookie: string,
  url: string,
  body: string,
): Promise<Response> {
  return fetch(url, { method: 'POST', headers: headers(cookie, true), body });
}

export async function mailGet(cookie: string, url: string): Promise<Response> {
  return fetch(url, { method: 'GET', headers: headers(cookie, false) });
}

/** 공용 세션 확보 → 이메일 파악(portlet) → /mail2/ 부트스트랩까지 한 번에 수립 */
async function establish(force: boolean): Promise<MailSession> {
  const gw = await getGroupwareSession(force);
  const cookie = gw.header;

  // 내 메일 주소 파악 — portlet 은 부트스트랩 없이 동작한다
  const pr = await mailPost(cookie, MAIL_CONFIG.endpoints.portlet, 'count=1&seen=N');
  const pj = (await pr.json()) as { email?: string };
  const email = pj.email ?? '';
  const at = email.indexOf('@');
  if (at < 0) {
    throw new Error('메일 계정 정보를 확인하지 못했습니다.');
  }
  const id = email.slice(0, at);
  const domain = email.slice(at + 1);

  // 메일 SPA 세션 부트스트랩 — 이 GET 이후에야 mail2 엔드포인트가 동작한다
  await mailGet(cookie, MAIL_CONFIG.endpoints.bootstrap);

  // establishedAt 은 공용 세션의 신원 — 이 값이 바뀌면 부트스트랩을 다시 해야 한다
  return { cookie, email, id, domain, establishedAt: gw.establishedAt };
}

/**
 * 유효한 메일 세션 확보 — 공용 세션이 그대로면 캐시(부트스트랩 결과)를 재사용하고,
 * 공용 세션이 새로 수립됐으면 그 쿠키로 부트스트랩을 다시 한다.
 *
 * 캐시 검증은 peek(TTL 무시)로 한다 — 폴링이 30초~3분마다 서버를 건드려 서버 세션은
 * 계속 살아 있으므로, 클라이언트 TTL 만료만으로 선제 재로그인하지 않는다. 서버에서
 * 실제로 만료되면 로그인 페이지 응답 → AuthError → force 경로가 재수립한다.
 */
export async function getSession(force = false): Promise<MailSession> {
  if (!force && cached) {
    const gw = peekGroupwareSession();
    if (gw && gw.establishedAt === cached.establishedAt) return cached;
  }
  if (inFlight) return inFlight;
  if (Date.now() < retryAt) {
    throw new Error('메일 세션 연결 실패 — 잠시 후 자동으로 다시 시도합니다.');
  }
  inFlight = establish(force)
    .then((s) => {
      cached = s;
      failCount = 0;
      retryAt = 0;
      return s;
    })
    .catch((err: unknown) => {
      failCount += 1;
      retryAt =
        Date.now() +
        Math.min(BACKOFF_BASE_MS * 2 ** (failCount - 1), BACKOFF_MAX_MS);
      throw err;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** 세션 무효화 — 인증 실패(로그인 페이지 응답) 감지 시 공용 세션까지 버린다 */
export function invalidateSession(): void {
  cached = null;
  invalidateGroupwareSession();
}

/**
 * 세션이 필요한 작업을 실행하되, 인증 실패로 판정되면 한 번만 재로그인 후 재시도한다.
 * fn 안에서 로그인 페이지/비정상 응답을 만나면 AuthError 를 throw 하도록 한다.
 */
export class AuthError extends Error {}

export async function withSession<T>(
  fn: (s: MailSession) => Promise<T>,
): Promise<T> {
  const s = await getSession();
  try {
    return await fn(s);
  } catch (err) {
    if (err instanceof AuthError) {
      invalidateSession();
      const fresh = await getSession(true);
      return fn(fresh);
    }
    throw err;
  }
}
