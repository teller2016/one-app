// 전원 기능 IPC — 환경설정이 blueutil 설치 여부를 물어본다.
//
// ⚠️ 이 채널을 settings 쪽에 두지 않는다. `registerSettingsIpc()` 는 단독 배포판(standalone/lite)도
// 부르는데, lite 는 전원 기능을 싣지 않으므로 거기에 두면 lite 번들에 blueutil 코드가 딸려간다.
import { ipcMain } from 'electron';
import { findBlueutil } from './bluetooth';

/** 전원 관련 IPC 핸들러 등록 (데스크톱 전용 — MO·lite 에는 열지 않는다) */
export function registerPowerIpc() {
  // 설치 여부만 — 경로는 렌더러가 알 필요가 없다
  ipcMain.handle('power:blueutil:check', async () => ({
    installed: findBlueutil() !== null,
  }));
}
