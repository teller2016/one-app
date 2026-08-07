// 그룹웨어 세션 공용 인프라 — 로그인 1회로 확보한 쿠키를 여러 기능이 함께 쓴다.
//
// 로그인 자체는 headless 브라우저가 필요하다(비밀번호를 페이지 JS 가 암호화해 전송하므로
// 순수 Node 로그인 불가). 하지만 확보한 쿠키는 두 방향으로 모두 재사용된다.
//   ① 순수 HTTP 호출 — 메일 API (Cookie 헤더)
//   ② 다른 브라우저에 주입 — 근태 등 페이지 함수가 필요한 기능 (Network.setCookies)
// ②가 실제로 통함을 실측했다(2026-07-30): 주입 후 userMain.do 직행 시 로그인 화면으로
// 튕기지 않고 근태 위젯까지 정상 판독, 소요 1.3초 vs 로그인 경로 4.5초.
//
// ⚠️ 쿠키는 이름이 같고 경로만 다른 JSESSIONID 가 2개(`/gw`, `/`)다. 그래서 합친 문자열이
// 아니라 도메인·경로가 붙은 객체 목록을 정본으로 보관하고, HTTP 용 헤더는 파생값으로 만든다.
import puppeteer, { type Dialog, type Page } from 'puppeteer';
import { GROUPWARE_CONFIG } from './config';
import { getCredentials } from '../settings/store';
import { sleep } from '../../lib/util';
import { withGroupwareLogin } from '../../lib/groupware';

/** 주입 가능한 형태의 쿠키 (도메인·경로 유지) */
export type GroupwareCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
};

export type GroupwareSession = {
  cookies: GroupwareCookie[]; // 브라우저 주입용 (정본)
  header: string; // 순수 HTTP 호출용 "name=value; …"
  establishedAt: number; // 이 세션의 신원 — 파생 캐시(메일 등)의 유효성 판단에 쓴다
};

let cached: GroupwareSession | null = null;
// 로그인은 무거우니 동시 요청이 겹치면 하나의 로그인을 공유한다
let inFlight: Promise<GroupwareSession> | null = null;

/** 응답/페이지가 로그인 화면인지 */
export function isLoginUrl(url: string): boolean {
  return url.includes('egovLoginUsr');
}

/** headless 로그인 → 도메인·경로가 붙은 쿠키 목록 확보 */
async function login(): Promise<GroupwareSession> {
  const cred = getCredentials();
  if (!cred) {
    throw new Error(
      '비즈박스 계정이 없습니다 — 환경설정에서 ID·비밀번호를 입력하세요.',
    );
  }
  const { selectors: sel } = GROUPWARE_CONFIG;

  // 다른 경로(일정 매크로 등)의 로그인과 겹치면 서버가 한쪽을 거부하므로 큐를 경유한다
  return withGroupwareLogin(async () => {
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

      await page.goto(GROUPWARE_CONFIG.loginUrl, { waitUntil: 'networkidle2' });
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
        .goto(GROUPWARE_CONFIG.mainUrl, {
          waitUntil: 'networkidle2',
          timeout: 30000,
        })
        .catch((): void => undefined);
      if (isLoginUrl(page.url())) {
        throw new Error(
          '그룹웨어 로그인 실패 — 환경설정의 계정 정보를 확인하세요.',
        );
      }

      const cookies = await readCookies(page);
      return {
        cookies,
        header: cookies.map((c) => `${c.name}=${c.value}`).join('; '),
        establishedAt: Date.now(),
      };
    } finally {
      try {
        await browser.close();
      } catch {
        // 이미 닫혔으면 무시
      }
    }
  });
}

/** 현재 브라우저의 forbiz 쿠키를 도메인·경로까지 담아 읽는다 */
async function readCookies(page: Page): Promise<GroupwareCookie[]> {
  const client = await page.target().createCDPSession();
  const { cookies } = await client.send('Network.getAllCookies');
  return cookies
    .filter((c) => c.domain.includes('forbiz'))
    .map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
    }));
}

