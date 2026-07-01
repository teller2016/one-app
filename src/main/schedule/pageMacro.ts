// 비즈박스 페이지 조작 매크로 (Day_Schedule_Macro/src/pageMacro.js 이식)
import type { Page, Frame } from 'puppeteer';
import { SCHEDULE_CONFIG } from './config';

// 텍스트가 정확히 일치하는 요소를 찾는 puppeteer XPath 셀렉터
const xpathByText = (text: string) => `::-p-xpath(//*[text()='${text}'])`;

export class PageMacro {
  constructor(private page: Page) {}

  // alert/confirm 창 자동 처리
  ignoreAlert() {
    this.page.on('dialog', async (dialog) => {
      if (dialog.type() === 'confirm') {
        await dialog.accept();
      } else {
        await dialog.dismiss();
      }
    });
  }

  async login(id: string, password: string) {
    await this.waitAndInsertValue(SCHEDULE_CONFIG.selectors.userId, id);
    await this.waitAndInsertValue(SCHEDULE_CONFIG.selectors.userPw, password);
    await this.waitAndClickElement(SCHEDULE_CONFIG.selectors.loginSubmit);
  }

  async getIframe(): Promise<Frame> {
    const iframeElement = await this.page.$(SCHEDULE_CONFIG.selectors.iframe);
    if (!iframeElement) throw new Error('iframe 요소를 찾을 수 없습니다.');
    const frame = await iframeElement.contentFrame();
    if (!frame) throw new Error('iframe 컨텐츠 프레임을 찾을 수 없습니다.');
    return frame;
  }

  async waitLoading() {
    const frame = await this.getIframe();
    await frame.waitForSelector(SCHEDULE_CONFIG.selectors.loadingBar);
    await frame.waitForSelector(SCHEDULE_CONFIG.selectors.loadingBar, {
      hidden: true,
    });
  }

  async waitAndInsertValue(
    selector: string,
    value: string,
    wrapper: Page | Frame = this.page,
  ) {
    await wrapper.waitForSelector(selector);
    await wrapper.$eval(
      selector,
      (el, v) => {
        (el as HTMLInputElement).value = v as string;
      },
      value,
    );
  }

  async waitAndClickElement(
    selector: string,
    wrapper: Page | Frame = this.page,
  ) {
    await wrapper.waitForSelector(selector);
    await wrapper.click(selector);
  }

  // 일정 페이지로 이동
  async moveToSchedulePage() {
    await this.waitAndClickElement(SCHEDULE_CONFIG.selectors.scheduleMenu);

    // 설정된 챕터/부서 메뉴 클릭
    const chapterSelector = xpathByText(SCHEDULE_CONFIG.selectors.chapterText);
    await this.page.waitForSelector(chapterSelector);
    const chapter = await this.page.$(chapterSelector);
    if (chapter) {
      await chapter.click();
    }

    await this.waitLoading();

    const frame = await this.getIframe();
    await this.waitAndClickElement(SCHEDULE_CONFIG.selectors.dayViewButton, frame);
    await this.waitAndClickElement(
      SCHEDULE_CONFIG.selectors.worklistSelect,
      frame,
    );
    await this.waitLoading();
  }

  // 일정 하나 등록 (start/end 는 'YYYY-MM-DDTHH:mm:ss' 형식)
  async addSchedule(title: string, start: string, end: string) {
    const sel = SCHEDULE_CONFIG.selectors;

    // page.evaluate 내부는 브라우저 컨텍스트 — 비즈박스 페이지의 jQuery($)와
    // 전역 함수 wrapWindowByMaskInsert 를 사용한다. (셀렉터는 인자로 전달)
    await this.page.evaluate(
      (title, startTime, endTime, sel) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any;
        const $iframe = w.$(sel.contentIframe);
        const $iframeWindow = $iframe.get(0).contentWindow;
        const $iframeDocument = $iframe.contents();

        $iframeWindow.wrapWindowByMaskInsert(startTime, endTime);
        $iframeDocument.find(sel.titleInput).val(title);
        $iframeDocument.find(sel.saveButton).click();
      },
      title,
      start,
      end,
      sel,
    );
  }
}
