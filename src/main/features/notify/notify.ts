// 알림 (공통 인프라) — 앱 창을 앞으로 가져와 알럿(dialog)으로 표시한다.
// macOS 미서명/개발 모드에서는 Electron Notification 이 표시되지 않는 경우가 많아
// OS 알림 권한과 무관하게 항상 뜨는 dialog.showMessageBox 를 사용한다.
import { app, BrowserWindow, dialog, ipcMain } from 'electron';

// main.ts 에서 창 생성 후 등록한다 (알럿 부착·섹션 이동에 사용)
let mainWindow: BrowserWindow | null = null;

export function setNotifyWindow(win: BrowserWindow) {
  mainWindow = win;
}

type NotifyOptions = {
  title: string;
  body: string;
  section?: string; // '이동' 클릭 시 이동할 사이드바 섹션 id (예: 'deploy')
};

/** 알림 표시 — 앱을 앞으로 가져와 알럿을 띄우고, '이동'을 누르면 지정 섹션으로 이동 */
export async function notify({ title, body, section }: NotifyOptions) {
  // macOS 는 창을 닫아도 앱이 살아 있으므로, 창이 없으면 알럿만 독립적으로 띄운다
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;

  // 다른 앱 뒤에 있어도 보이도록 앱을 앞으로 가져온다
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
  app.focus({ steal: true });

  const buttons = win && section ? ['이동', '닫기'] : ['확인'];
  const options = {
    type: 'info' as const,
    message: title,
    detail: body,
    buttons,
    defaultId: 0,
    cancelId: buttons.length - 1,
  };
  const { response } = win
    ? await dialog.showMessageBox(win, options)
    : await dialog.showMessageBox(options);

  if (win && section && response === 0 && !win.isDestroyed()) {
    win.webContents.send('app:navigate', section);
  }
}

/** 알림 관련 IPC 등록 — 현재는 미리보기용 테스트 알림 */
export function registerNotifyIpc() {
  ipcMain.handle('notify:test', () => {
    void notify({
      title: '🔔 알림 테스트',
      body: 'One App 알림이 이렇게 표시됩니다.',
      section: 'settings',
    });
    return { ok: true };
  });
}
