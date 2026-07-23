// 메일 세션 — 그룹웨어에 headless 로 1회 로그인해 쿠키를 확보하고, 메일 SPA(/mail2/)를
// 부트스트랩한 뒤 그 세션을 재사용한다. 이후 개수·목록·본문 조회는 전부 순수 HTTP(fetch).
// (근태·주간보고가 매 호출마다 브라우저를 띄우는 것과 달리, 로그인 1회 → 쿠키 재사용이라 가볍다.)
import puppeteer, { type Dialog, type Page } from 'puppeteer';
import { MAIL_CONFIG } from './config';
import { getCredentials } from '../settings/store';
// 전역 fetch 를 타임아웃 래퍼로 대체 — 소켓 hang 시 무한 대기 방지
import { fetchWithTimeout as fetch } from '../../lib/http';
import { sleep } from '../../lib/util';

export type MailSession = {
  cookie: string; // "JSESSIONID=…; JSESSIONID=…"
  email: string; // 내 메일 주소 (id@domain)
  id: string;
  domain: string;
  establishedAt: number;
};

let cached: MailSession | null = null;
// 로그인은 무거우니 동시 요청이 겹치면 하나의 establish 를 공유한다
let inFlight: Promise<MailSession> | null = null;

/** 저장된 비즈박스 계정으로 headless 로그인 → forbiz 쿠키 문자열 반환 */
async function loginForCookie(): Promise<string> {
  const cred = getCredentials();
  if (!cred) {
    throw new Error(
      '비즈박스 계정이 없습니다 — 환경설정에서 ID·비밀번호를 입력하세요.',
    );
  }
  const { selectors: sel } = MAIL_CONFIG;
  const browser = await puppeteer.launch({
    headless: 'new' as const,
    channel: 'chrome',
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    page.on('dialog', (d: Dialog): void => {
      d.dismiss().catch((): void => {
        // 이미 닫힌 다이얼로그면 무시
      });
    });

    await page.goto(MAIL_CONFIG.loginUrl, { waitUntil: 'networkidle2' });
    if (await page.$(sel.userId)) {
      await page.type(sel.userId, cred.id);
      await page.type(sel.userPw, cred.password);
      await Promise.all([
        page
          .waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 })
          .catch((): null => null),
        page.click(sel.loginSubmit),
      ]);
      await sleep(1500); // 추가 리다이렉트 정리 대기
    }
    // 포털 메인 방문 — 세션 안정화 (로그인 페이지로 튕기면 실패)
    await page
      .goto(MAIL_CONFIG.mainUrl, { waitUntil: 'networkidle2', timeout: 30000 })
      .catch((): void => undefined);
    if (page.url().includes('egovLoginUsr')) {
      throw new Error('그룹웨어 로그인 실패 — 환경설정의 계정 정보를 확인하세요.');
    }
    return await readCookie(page);
  } finally {
    try {
      await browser.close();
    } catch {
      // 이미 닫혔으면 무시
    }
  }
}

/** 현재 페이지의 forbiz 도메인 쿠키를 "name=value; …" 헤더 문자열로 */
async function readCookie(page: Page): Promise<string> {
  const client = await page.target().createCDPSession();
  const { cookies } = await client.send('Network.getAllCookies');
  return cookies
    .filter((c) => c.domain.includes('forbiz'))
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
}

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

/** 로그인 → 이메일 파악(portlet) → /mail2/ 부트스트랩까지 한 번에 수립 */
async function establish(): Promise<MailSession> {
  const cookie = await loginForCookie();

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

  return { cookie, email, id, domain, establishedAt: Date.now() };
}

/** 유효한 메일 세션 확보 (TTL 안이면 캐시 재사용, 아니면 새로 수립) */
export async function getSession(force = false): Promise<MailSession> {
  if (
    !force &&
    cached &&
    Date.now() - cached.establishedAt < MAIL_CONFIG.sessionTtlMs
  ) {
    return cached;
  }
  if (inFlight) return inFlight;
  inFlight = establish()
    .then((s) => {
      cached = s;
      return s;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** 세션 무효화 — 인증 실패(로그인 페이지 응답) 감지 시 호출해 다음 요청에 재로그인 */
export function invalidateSession(): void {
  cached = null;
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
