// 알림 (공통 인프라) — 앱 창을 앞으로 가져와 알럿(dialog)으로 표시한다.
// macOS 미서명/개발 모드에서는 Electron Notification 이 표시되지 않는 경우가 많아
// OS 알림 권한과 무관하게 항상 뜨는 dialog.showMessageBox 를 사용한다.
// 비침투 알림(작업 흐름을 끊으면 안 되는 완료 알림)은 notifyToast 를 쓴다.
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import type { AppToastPayload } from '../../../shared/types';

// main.ts 에서 창 생성 후 등록한다 (알럿 부착·섹션 이동에 사용)
let mainWindow: BrowserWindow | null = null;

export function setNotifyWindow(win: BrowserWindow) {
  mainWindow = win;
}

type NotifyOptions = {
  title: string;
  body: string;
  section?: string; // '이동' 클릭 시 이동할 사이드바 섹션 id (예: 'deploy')
  action?: string; // 지정하면 기본 버튼 라벨 — 후속 동작은 호출부가 반환값으로 처리 (section 보다 우선)
  checkbox?: string; // 지정하면 알럿 안에 체크박스 표시 — 체크 여부는 반환값 checked (예: '오늘은 더 알리지 않기')
};

export type NotifyResult = {
  primary: boolean; // 기본 버튼(action 라벨 또는 '이동')을 눌렀는가
  checked: boolean; // checkbox 를 지정했을 때 체크 상태 (닫기로 닫아도 유지된다)
};

/**
 * 알림 표시 — 앱을 앞으로 가져와 알럿을 띄운다.
 * 어느 버튼으로 닫았는지(primary)와 체크박스 상태(checked)를 반환한다.
 */
export async function notify({
  title,
  body,
  section,
  action,
  checkbox,
}: NotifyOptions): Promise<NotifyResult> {
  // macOS 는 창을 닫아도 앱이 살아 있으므로, 창이 없으면 알럿만 독립적으로 띄운다
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;

  // 다른 앱 뒤에 있어도 보이도록 앱을 앞으로 가져온다
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
  app.focus({ steal: true });

  const primary = action ?? (win && section ? '이동' : null);
  const buttons = primary ? [primary, '닫기'] : ['확인'];
  const options = {
    type: 'info' as const,
    message: title,
    detail: body,
    buttons,
    defaultId: 0,
    cancelId: buttons.length - 1,
    // ⚠️ checkboxLabel 은 라벨이 있을 때만 넘긴다 — 빈 문자열이면 체크박스가 그려지지 않는다
    ...(checkbox ? { checkboxLabel: checkbox, checkboxChecked: false } : {}),
  };
  const { response, checkboxChecked } = win
    ? await dialog.showMessageBox(win, options)
    : await dialog.showMessageBox(options);

  const primaryClicked = primary !== null && response === 0;
  // 섹션 이동은 action 이 없는 알림에서만 (action 알림의 후속 동작은 호출부 몫)
  if (primaryClicked && !action && win && section && !win.isDestroyed()) {
    win.webContents.send('app:navigate', section);
  }
  return { primary: primaryClicked, checked: !!checkboxChecked };
}

/** 창이 화면에 있고 포커스인가 — 토스트가 지금 바로 보이는 상태인지의 판정 */
function isWindowFocused(): boolean {
  const win = getNotifyWindow();
  return !!win && win.isVisible() && !win.isMinimized() && win.isFocused();
}

/**
 * 토스트 발신 — 창이 있으면 백그라운드여도 보낸다(sticky 토스트가 렌더러에 쌓여
 * **복귀했을 때 그대로 떠 있다**). 창이 파괴됐으면 false — 뱃지 등 다른 신호가
 * 이미 있는 저강도 알림용이라 별도 폴백은 하지 않는다.
 */
export function sendToast(payload: AppToastPayload): boolean {
  const win = getNotifyWindow();
  if (!win) return false;
  win.webContents.send('app:toast', payload);
  return true;
}

/**
 * 비침투 알림 — 창이 화면에 있고 포커스면 우측 아래 토스트로 표시한다.
 * 백그라운드(다른 앱 뒤·최소화·창 없음)면 토스트가 안 보이므로 알럿(notify)으로 폴백해
 * 놓치지 않게 한다. 포커스를 뺏지 않아 작업 흐름을 끊지 않는 완료 알림용.
 */
export async function notifyToast(payload: AppToastPayload): Promise<void> {
  if (isWindowFocused() && sendToast(payload)) return;
  await notify({
    title: payload.title ?? payload.message,
    body: payload.title ? payload.message : '',
    section: payload.section,
  });
}

/** 등록된 메인 창 반환 (파괴됐으면 null) — 메인 프로세스에서 렌더러로 이벤트를 보낼 때 사용 */
export function getNotifyWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

/** 알림 관련 IPC 등록 — 현재는 미리보기용 테스트 알림 */
export function registerNotifyIpc() {
  ipcMain.handle('notify:test', () => {
    // 이 버튼은 환경설정 '알림' 그룹의 배포 알림 미리보기다 — 배포가 알럿이므로
    // 여기도 알럿이어야 실제와 어긋나지 않는다(2026-08-14)
    void notify({
      title: '🔔 알림 테스트',
      body: 'One App 알림이 이렇게 표시됩니다.',
      section: 'settings',
    });
    return { ok: true };
  });
}
