// 그룹웨어 세션 공용 인프라 — 로그인 1회로 확보한 쿠키를 여러 기능이 함께 쓴다.
//
// 로그인 자체는 브라우저가 필요하다(비밀번호를 페이지 JS 가 암호화해 전송하므로
// 순수 Node 로그인 불가). 하지만 확보한 쿠키는 두 방향으로 모두 재사용된다.
//   ① 순수 HTTP 호출 — 메일 API (Cookie 헤더)
//   ② 다른 브라우저에 주입 — 근태 등 페이지 함수가 필요한 기능
// ②가 실제로 통함을 실측했다(2026-07-30): 주입 후 userMain.do 직행 시 로그인 화면으로
// 튕기지 않고 근태 위젯까지 정상 판독, 소요 1.3초 vs 로그인 경로 4.5초.
//
// ⚠️ 로그인은 **Electron BrowserWindow**(`lib/browser.ts`)로 한다 — puppeteer + 시스템 Chrome
// 의존을 없애기 위함(2026-08 전환). 쿠키는 CDP 대신 `ses.cookies.get()` 으로 읽는다.
//
// ⚠️ 쿠키는 이름이 같고 경로만 다른 JSESSIONID 가 2개(`/gw`, `/`)다. 그래서 합친 문자열이
// 아니라 도메인·경로가 붙은 객체 목록을 정본으로 보관하고, HTTP 용 헤더는 파생값으로 만든다.
import { GROUPWARE_CONFIG } from './config';
import { getCredentials } from '../settings/store';
import { sleep } from '../../lib/util';
import { withGroupwareLogin } from '../../lib/groupware';
import {
  AUTOMATION_PARTITION,
  closePage,
  evalInPage,
  goto,
  openPage,
  waitInPage,
  type Page as BrowserPage,
} from '../../lib/browser';

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

/** 로그인 → 도메인·경로가 붙은 쿠키 목록 확보 (숨긴 BrowserWindow) */
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
    // 로그인 전용 파티션 — openPage 가 쿠키를 비우고 시작하므로 늘 새 로그인이다
    const page = await openPage(false, {
      partition: AUTOMATION_PARTITION.login,
      title: '그룹웨어 로그인',
    });
    try {
      await goto(page, GROUPWARE_CONFIG.loginUrl);

      const hasForm = await evalInPage(
        page,
        (idSel: string) => !!document.querySelector(idSel),
        [sel.userId],
      ).catch((): boolean => false);

      if (hasForm) {
        // 키 입력 대신 값 설정 + 이벤트 발화 (그룹웨어 스크립트의 input/change 훅 대응)
        const filled = await evalInPage(
          page,
          (
            idSel: string,
            pwSel: string,
            btnSel: string,
            id: string,
            pw: string,
          ) => {
            const idEl = document.querySelector(idSel) as HTMLInputElement | null;
            const pwEl = document.querySelector(pwSel) as HTMLInputElement | null;
            const btn = document.querySelector(btnSel) as HTMLElement | null;
            if (!idEl || !pwEl || !btn) return false;
            const set = (el: HTMLInputElement, value: string) => {
              el.focus();
              el.value = value;
              el.dispatchEvent(new Event('input', { bubbles: true }));
              el.dispatchEvent(new Event('change', { bubbles: true }));
              el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
            };
            set(idEl, id);
            set(pwEl, pw);
            btn.click();
            return true;
          },
          [sel.userId, sel.userPw, sel.loginSubmit, cred.id, cred.password],
        );
        if (!filled) {
          throw new Error(
            '로그인 화면을 인식하지 못했습니다 — 그룹웨어 화면이 바뀌었을 수 있습니다.',
          );
        }
        // 로그인 폼이 사라질 때까지 (실패는 아래 포털 이동 결과로 판정한다)
        await waitInPage(
          page,
          (idSel: string) => !document.querySelector(idSel),
          [sel.userId],
          { timeout: 20000, label: '로그인' },
        ).catch((): void => undefined);
        await sleep(1200); // 추가 리다이렉트 정리 대기
      }

      // 포털 메인 방문 — 세션 안정화 (로그인 페이지로 튕기면 실패)
      await goto(page, GROUPWARE_CONFIG.mainUrl);
      if (isLoginUrl(page.wc.getURL())) {
        throw new Error(
          '그룹웨어 로그인 실패 — 환경설정의 계정 정보를 확인하세요.',
        );
      }

      const cookies = await readCookies(page.wc.session);
      if (!cookies.length) {
        throw new Error('로그인 쿠키를 읽지 못했습니다 — 다시 시도해 주세요.');
      }
      return {
        cookies,
        header: cookies.map((c) => `${c.name}=${c.value}`).join('; '),
        establishedAt: Date.now(),
      };
    } finally {
      closePage(page);
    }
  });
}

/**
 * 파티션의 forbiz 쿠키를 도메인·경로까지 담아 읽는다.
 * ⚠️ `cookies.get({})` 는 httpOnly 쿠키도 돌려준다(JSESSIONID 가 httpOnly).
 */
async function readCookies(
  ses: Electron.Session,
): Promise<GroupwareCookie[]> {
  const cookies = await ses.cookies.get({});
  return cookies
    .filter((c) => (c.domain ?? '').includes('forbiz'))
    .map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain ?? '',
      path: c.path ?? '/',
      secure: c.secure === true,
      httpOnly: c.httpOnly === true,
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

/** 세션 쿠키를 자동화 창(BrowserWindow)의 파티션에 주입 */
async function injectCookiesToWindow(
  page: BrowserPage,
  session: GroupwareSession,
): Promise<void> {
  const ses = page.wc.session;
  // 이전 시도의 죽은 쿠키가 남지 않게 비우고 주입
  await ses.clearStorageData({ storages: ['cookies'] });
  for (const c of session.cookies) {
    // 도메인 쿠키(`.forbiz.co.kr`)는 앞 점을 뗀 호스트로 url 을 만들고 domain 을 함께 준다
    const host = c.domain.replace(/^\./, '');
    await ses.cookies
      .set({
        url: `https://${host}${c.path}`,
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        secure: c.secure,
        httpOnly: c.httpOnly,
      })
      .catch((): void => undefined); // 개별 쿠키 실패는 무시 (핵심은 JSESSIONID)
  }
}

/**
 * `gotoWithSession` 의 BrowserWindow 판 — 자동화 창에 쿠키를 주입해 목표 URL 로 직행한다.
 * 세션이 서버에서 만료돼 로그인 화면으로 튕기면 1회 재로그인 후 재시도한다.
 *
 * ⚠️ 대기 조건(networkidle 류)이 없다 — `goto()` 는 로드 실패를 삼키므로, 호출부가
 * 필요한 요소를 `waitInPage` 로 직접 기다려야 한다(포털은 상시 폴링이라 idle 이 안 온다).
 */
export async function gotoWithSessionInWindow(
  page: BrowserPage,
  url: string,
): Promise<void> {
  const first = await getGroupwareSession();
  await injectCookiesToWindow(page, first);
  await goto(page, url);
  if (!isLoginUrl(page.wc.getURL())) return;

  // 튕겼다 = 캐시된 세션이 서버에서 이미 죽었다 → 새 로그인으로 1회 재시도
  invalidateGroupwareSession();
  const fresh = await getGroupwareSession(true);
  await injectCookiesToWindow(page, fresh);
  await goto(page, url);
  if (isLoginUrl(page.wc.getURL())) {
    throw new Error(
      '그룹웨어 세션을 확보하지 못했습니다 — 잠시 후 다시 시도해 주세요.',
    );
  }
}
