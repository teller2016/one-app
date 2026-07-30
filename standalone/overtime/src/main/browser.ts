// 브라우저 자동화 헬퍼 — puppeteer 대신 Electron 자체 BrowserWindow 를 쓴다.
// 받는 사람 PC 에 Chrome 을 따로 깔 필요가 없어(Chromium 이 앱에 들어 있음) 실행만 하면 동작한다.
//
// puppeteer 대응표
//   page.goto            → goto()
//   page.evaluate        → evalInPage()  (함수를 문자열로 만들어 페이지에서 실행)
//   page.waitForFunction → waitInPage()  (같은 방식으로 조건이 참이 될 때까지 폴링)
//   popup 처리           → openPage(.., {allowPopups:true}) + waitForPopup()
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
  // 알럿 문구는 버리지 않고 모아둔다 — 지출결의서 검증 오류가 alert 로 오기 때문에
  // 이걸 지우면 실패 이유를 알 수 없다 (takeAlerts 로 읽는다).
  if (!window.__autoAlerts) window.__autoAlerts = [];
  // 원본은 보관 — 사용자에게 창을 넘길 때 releasePage 가 되돌린다
  if (!window.__origDialogs) {
    window.__origDialogs = { alert: window.alert, confirm: window.confirm };
  }
  window.alert = function (m) { window.__autoAlerts.push(String(m)); };
  window.confirm = function (m) { window.__autoAlerts.push('[confirm] ' + String(m)); return true; };
  // 작성 중 이탈 가드(beforeunload) 제거 — 이게 남아 있으면 창이 닫히지 않는다
  window.onbeforeunload = null;
  true;
`;

/** 자동화 흔적 되돌리기 — 사용자가 이어서 쓰는 창에 주입한다 */
const DIALOG_RESTORE = `
  if (window.__origDialogs) {
    window.alert = window.__origDialogs.alert;
    window.confirm = window.__origDialogs.confirm;
  }
  // 도움창 오프너 교체(expend.ts patchPopupOpener)도 원복 — 이후 흐름은 원본 그대로
  if (window.__origCallPopup) {
    window.CM_FNC_CALL_POPUP = window.__origCallPopup;
    window.__popupPatched = false;
  }
  true;
