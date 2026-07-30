// 브라우저 자동화 헬퍼 — puppeteer 대신 Electron 자체 BrowserWindow 를 쓴다.
// 받는 사람 PC 에 Chrome 을 따로 깔 필요가 없어(Chromium 이 앱에 들어 있음) 실행만 하면 동작한다.
//
// puppeteer 대응표
//   page.goto            → goto()
//   page.evaluate        → evalInPage()  (함수를 문자열로 만들어 페이지에서 실행)
//   page.waitForFunction → waitInPage()  (같은 방식으로 조건이 참이 될 때까지 폴링)
import {
  BrowserWindow,
  session,
  webFrameMain,
  type WebContents,
} from 'electron';
import { sleep, withTimeout } from './util';

/** 자동화 전용 세션 파티션 — 'persist:' 접두사가 없으면 메모리 세션(매 실행 새 로그인) */
const PARTITION = 'overtime-automation';

/**
 * 페이지가 네이티브 다이얼로그를 띄우면 숨긴 창에서 응답할 방법이 없어 멈춘다.
 * 그룹웨어 상신 흐름엔 없지만(경고는 자체 UI) 방어로 무력화한다.
 */
const DIALOG_OVERRIDE = `
  window.alert = function () {};
  window.confirm = function () { return true; };
  window.print = function () {};
  // 작성 중 이탈 가드(beforeunload) 제거 — 이게 남아 있으면 창이 닫히지 않는다
  window.onbeforeunload = null;
  true;
`;

export type Page = { win: BrowserWindow; wc: WebContents };

/** 자동화 창 열기 — show=false 면 화면에 보이지 않게 동작한다 */
export async function openPage(show: boolean): Promise<Page> {
  const ses = session.fromPartition(PARTITION);
  // 지난 실행의 쿠키가 남아 반쪽 로그인 상태로 시작하는 것을 막는다
  await ses.clearStorageData();

  const win = new BrowserWindow({
    show,
    width: 1440,
    height: 900,
    title: '그룹웨어 자동 작성',
    // 숨긴 상태에서도 렌더링을 진행해야 그룹웨어 에디터 초기화가 끝난다
    paintWhenInitiallyHidden: true,
    webPreferences: {
      partition: PARTITION,
      // 숨긴 창은 '백그라운드'로 취급돼 타이머·애니메이션이 느려진다 → 끄면 정상 속도로 동작
      backgroundThrottling: false,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  const wc = win.webContents;
  // 그룹웨어가 window.open 을 호출해도 새 창을 만들지 않는다
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  // ⚠️ Electron 은 beforeunload 핸들러가 값을 반환하면 확인창도 없이 창 닫기를 취소한다.
  // 전자결재 작성 화면에 그 가드가 걸려 있어, 막지 않으면 미리보기 창이 X 로 닫히지 않는다.
  wc.on('will-prevent-unload', (event) => event.preventDefault());
  wc.on('dom-ready', () => {
    void wc.executeJavaScript(DIALOG_OVERRIDE).catch(() => undefined);
  });
  // iframe(에디터 등) 안에서 뜨는 다이얼로그도 무력화
  wc.on('did-frame-finish-load', (_e, isMainFrame, processId, routingId) => {
    if (isMainFrame) return;
    try {
      void webFrameMain
        .fromId(processId, routingId)
        ?.executeJavaScript(DIALOG_OVERRIDE)
        .catch(() => undefined);
    } catch {
      // 이미 사라진 프레임이면 무시
    }
  });

  return { win, wc };
}

/**
 * URL 이동. 그룹웨어는 로드 중 리다이렉트·장기 폴링이 있어 로드 완료가 늦거나
 * ERR_ABORTED 로 끝날 수 있다 — 실제 준비 여부는 뒤따르는 waitInPage 로 판정하므로
 * 여기서는 실패를 삼킨다.
 */
export async function goto(page: Page, url: string, timeout = 30000) {
  try {
    await withTimeout(page.wc.loadURL(url), timeout, '페이지 로드');
  } catch {
    // 리다이렉트(ERR_ABORTED)·로드 지연은 무시하고 다음 단계에서 상태를 확인한다
  }
}

// JS 소스에서 줄바꿈으로 해석되는 구분자 — 문자 그대로 두면 주입 코드의 구문이 깨진다
const LINE_SEP = String.fromCharCode(0x2028);
const PARA_SEP = String.fromCharCode(0x2029);

/** 인자를 코드 리터럴로 직렬화 (줄 구분자는 이스케이프 시퀀스로 치환) */
const encodeArgs = (args: unknown[]) =>
  JSON.stringify(args)
    .split(LINE_SEP)
    .join('\\u2028')
    .split(PARA_SEP)
    .join('\\u2029');

/**
 * 페이지 컨텍스트에서 함수를 실행한다 (puppeteer 의 page.evaluate 대응).
 * ⚠️ fn 은 문자열로 직렬화되므로 바깥 스코프 변수를 참조할 수 없다 — 필요한 값은 args 로 넘긴다.
 */
export function evalInPage<A extends unknown[], R>(
  page: Page,
  fn: (...args: A) => R,
  args: A,
): Promise<R> {
  const code = `(${fn.toString()}).apply(null, ${encodeArgs(args)})`;
  return page.wc.executeJavaScript(code, true) as Promise<R>;
}

/**
 * 조건이 참이 될 때까지 폴링 (puppeteer 의 page.waitForFunction 대응).
 * 네비게이션 중 실행 실패는 무시하고 계속 시도한다.
 */
export async function waitInPage<A extends unknown[]>(
  page: Page,
  fn: (...args: A) => boolean,
  args: A,
  opts: { timeout: number; label: string; interval?: number },
): Promise<void> {
  const deadline = Date.now() + opts.timeout;
  let lastError: string | null = null;
  while (Date.now() < deadline) {
    if (page.win.isDestroyed()) throw new Error('자동화 창이 닫혔습니다.');
    try {
      if (await evalInPage(page, fn, args)) return;
      lastError = null;
    } catch (err) {
      lastError = (err as Error).message;
    }
    await sleep(opts.interval ?? 300);
  }
  throw new Error(
    `${opts.label} 대기 시간이 초과됐습니다(${opts.timeout / 1000}초).` +
      (lastError ? ` (마지막 오류: ${lastError})` : ''),
  );
}

/** 창 닫기 — 이미 닫혔으면 무시 */
export function closePage(page: Page | null) {
  if (!page || page.win.isDestroyed()) return;
  page.win.destroy();
}
