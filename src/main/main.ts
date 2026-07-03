import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { registerScheduleIpc } from './features/schedule/ipc';
import { registerSettingsIpc } from './features/settings/ipc';
import { registerDeployIpc } from './features/deploy/ipc';
import { registerAttendanceIpc } from './features/attendance/ipc';
import { registerVpnIpc } from './features/vpn/ipc';
import { registerWeeklyIpc } from './features/weekly/ipc';
import { setNotifyWindow } from './features/notify/notify';

// Windows 설치/제거 시 바로가기 처리
if (started) {
  app.quit();
}

// IPC 핸들러 등록
registerScheduleIpc();
registerSettingsIpc();
registerDeployIpc();
registerAttendanceIpc();
registerVpnIpc();
registerWeeklyIpc();

// 외부 브라우저로 링크 열기 (http/https 만 허용)
ipcMain.handle('app:openExternal', async (_e, url: string) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
    await shell.openExternal(url);
    return { ok: true };
  }
  return { ok: false };
});

const createWindow = () => {
  // 메인 창 생성
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'One App',
    // macOS: 신호등 버튼만 남기고 타이틀바를 콘텐츠에 통합
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1a1b1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // 데스크톱 알림이 이 창을 포커스/이동할 수 있도록 참조 등록
  setNotifyWindow(mainWindow);

  // 앱 화면(index.html) 로드
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    // DevTools 자동 오픈은 끔 (필요하면 ⌘⌥I 로 토글)
    // mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
};

// Electron 초기화 완료 후 창 생성
app.on('ready', () => {
  // 개발 모드 Dock 아이콘 — 패키징된 앱은 번들 아이콘(assets/icon.icns)을 사용
  if (process.platform === 'darwin' && !app.isPackaged) {
    try {
      app.dock?.setIcon(path.join(app.getAppPath(), 'assets', 'icon.png'));
    } catch {
      // 아이콘 파일이 없어도 실행에는 지장 없음
    }
  }
  createWindow();
});

// 모든 창이 닫히면 종료 (macOS 제외)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // macOS: dock 아이콘 클릭 시 창이 없으면 재생성
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
