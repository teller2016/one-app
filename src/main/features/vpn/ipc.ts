import { app, dialog, ipcMain } from 'electron';
import { broadcast } from '../../lib/broadcast';
import type {
  SaveVpnSettingsInput,
  VpnActionResult,
  VpnSaveResult,
  VpnSettingsView,
  VpnStatus,
} from '../../../shared/types';
import {
  connectVpn,
  disconnectVpn,
  getVpnStatus,
  onVpnStatus,
  tryReattachVpn,
} from './openvpn';
import { getVpnCredentials, getVpnSettingsForRenderer, saveVpnSettings } from './store';

/** VPN 관련 IPC 핸들러 등록 */
export function registerVpnIpc() {
  ipcMain.handle('vpn:settings:get', (): VpnSettingsView => getVpnSettingsForRenderer());

  ipcMain.handle('vpn:settings:save', (_e, input: SaveVpnSettingsInput): VpnSaveResult => {
    try {
      return { ok: true, settings: saveVpnSettings(input) };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  // .ovpn 설정 파일 선택 다이얼로그
  ipcMain.handle('vpn:pick-ovpn', async (): Promise<{ path?: string }> => {
    const res = await dialog.showOpenDialog({
      title: 'OpenVPN 설정 파일 선택',
      filters: [{ name: 'OpenVPN 설정', extensions: ['ovpn', 'conf'] }],
      properties: ['openFile'],
    });
    return { path: res.canceled ? undefined : res.filePaths[0] };
  });

  ipcMain.handle('vpn:status:get', (): VpnStatus => getVpnStatus());

  // 연결 — 저장된 시크릿으로 OTP 자동 생성. manualOtp 가 오면 그 코드를 사용
  ipcMain.handle('vpn:connect', async (_e, manualOtp?: string): Promise<VpnActionResult> => {
    const cred = getVpnCredentials();
    if (!cred?.username) {
      return { ok: false, error: 'VPN 계정 이름을 먼저 설정하세요. (위젯의 ⚙ 버튼)' };
    }
    if (!cred.totpSecret && !manualOtp) {
      return { ok: false, error: 'OTP를 입력하거나 설정에서 시크릿 키를 저장하세요.' };
    }
    try {
      await connectVpn(cred.ovpnPath, manualOtp);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  ipcMain.handle('vpn:disconnect', async (): Promise<VpnActionResult> => {
    try {
      await disconnectVpn();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  // 상태 변화를 모든 창에 push
  onVpnStatus((status) => broadcast('vpn:status', status));

  // 앱 재시작 시 살아있는 VPN 데몬에 재접속해 상태 복원
  void app.whenReady().then(() => {
    void tryReattachVpn();
  });
}
