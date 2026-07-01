import { ipcMain } from 'electron';
import { getSettingsForRenderer, saveSettings } from '../settings';
import type { SaveSettingsInput } from '../../shared/types';

/** 환경설정 관련 IPC 핸들러 등록 */
export function registerSettingsIpc() {
  ipcMain.handle('settings:get', async () => getSettingsForRenderer());
  ipcMain.handle('settings:set', async (_e, input: SaveSettingsInput) =>
    saveSettings(input),
  );
}
