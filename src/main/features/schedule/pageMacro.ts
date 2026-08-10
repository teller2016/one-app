// 비즈박스 페이지 조작 매크로 (Day_Schedule_Macro/src/pageMacro.js 이식)
//
// ⚠️ puppeteer 대신 Electron BrowserWindow(`lib/browser.ts`)를 쓴다 — 시스템 Chrome 의존 제거
// (2026-08 전환). puppeteer 와 달라 손봐야 했던 것들:
//   ① XPath 셀렉터(`::-p-xpath`)가 없다 → 텍스트로 요소를 찾는 in-page 함수로 대체
//   ② `frame.waitForSelector`/`frame.click` 같은 프레임 API 가 없다 → 같은 출처라
//      `iframe.contentWindow.document` 를 evalInPage 안에서 직접 만진다
//   ③ alert/confirm 자동 처리는 browser.ts 의 DIALOG_OVERRIDE 가 담당한다
import { SCHEDULE_CONFIG } from './config';
import { evalInPage, waitInPage, type Page } from '../../lib/browser';

/** iframe 안에서 셀렉터를 찾을지, 최상위 문서에서 찾을지 */
type Scope = 'page' | 'iframe';

export class PageMacro {
  constructor(private page: Page) {}

  /**
   * alert/confirm 자동 처리 — browser.ts 의 가드가 이미 하고 있어 여기서는 할 일이 없다.
   * (호출부 흐름을 그대로 두기 위해 메서드는 남긴다)
   */
  ignoreAlert() {
    // no-op: DIALOG_OVERRIDE 가 alert 를 삼키고 confirm 은 true 로 답한다
  }

  /** 지정 범위의 문서에서 조건을 확인한다 (iframe 은 같은 출처라 직접 접근 가능) */
  private async waitFor(
    selector: string,
    opts: { scope?: Scope; label: string; timeout?: number; hidden?: boolean } = {
      label: '요소',
    },
  ) {
    await waitInPage(
      this.page,
      (sel: string, iframeSel: string, useIframe: boolean, wantHidden: boolean) => {
        const doc = useIframe
          ? (document.querySelector(iframeSel) as HTMLIFrameElement | null)
              ?.contentWindow?.document
          : document;
        if (!doc) return false;
        const el = doc.querySelector(sel) as HTMLElement | null;
        if (wantHidden) return !el || el.offsetParent === null;
        return !!el;
      },
      [
        selector,
        SCHEDULE_CONFIG.selectors.iframe,
        opts.scope === 'iframe',
        opts.hidden === true,
      ],
      { timeout: opts.timeout ?? 30000, label: opts.label },
    );
  }

  /** 입력칸에 값 넣기 (원본 $eval 대응) */
  private async setValue(selector: string, value: string, scope: Scope = 'page') {
    await evalInPage(
      this.page,
      (sel: string, v: string, iframeSel: string, useIframe: boolean) => {
        const doc = useIframe
          ? (document.querySelector(iframeSel) as HTMLIFrameElement | null)
              ?.contentWindow?.document
          : document;
        const el = doc?.querySelector(sel) as HTMLInputElement | null;
        if (!el) return false;
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      },
      [selector, value, SCHEDULE_CONFIG.selectors.iframe, scope === 'iframe'],
    );
  }

  /** 좌표 클릭이 아니라 JS 클릭 — 로딩 오버레이에 가로채이지 않는다 */
  private async clickSelector(selector: string, scope: Scope = 'page') {
    return evalInPage(
      this.page,
      (sel: string, iframeSel: string, useIframe: boolean) => {
        const doc = useIframe
          ? (document.querySelector(iframeSel) as HTMLIFrameElement | null)
              ?.contentWindow?.document
          : document;
        const el = doc?.querySelector(sel) as HTMLElement | null;
        if (!el) return false;
        el.click();
        return true;
      },
      [selector, SCHEDULE_CONFIG.selectors.iframe, scope === 'iframe'],
    );
  }

  /** 텍스트가 정확히 일치하는 요소를 클릭 (원본의 XPath 셀렉터 대체) */
  private async clickByText(text: string) {
    return evalInPage(
      this.page,
      (want: string) => {
        const squash = (s: string | null | undefined) =>
          (s ?? '').replace(/\s+/g, ' ').trim();
        const hit = Array.from(document.querySelectorAll('*')).find(
          (el) =>
            squash(el.textContent) === squash(want) &&
            // 자식이 같은 텍스트를 가진 조상까지 잡히지 않게 말단 요소만
            !Array.from(el.children).some(
              (c) => squash(c.textContent) === squash(want),
            ),
        );
        if (!hit) return false;
        (hit as HTMLElement).click();
        return true;
      },
      [text],
    );
  }

