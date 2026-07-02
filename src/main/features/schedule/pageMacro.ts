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
    // 로그인 후 메인 페이지 로드가 끝날 때까지 대기 —
    // 스크립트(메뉴 핸들러)가 준비되기 전에 다음 단계로 넘어가는 것을 방지
    await Promise.all([
      this.page
        .waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 })
        .catch((): null => null), // 상시 폴링 요청 때문에 idle 이 안 돼도 진행
      this.waitAndClickElement(SCHEDULE_CONFIG.selectors.loginSubmit),
    ]);
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

  /**
   * 클릭이 무시되는 경우를 대비한 재시도 클릭.
   * 페이지 스크립트가 로드되기 전에 클릭하면 핸들러가 없어 조용히 무시되므로,
   * 기대 요소(expectSelector)가 화면에 보일 때까지 클릭을 반복한다.
   */
  async clickUntilVisible(
    clickSelector: string,
    expectSelector: string,
    retries = 5,
  ) {
    await this.page.waitForSelector(clickSelector);
    for (let i = 0; i < retries; i++) {
      try {
        await this.page.click(clickSelector);
      } catch {
        // 일시적으로 클릭 불가(가려짐 등)여도 아래에서 재시도
      }
      try {
        await this.page.waitForSelector(expectSelector, {
          visible: true,
          timeout: 3000,
        });
        return;
      } catch {
        // 기대 요소가 안 나타남 — 클릭이 무시된 것으로 보고 다시 클릭
      }
    }
    throw new Error(
      `메뉴 클릭이 계속 무시됩니다 — 그룹웨어 화면 변경 여부를 확인하세요. (${expectSelector})`,
    );
  }

  // 일정 페이지로 이동
  async moveToSchedulePage() {
    // 상단 메뉴는 로드 직후 클릭이 무시될 수 있어,
    // 챕터 메뉴가 보일 때까지 자동으로 재클릭한다
    const chapterSelector = xpathByText(SCHEDULE_CONFIG.selectors.chapterText);
    await this.clickUntilVisible(
      SCHEDULE_CONFIG.selectors.scheduleMenu,
      chapterSelector,
    );
    await this.page.click(chapterSelector);

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
