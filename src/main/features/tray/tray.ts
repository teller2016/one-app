// 메뉴바 트레이 — 창이 닫혀 있어도 앱을 열고 출퇴근을 바로 찍을 수 있는 상주 아이콘.
import { app, Tray, Menu, nativeImage, dialog } from 'electron';
import path from 'node:path';
import { runAttendance } from '../attendance/attend';
import { getCredentials } from '../settings/store';
import { notify, getNotifyWindow } from '../notify/notify';

let tray: Tray | null = null;
let stamping = false; // 트레이에서 중복 찍기 방지

async function stampFromTray(action: 'come' | 'leave') {
  if (stamping) return;
  const label = action === 'come' ? '출근' : '퇴근';

  const cred = getCredentials();
  if (!cred) {
    void notify({
      title: `${label} 실패`,
      body: '비즈박스 계정이 없습니다. [환경설정]에서 저장하세요.',
      section: 'settings',
    });
    return;
  }

  // 실수 방지 확인 (앱 근태 위젯과 동일한 관문)
  const win = getNotifyWindow();
  const options = {
    type: 'question' as const,
    message: `${label}을 찍을까요?`,
    buttons: [`${label} 찍기`, '취소'],
    defaultId: 0,
    cancelId: 1,
  };
  const { response } = win
    ? await dialog.showMessageBox(win, options)
    : await dialog.showMessageBox(options);
  if (response !== 0) return;

  stamping = true;
  try {
    const info = await runAttendance(action, cred);
    const time = action === 'come' ? info.comeTime : info.leaveTime;
    void notify({
      title: `${label} 완료`,
      body: time ? `${label} 시각 ${time} 으로 기록됐습니다.` : `${label} 처리됐습니다.`,
    });
    // 사이드바 근태 위젯 즉시 갱신
    getNotifyWindow()?.webContents.send('attendance:changed', info);
  } catch (err) {
    void notify({ title: `${label} 실패`, body: (err as Error).message });
  } finally {
    stamping = false;
  }
}

/** 트레이 생성 (앱 ready 후 1회). openApp: 창 열기/포커스 콜백 (없으면 새로 생성) */
export function createTray(openApp: () => void) {
  if (tray) return;

  // 컬러 앱 아이콘을 메뉴바 크기로 축소해 사용
  const icon = nativeImage
    .createFromPath(path.join(app.getAppPath(), 'assets', 'icon.png'))
    .resize({ width: 18, height: 18 });
  tray = new Tray(icon);
  tray.setToolTip('One App');
  console.log('[tray] 메뉴바 아이콘 생성됨 (icon empty:', icon.isEmpty(), ')');

  const menu = Menu.buildFromTemplate([
    { label: 'One App 열기', click: openApp },
    { type: 'separator' },
    { label: '출근 찍기', click: () => void stampFromTray('come') },
    { label: '퇴근 찍기', click: () => void stampFromTray('leave') },
    { type: 'separator' },
    { label: '종료', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}
