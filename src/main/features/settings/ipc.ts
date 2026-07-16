import { ipcMain } from 'electron';
import { getSettingsForRenderer, saveSettings, saveTheme } from './store';
import type { SaveSettingsInput, ThemePref } from '../../../shared/types';

/** 환경설정 관련 IPC 핸들러 등록 */
export function registerSettingsIpc() {
  ipcMain.handle('settings:get', async () => getSettingsForRenderer());
  ipcMain.handle('settings:set', async (_e, input: SaveSettingsInput) =>
    saveSettings(input),
  );
  // 테마는 세그먼트 변경 즉시 단독 저장 (bizboxId 등 다른 필드에 영향 없음)
  ipcMain.handle('settings:theme:set', async (_e, theme: ThemePref) =>
    saveTheme(theme),
  );
}
