// 진입점 — 창 하나 + IPC 등록. (파일 이름이 빌드 산출물 main.js 가 되므로 바꾸지 말 것)
import { app, BrowserWindow, Menu, nativeTheme } from 'electron';
import path from 'node:path';
import { registerIpc } from './ipc';
import { closePreviewWindow } from './submit';

registerIpc();

// 실행 파일을 두 번 눌러도 창이 하나만 뜨게 한다
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

let mainWindow: BrowserWindow | null = null;

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 600,
    height: 900,
    minWidth: 480,
    minHeight: 640,
    title: '야근 결재 상신',
    // 로드 전 흰 깜빡임 방지 — 라이트/다크 그라운드 토큰과 같은 값
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#f5f5f7',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
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
  createWindow();
});

// 자동화 창(미리보기)이 남아 있으면 종료 시 함께 정리
app.on('before-quit', () => {
  closePreviewWindow();
});

// 단일 목적 도구라 창을 닫으면 앱도 종료한다 (macOS 포함)
app.on('window-all-closed', () => app.quit());