`;

export type Page = {
  win: BrowserWindow;
  wc: WebContents;
  /** 이 창이 띄운 팝업들 (지출결의서의 '찾기' 도움창 등) */
  popups: Page[];
  /** 자동화 가드를 떼는 함수 (releasePage 가 호출) */
  detachGuards?: () => void;
  /** 사용자에게 넘긴 뒤인지 — 이후 열리는 창에는 자동화 가드를 붙이지 않는다 */
  released?: boolean;
};

/**
 * 사용자에게 넘긴 뒤 이어지는 창들에 **창 열기 규칙만** 물려준다 (내용은 건드리지 않는다).
 *
 * 그룹웨어 결재 흐름은 "새 창을 열고 자기 창을 닫는" 방식으로 단계를 넘어간다.
 *   지출결의서 --[결재상신]--> 전자결재 --[정보수정]--> 지출결의서 → …
 * Electron 은 자식 창의 outlivesOpener 기본값이 false 라서, 그대로 두면 단계마다
 * 새 창이 opener 와 함께 파괴돼 화면이 사라진다. 그래서 체인 전체에 true 를 물려준다.
 */
function attachOpenerChain(wc: WebContents) {
  wc.setWindowOpenHandler(() => ({ action: 'allow', outlivesOpener: true }));
  // 이탈 가드(beforeunload)가 걸린 화면은 Electron 에서 확인창도 없이 닫기가 취소된다
  // → 이 처리가 없으면 사용자가 창을 닫을 수 없다
  wc.on('will-prevent-unload', (event) => event.preventDefault());
  wc.on('did-create-window', (child) => attachOpenerChain(child.webContents));
}

/** 창에 공통 가드(다이얼로그 무력화·이탈 가드 해제·팝업 정책)를 붙인다 */
function attachGuards(page: Page, allowPopups: boolean, show: boolean) {
  const { wc } = page;

  wc.setWindowOpenHandler(() => {
    // 지출결의서의 '찾기' 도움창은 window.open + POST 폼 전송이라 팝업을 허용해야 동작한다
    if (!allowPopups) return { action: 'deny' };
    // 사용자에게 넘긴 뒤 열리는 창(결재선·참조 지정 등)은 손대지 않는다.
    // 크기를 강제하거나 대화상자를 끄면 그 화면이 잘리거나 흐름이 끊긴다.
    //
    // ⚠️ outlivesOpener: true 가 필수.
    // 지출결의서의 [결재상신] 은 전자결재 문서 창을 window.open 으로 띄운 **직후 self.close()** 한다.
    // Electron 기본값(false)에서는 opener 가 닫힐 때 자식 창까지 파괴돼,
    // 결재선·참조 지정 화면이 떴다가 즉시 사라진다(2026-07 실측).
    if (page.released) return { action: 'allow', outlivesOpener: true };
    return {
      action: 'allow',
      // 부모와 같은 세션(파티션)을 상속해야 로그인 상태가 유지된다 — partition 을 다시 지정하지 않는다
      // 크기는 그룹웨어가 window.open 에 지정한 값을 그대로 쓴다(강제하면 화면이 잘린다)
      overrideBrowserWindowOptions: {
        show,
        paintWhenInitiallyHidden: true,
        webPreferences: {
          backgroundThrottling: false,
          // ⚠️ disableDialogs 는 쓰지 않는다.
          // 지출결의서 본문 창이 바로 이 팝업으로 열리고, 사용자가 이어서 쓰는 창이다.
          // 대화상자를 끄면 확인창이 안 뜨는 것은 물론, 창 닫기(이탈 확인)까지 막힌다.
        },
      },
    };
  });

  // ⚠️ Electron 은 beforeunload 핸들러가 값을 반환하면 확인창도 없이 창 닫기를 취소한다.
  // 전자결재 작성 화면에 그 가드가 걸려 있어, 막지 않으면 창이 X 로 닫히지 않는다.
  // (사용자에게 넘긴 뒤에도 유지 — 안 그러면 창이 안 닫힌다)
  wc.on('will-prevent-unload', (event) => event.preventDefault());

  const onDomReady = () => {
    void wc.executeJavaScript(DIALOG_OVERRIDE).catch(() => undefined);
  };
  // iframe(에디터 등) 안에서 뜨는 다이얼로그도 무력화
  const onFrameLoad = (
    _e: unknown,
    isMainFrame: boolean,
    processId: number,
    routingId: number,
  ) => {
    if (isMainFrame) return;
    try {
      void webFrameMain
        .fromId(processId, routingId)
        ?.executeJavaScript(DIALOG_OVERRIDE)
        .catch(() => undefined);
    } catch {
      // 이미 사라진 프레임이면 무시
    }
  };
  wc.on('dom-ready', onDomReady);
  wc.on('did-frame-finish-load', onFrameLoad);
  page.detachGuards = () => {
    wc.off('dom-ready', onDomReady);
    wc.off('did-frame-finish-load', onFrameLoad);
  };

  // 팝업 창을 Page 핸들로 추적 (같은 가드를 물려준다)
  wc.on('did-create-window', (child) => {
    // 넘긴 뒤 열린 창은 내용에 손대지 않지만, 창을 여는 규칙만은 물려줘야 한다
    // (전자결재 → [정보수정] → 지출결의서 처럼 창을 열고 자기를 닫는 흐름이 이어진다)
    if (page.released) {
      attachOpenerChain(child.webContents);
      return;
    }
    const childPage: Page = { win: child, wc: child.webContents, popups: [] };
    attachGuards(childPage, allowPopups, show);
    page.popups.push(childPage);
    child.on('closed', () => {
      const i = page.popups.indexOf(childPage);
      if (i >= 0) page.popups.splice(i, 1);
    });
  });
}

/**
 * 자동화를 끝내고 창을 사용자에게 넘긴다.
 * ⚠️ 이걸 하지 않으면 사용자가 [결재상신] 을 눌렀을 때
 * 자동화용 confirm(항상 '예')이 확인창을 몰래 승낙해 창이 닫히는 등 흐름이 깨진다.
 */
export async function releasePage(
  page: Page,
  opts: { closeChildren?: boolean } = {},
) {
  page.released = true; // 이후 열리는 창에는 가드를 붙이지 않는다
  page.detachGuards?.();
  page.detachGuards = undefined;
  // 사용자가 볼 필요 없는 도움창은 정리.
  // ⚠️ opener 창을 넘길 때는 끄지 말 것 — 그 창의 '팝업'이 곧 사용자가 쓸 작업 창이다.
  if (opts.closeChildren !== false) closePopups(page);
  await page.wc.executeJavaScript(DIALOG_RESTORE).catch(() => undefined);
}

/** 자동화 창 열기 — show=false 면 화면에 보이지 않게 동작한다 */
export async function openPage(
  show: boolean,
  opts: { allowPopups?: boolean } = {},
): Promise<Page> {
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
      // ⚠️ 이 창은 작성이 끝나면 사용자가 이어서 쓴다(첨부·결재상신).
      // disableDialogs 를 켜면 그때 확인창이 안 떠서 상신을 진행할 수 없으므로 켜지 않는다.
      // 자동화 중 대화상자는 DIALOG_OVERRIDE 가 가로채고, releasePage 가 원복한다.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  const page: Page = { win, wc: win.webContents, popups: [] };
  attachGuards(page, opts.allowPopups === true, show);
  return page;
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
  timeout = 20000,
): Promise<R> {
  const code = `(${fn.toString()}).apply(null, ${encodeArgs(args)})`;
  // ⚠️ 타임아웃이 없으면 페이지 쪽이 멈췄을 때(창 생성 대기·모달 등) 영원히 안 돌아온다.
  // 그러면 어느 단계에서 막혔는지도 알 수 없으므로 반드시 시간을 끊는다.
  return withTimeout(
    page.wc.executeJavaScript(code, true) as Promise<R>,
    timeout,
    '페이지 스크립트 실행',
  );
}

/**
 * 결과를 기다리지 않고 실행만 시킨다.
 *
 * ⚠️ 왜 필요한가: `executeJavaScript` 로 **window.open 을 실행하는 스크립트**를 호출하면
 * 팝업은 열리는데 호출 자체가 반환되지 않는다(2026-07 실측 — 찾기 도움창에서 재현).
 * 팝업을 닫는 스크립트(window.close)도 같은 문제가 있다.
 * 그래서 이런 호출은 발화만 하고, 성공 여부는 창 상태(waitForPopup·waitPopupClosed)로 판정한다.
 */
export function fireInPage<A extends unknown[]>(
  page: Page,
  fn: (...args: A) => unknown,
  args: A,
): void {
  const code = `(${fn.toString()}).apply(null, ${encodeArgs(args)})`;
  void page.wc.executeJavaScript(code, true).catch(() => undefined);
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

/**
 * 새로 열린 팝업 창을 기다린다.
 * 팝업은 window.open('') 로 빈 창을 먼저 만들고 POST 폼으로 내용을 채우므로,
 * 창이 잡히면 urlPart 가 URL 에 나타날 때까지 한 번 더 기다린다.
 */
export async function waitForPopup(
  page: Page,
  urlPart: string,
  timeout = 25000,
): Promise<Page> {
  const deadline = Date.now() + timeout;
  let popup: Page | null = null;
  while (Date.now() < deadline) {
    popup = page.popups.find((p) => !p.win.isDestroyed()) ?? null;
    if (popup) break;
    await sleep(200);
  }
  if (!popup) throw new Error('찾기 창이 열리지 않았습니다.');

  while (Date.now() < deadline) {
    if (popup.win.isDestroyed()) throw new Error('찾기 창이 곧바로 닫혔습니다.');
    if (!urlPart || popup.wc.getURL().includes(urlPart)) return popup;
    await sleep(200);
  }
  throw new Error(`찾기 창 로드(${urlPart}) 대기 시간이 초과됐습니다.`);
}

/** 팝업이 닫힐 때까지 기다린다 (선택 후 스스로 닫힘) */
export async function waitPopupClosed(popup: Page, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (popup.win.isDestroyed()) return;
    await sleep(200);
  }
  throw new Error('찾기 창이 닫히지 않았습니다.');
}

/** 페이지가 띄우려던 알럿 문구를 꺼내고 비운다 (검증 실패 사유 확인용) */
export async function takeAlerts(page: Page): Promise<string[]> {
  return evalInPage(
    page,
    () => {
      const w = window as unknown as { __autoAlerts?: string[] };
      const list = w.__autoAlerts ?? [];
      w.__autoAlerts = [];
      return list;
    },
    [],
  ).catch(() => [] as string[]);
}

/** 열려 있는 팝업 모두 닫기 (다음 찾기 전에 정리) */
export function closePopups(page: Page) {
  for (const p of [...page.popups]) closePage(p);
  page.popups.length = 0;
}

/** 창 닫기 — 이미 닫혔으면 무시 */
export function closePage(page: Page | null) {
  if (!page || page.win.isDestroyed()) return;
  page.win.destroy();
}
