// 데스크톱 알림 (공통 인프라) — Electron Notification 래퍼.
// 알림을 클릭하면 앱 창을 앞으로 가져오고, 지정한 사이드바 섹션으로 이동시킨다.
import { BrowserWindow, Notification } from 'electron';

// main.ts 에서 창 생성 후 등록한다 (알림 클릭 시 포커스/이동에 사용)
let mainWindow: BrowserWindow | null = null;

export function setNotifyWindow(win: BrowserWindow) {
  mainWindow = win;
}

type NotifyOptions = {
  title: string;
  body: string;
  section?: string; // 클릭 시 이동할 사이드바 섹션 id (예: 'deploy')
};

/** 데스크톱 알림 표시 — 클릭하면 앱 창을 앞으로 + 지정 섹션으로 이동 */
export function notify({ title, body, section }: NotifyOptions) {
  if (!Notification.isSupported()) return;

  const n = new Notification({ title, body });
  n.on('click', () => {
    const win = mainWindow;
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    if (section) win.webContents.send('app:navigate', section);
  });
  n.show();
}
