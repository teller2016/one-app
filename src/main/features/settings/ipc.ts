import { ipcMain, nativeTheme } from 'electron';
import { handleShared } from '../../lib/moIpc';
import { getSettingsForRenderer, saveSettings, saveTheme } from './store';
import type { SaveSettingsInput, ThemePref } from '../../../shared/types';

/** 환경설정 관련 IPC 핸들러 등록 */
export function registerSettingsIpc() {
  // 조회는 MO 공유 — 여러 섹션이 연동 설정(Jira/Gitea 주소) 여부를 확인하는 데 쓴다
  handleShared('settings:get', async () => getSettingsForRenderer());
  handleShared('settings:set', async (input: SaveSettingsInput) =>
    saveSettings(input),
  );
  // 테마는 세그먼트 변경 즉시 단독 저장 (bizboxId 등 다른 필드에 영향 없음)
  // nativeTheme 도 함께 갱신 — 비브런시 재질·신호등이 즉시 새 테마를 따른다.
  // 맥 창 전용이므로 MO 에는 열지 않는다(데스크톱 전용 ipcMain.handle).
  ipcMain.handle('settings:theme:set', async (_e, theme: ThemePref) => {
    nativeTheme.themeSource = theme;
    return saveTheme(theme);
  });
}