  /** 텍스트가 정확히 일치하는 요소가 보일 때까지 대기 */
  private async waitForText(text: string, label: string, timeout = 30000) {
    await waitInPage(
      this.page,
      (want: string) => {
        const squash = (s: string | null | undefined) =>
          (s ?? '').replace(/\s+/g, ' ').trim();
        return Array.from(document.querySelectorAll('*')).some(
          (el) => squash(el.textContent) === squash(want),
        );
      },
      [text],
      { timeout, label },
    );
  }

  /** 로딩바가 떴다 사라질 때까지 (iframe 내부) */
  async waitLoading() {
    const bar = SCHEDULE_CONFIG.selectors.loadingBar;
    // 뜨는 순간을 놓칠 수 있으니 '뜨기'는 실패해도 넘어가고 '사라지기'만 확실히 본다
    await this.waitFor(bar, {
      scope: 'iframe',
      label: '로딩 시작',
      timeout: 5000,
    }).catch((): void => undefined);
    await this.waitFor(bar, {
      scope: 'iframe',
      label: '로딩 완료',
      hidden: true,
      timeout: 60000,
    });
  }

  /**
   * 일정 페이지로 이동.
   * 상단 메뉴는 로드 직후 클릭이 무시될 수 있어, 챕터 메뉴가 보일 때까지 자동으로 재클릭한다.
   */
  async moveToSchedulePage() {
    const sel = SCHEDULE_CONFIG.selectors;
    await this.waitFor(sel.scheduleMenu, { label: '일정 메뉴' });

    let opened = false;
    for (let i = 0; i < 5 && !opened; i++) {
      await this.clickSelector(sel.scheduleMenu);
      opened = await this.waitForText(sel.chapterText, '챕터 메뉴', 3000)
        .then((): boolean => true)
        .catch((): boolean => false);
    }
    if (!opened) {
      throw new Error(
        `메뉴 클릭이 계속 무시됩니다 — 그룹웨어 화면 변경 여부를 확인하세요. (${sel.chapterText})`,
      );
    }
    await this.clickByText(sel.chapterText);

    await this.waitLoading();

    await this.waitFor(sel.dayViewButton, { scope: 'iframe', label: '일간 보기' });
    await this.clickSelector(sel.dayViewButton, 'iframe');
    await this.waitFor(sel.worklistSelect, { scope: 'iframe', label: '업무 목록' });
    await this.clickSelector(sel.worklistSelect, 'iframe');
    await this.waitLoading();
  }

  /** 일정 하나 등록 (start/end 는 'YYYY-MM-DDTHH:mm:ss' 형식) */
  async addSchedule(title: string, start: string, end: string) {
    const sel = SCHEDULE_CONFIG.selectors;

    // 페이지 컨텍스트 — 비즈박스의 jQuery($)와 전역 wrapWindowByMaskInsert 를 그대로 쓴다.
    // ⚠️ iframe(#_content) 안의 등록 폼을 부모의 jQuery 로 조작하는 원본 흐름을 유지한다.
    const result = await evalInPage(
      this.page,
      (
        titleText: string,
        startTime: string,
        endTime: string,
        contentIframe: string,
        titleInput: string,
        saveButton: string,
      ) => {
        const w = window as unknown as {
          $?: (s: string) => {
            get: (i: number) => { contentWindow: Record<string, unknown> };
            contents: () => { find: (s: string) => { val: (v?: string) => void; click: () => void } };
          };
        };
        if (typeof w.$ !== 'function') return 'NO_JQUERY';
        const $iframe = w.$(contentIframe);
        const frameWindow = $iframe.get(0)?.contentWindow as
          | { wrapWindowByMaskInsert?: (s: string, e: string) => void }
          | undefined;
        if (typeof frameWindow?.wrapWindowByMaskInsert !== 'function') {
          return 'NO_INSERT_FN';
        }
        const $doc = $iframe.contents();
        frameWindow.wrapWindowByMaskInsert(startTime, endTime);
        $doc.find(titleInput).val(titleText);
        $doc.find(saveButton).click();
        return 'OK';
      },
      [title, start, end, sel.contentIframe, sel.titleInput, sel.saveButton],
    );
    if (result !== 'OK') {
      throw new Error(
        `일정을 등록하지 못했습니다(${result}) — 그룹웨어 화면이 바뀌었을 수 있습니다.`,
      );
    }
  }
}
