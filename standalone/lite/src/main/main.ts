// 진입점 — 창 하나 + IPC 등록. (파일 이름이 빌드 산출물 main.js 가 되므로 바꾸지 말 것)
//
// 이 앱은 One App 본체의 기능 모듈을 **복사하지 않고 직접 import** 한다(`@one/*` → ../../src).
// 결재 자동화·Jira 보고·설정 저장이 본체와 같은 파일로 돌아가므로, 본체를 고치면 다음 빌드에
// 그대로 실린다. 본체 main 에서 가져오는 것은 electron 과 node 내장 모듈만 쓰는 순수 모듈이어야
// 한다(터미널·MO 서버처럼 데스크톱 전용 의존이 딸린 기능은 가져오지 않는다).
import { app, BrowserWindow, ipcMain, Menu, nativeTheme, shell } from 'electron';
import path from 'node:path';
import { registerApprovalIpc } from '@one/main/features/approval/ipc';
import { closeKeptPage } from '@one/main/features/approval/keeper';
import { registerJiraReportIpc } from '@one/main/features/jira/report';
import { registerSettingsIpc } from '@one/main/features/settings/ipc';
import { getThemePref } from '@one/main/features/settings/store';
import { loadWindowState, trackWindowState } from '@one/main/lib/windowState';

// 실행 파일을 두 번 눌러도 창이 하나만 뜨게 한다
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

// 본체와 같은 채널·핸들러 — preload 가 노출하는 window.oneApp 의 부분집합과 짝이다
registerSettingsIpc(); // settings:get · settings:set · settings:theme:set
registerApprovalIpc(); // approval:* (야근·휴가·지출결의서·상신함)
registerJiraReportIpc(); // jira:report:* (프로젝트 목록·조회·저장된 조건)

// 외부 브라우저로 링크 열기 (http/https 만 허용) — 본체 main.ts 와 같은 계약
ipcMain.handle('app:openExternal', async (_e, url: string) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    await shell.openExternal(url);
    return { ok: true };
  }
  return { ok: false };
});

// 티켓 보고 표(7열)가 들어가야 해서 결재 도우미 시절(600px)보다 넓게 잡는다
const WINDOW_DEFAULT = { width: 1040, height: 760 };
const WINDOW_MIN = { width: 720, height: 560 };

let mainWindow: BrowserWindow | null = null;

/**
 * 개발 인스턴스용 아이콘 경로 — 패키징한 앱은 번들의 `.icns`/`.ico` 를 쓰지만,
 * `npm start` 로 띄운 개발 인스턴스는 앱 번들이 없어 **Electron 기본 아이콘**이 뜬다.
 * (`__dirname` = `.vite/build` 이므로 두 단계 위가 이 프로젝트 루트다)
 */
const DEV_ICON = path.join(__dirname, '../../assets/icon.png');

const createWindow = () => {
  // 저장된 테마를 네이티브에도 반영 — 다이얼로그·렌더러의 prefers-color-scheme 이 따라간다
  nativeTheme.themeSource = getThemePref();
  // 마지막 크기·위치 (없거나 화면 밖이면 기본값 — 본체 lib/windowState 공용)
  const saved = loadWindowState('main', { defaults: WINDOW_DEFAULT, min: WINDOW_MIN });

  mainWindow = new BrowserWindow({
    width: saved.width,
    height: saved.height,
    x: saved.x,
    y: saved.y,
    minWidth: WINDOW_MIN.width,
    minHeight: WINDOW_MIN.height,
    title: 'One App Lite',
    // Windows·Linux 개발 인스턴스의 창·작업표시줄 아이콘 (macOS 는 아래 app.dock 으로)
    ...(app.isPackaged ? {} : { icon: DEV_ICON }),
    // 본체와 달리 비브런시를 쓰지 않으므로 로드 전 배경을 직접 칠한다 — _base.scss 의 --bg 와 같은 값
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#f5f5f7',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // ⚠️ 본체(src/main/main.ts)와 같은 이유로 기본값을 명시한다 — 격리가 조용히
      // 풀리는 것을 막는다. 이 preload 도 `electron` 만 import 해 sandbox 와 호환된다.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  if (saved.maximized) mainWindow.maximize();
  trackWindowState(mainWindow);

  // 렌더러의 새 창 요청은 앱 안에 창을 만들지 않고 기본 브라우저로 연다
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
};

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.on('ready', () => {
  // Windows: File/Edit/View 기본 메뉴바를 숨겨 단일 목적 앱처럼 보이게 한다
  // (macOS 는 복사·붙여넣기 단축키가 메뉴에 묶여 있어 기본 메뉴를 유지)
  if (process.platform === 'win32') Menu.setApplicationMenu(null);
  // macOS 개발 인스턴스의 Dock 아이콘 — 번들 아이콘이 없어 기본 Electron 아이콘이 뜬다.
  // 실패해도 앱은 그대로 뜬다(아이콘 하나 때문에 기동을 막지 않는다).
  if (!app.isPackaged && process.platform === 'darwin') {
    try {
      app.dock?.setIcon(DEV_ICON);
    } catch {
      // noop — 파일이 없거나(아이콘 미생성) 형식이 안 맞는 경우
    }
  }
  createWindow();
});

// 사용자에게 넘겨둔 결재 작성 창이 있으면 종료 시 함께 정리
app.on('before-quit', () => {
  closeKeptPage();
});

// 단일 목적 도구라 창을 닫으면 앱도 종료한다 (macOS 포함)
app.on('window-all-closed', () => app.quit());
