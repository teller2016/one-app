// 그룹웨어 공용 — 로그인 (야근 결재·지출결의서가 함께 쓴다)
import { evalInPage, waitInPage, goto, type Page } from './browser';
import { GW_CONFIG } from './config';
import { sleep } from './util';

export type Account = {
  id: string;
  password: string;
  dept: string; // 야근 결재 근무자 표의 '소속' 칸 문구
  showBrowser: boolean; // 자동화 창을 보여줄지 (문제 확인용)
};

/**
 * 그룹웨어 로그인 — 폼이 있으면 채우고 제출한다.
 * 실패 판정은 호출부에서 대상 화면 URL 로 한다(로그인 화면으로 되돌려지면 실패).
 */
export async function login(page: Page, account: Account) {
  const sel = GW_CONFIG.selectors;
  await goto(page, GW_CONFIG.loginUrl);

  const hasForm = await evalInPage(
    page,
    (idSel: string) => !!document.querySelector(idSel),
    [sel.userId],
  ).catch(() => false);
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
    [sel.userId, sel.userPw, sel.loginSubmit, account.id, account.password],
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
  ).catch(() => undefined);
  await sleep(1200); // 추가 리다이렉트 정리 대기
}

/** 로그인 화면으로 되돌려졌는지 (자격증명 실패 판정) */
export function isLoginPage(page: Page): boolean {
  return page.wc.getURL().includes(GW_CONFIG.loginUrlMark);
}