/** 유효한 세션 확보 (TTL 안이면 캐시 재사용, 아니면 로그인) */
export async function getGroupwareSession(
  force = false,
): Promise<GroupwareSession> {
  if (
    !force &&
    cached &&
    Date.now() - cached.establishedAt < GROUPWARE_CONFIG.sessionTtlMs
  ) {
    return cached;
  }
  if (inFlight) return inFlight;
  inFlight = login()
    .then((s) => {
      cached = s;
      return s;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** 세션 무효화 — 서버에서 만료됐다고 판단되면 호출해 다음 요청에 재로그인 */
export function invalidateGroupwareSession(): void {
  cached = null;
}

/**
 * 캐시된 세션을 TTL 검사 없이 들여다본다 — 재로그인(Chrome 기동)을 유발하지 않는다.
 * 폴링류 소비자(메일)가 "공용 세션이 갈렸는지" 신원만 비교할 때 쓴다. 유효성 판정은
 * 실제 응답(로그인 페이지 감지 → invalidate → AuthError 재수립)이 담당한다.
 * 폴링이 서버를 계속 건드려 서버 세션은 살아 있는데 클라이언트 TTL(20분)만 만료되어
 * 불필요한 재로그인을 반복하던 낭비를 없앤다(2026-08-07 성능 감사).
 */
export function peekGroupwareSession(): GroupwareSession | null {
  return cached;
}

/** 페이지 이동 대기 조건 — 뒤에서 원하는 요소를 직접 기다린다면 domcontentloaded 가 빠르다 */
export type GotoWait = 'domcontentloaded' | 'load' | 'networkidle2';

/** 세션 쿠키를 페이지에 주입한 뒤 목표 URL 로 이동 — 로그인 화면으로 튕겼는지 반환 */
async function injectAndGoto(
  page: Page,
  session: GroupwareSession,
  url: string,
  waitUntil: GotoWait,
): Promise<boolean> {
  const client = await page.target().createCDPSession();
  // 이전 시도의 죽은 쿠키가 남지 않게 비우고 주입
  await client.send('Network.clearBrowserCookies');
  await client.send('Network.setCookies', { cookies: session.cookies });
  await page.goto(url, { waitUntil, timeout: 30000 }).catch((err: Error) => {
    // idle 타임아웃은 무시하고 진행 (포털에 상시 폴링 요청이 있을 수 있음)
    if (!/timeout/i.test(err.message)) throw err;
  });
  // 리다이렉트는 문서 도착 전에 끝나므로 domcontentloaded 로도 튕김 판정이 정확하다
  return isLoginUrl(page.url());
}

/**
 * 로그인 화면을 거치지 않고 목표 페이지를 연다 — 공용 세션 쿠키를 주입해 이동한다.
 * 세션이 서버에서 만료돼 로그인 화면으로 튕기면 한 번 재로그인해 다시 시도한다.
 *
 * waitUntil 기본값은 안전한 networkidle2 지만, 포털 화면은 상시 폴링이 있어 idle 판정이
 * 수십 초까지 늘어질 수 있다(실측). 뒤에서 필요한 요소를 직접 기다리는 호출부라면
 * 'domcontentloaded' 를 넘겨 그 대기를 건너뛰는 편이 빠르다.
 */
export async function gotoWithSession(
  page: Page,
  url: string,
  waitUntil: GotoWait = 'networkidle2',
): Promise<void> {
  const first = await getGroupwareSession();
  if (!(await injectAndGoto(page, first, url, waitUntil))) return;

  // 튕겼다 = 캐시된 세션이 서버에서 이미 죽었다 → 새 로그인으로 1회 재시도
  invalidateGroupwareSession();
  const fresh = await getGroupwareSession(true);
  if (await injectAndGoto(page, fresh, url, waitUntil)) {
    throw new Error(
      '그룹웨어 세션을 확보하지 못했습니다 — 잠시 후 다시 시도해 주세요.',
    );
  }
}
