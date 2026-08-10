// 결재 자동화의 그룹웨어 접근 — 자동화 창(BrowserWindow)에 세션을 붙인다.
//
// 우선순위
//   ① 공용 세션(features/groupware/session.ts)의 쿠키를 파티션에 주입해 **로그인 화면을 건너뛴다**.
//      같은 계정 동시 로그인은 서버가 거부하므로(groupware-session 규칙) 로그인은 한 번만 해야 한다.
//   ② 공용 세션을 못 얻으면(Chrome 미설치 등) 자동화 창에서 직접 폼 로그인한다 —
//      standalone 판에서 검증된 경로다. 이때도 withGroupwareLogin 큐를 지나 직렬화한다.
import { evalInPage, goto, waitInPage, type Page } from './browser';
import { GW_CONFIG } from './config';
import {
  getGroupwareSession,
  invalidateGroupwareSession,
  isLoginUrl,
  type GroupwareCookie,
} from '../groupware/session';
import { getCredentials } from '../settings/store';
import { withGroupwareLogin } from '../../lib/groupware';
import { sleep } from '../../lib/util';

/** 로그인 화면으로 되돌려졌는지 (세션 만료·자격증명 실패 판정) */
export function isLoginPage(page: Page): boolean {
  return isLoginUrl(page.wc.getURL());
}

/** 공용 세션 쿠키를 자동화 창의 파티션에 주입 */
async function injectCookies(page: Page, cookies: GroupwareCookie[]) {
  const ses = page.wc.session;
  // 지난 시도의 죽은 쿠키가 섞이지 않게 비우고 넣는다
  await ses.clearStorageData({ storages: ['cookies'] });
  for (const c of cookies) {
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
 * 자동화 창에서 직접 폼 로그인 (폴백).
 * 실패 판정은 호출부에서 대상 화면 URL 로 한다(로그인 화면으로 되돌려지면 실패).
 */
async function formLogin(page: Page) {
  const cred = getCredentials();
  if (!cred) {
    throw new Error(
      '비즈박스 계정이 없습니다 — 환경설정에서 ID·비밀번호를 입력하세요.',
    );
  }
  const sel = GW_CONFIG.selectors;

  // 다른 경로(메일·근태·주간보고)의 로그인과 겹치면 서버가 한쪽을 거부하므로 큐를 경유한다
  await withGroupwareLogin(async () => {
    await goto(page, GW_CONFIG.loginUrl);

    const hasForm = await evalInPage(
      page,
      (idSel: string) => !!document.querySelector(idSel),
      [sel.userId],
    ).catch((): boolean => false);
    if (!hasForm) return; // 이미 세션이 있으면 로그인 화면이 뜨지 않는다

    const filled = await evalInPage(
      page,
      (idSel: string, pwSel: string, btnSel: string, id: string, pw: string) => {
        const idEl = document.querySelector(idSel) as HTMLInputElement | null;
        const pwEl = document.querySelector(pwSel) as HTMLInputElement | null;
        const btn = document.querySelector(btnSel) as HTMLElement | null;
        if (!idEl || !pwEl || !btn) return false;
        // 키 입력 대신 값 설정 + 이벤트 발화 (그룹웨어 스크립트의 input/change 훅 대응)
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

    // 로그인 처리 대기 — 실패해도 여기서 끊지 않고 대상 화면 이동 결과로 판정한다
    await waitInPage(
      page,
      (idSel: string) => !document.querySelector(idSel),
      [sel.userId],
      { timeout: 20000, label: '로그인' },
    ).catch((): void => undefined);
    await sleep(1200); // 추가 리다이렉트 정리 대기
  });
}

/**
 * 자동화 창을 목표 URL 로 보낸다 — 공용 세션 쿠키를 주입해 로그인 화면을 건너뛴다.
 * 세션이 서버에서 만료돼 로그인 화면으로 튕기면 1회 재로그인해 다시 시도하고,
 * 공용 세션 자체를 못 얻으면 창에서 직접 폼 로그인한 뒤 이동한다.
 */
export async function gotoAsUser(page: Page, url: string): Promise<void> {
  try {
    const first = await getGroupwareSession();
    await injectCookies(page, first.cookies);
    await goto(page, url);
    if (!isLoginPage(page)) return;

    // 튕겼다 = 캐시된 세션이 서버에서 이미 죽었다 → 새 로그인으로 1회 재시도
    invalidateGroupwareSession();
    const fresh = await getGroupwareSession(true);
    await injectCookies(page, fresh.cookies);
    await goto(page, url);
    if (!isLoginPage(page)) return;
  } catch {
    // 공용 세션 확보 실패(Chrome 미설치 등) — 창에서 직접 로그인하는 경로로 내려간다
  }

  await formLogin(page);
  await goto(page, url);
  if (isLoginPage(page)) {
    throw new Error(
      '그룹웨어 로그인 실패 — 환경설정의 비즈박스 계정 정보를 확인하세요.',
    );
  }
}
