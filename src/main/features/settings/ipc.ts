import { ipcMain, nativeTheme } from 'electron';
import { handleShared } from '../../lib/moIpc';
import { listSounds, playSound } from '../../lib/sound';
import {
  getSettingsForRenderer,
  saveSettings,
  saveTheme,
  setNotifySound,
} from './store';
import type {
  NotifySoundKind,
  SaveSettingsInput,
  ThemePref,
} from '../../../shared/types';

/** 환경설정 관련 IPC 핸들러 등록 */
export function registerSettingsIpc() {
  // 조회는 MO 공유 — 여러 섹션이 연동 설정(Jira/Gitea 주소) 여부를 확인하는 데 쓴다
  handleShared('settings:get', async () => getSettingsForRenderer());
  // ⚠️ 저장은 MO 에 열지 않는다 — 계정·토큰을 담는 채널이라 폰(브라우저)에서 부를 이유가 없고,
  // 환경설정 화면 자체가 데스크톱 전용이다. 폰에는 조회만 있으면 충분하다.
  ipcMain.handle('settings:set', async (_e, input: SaveSettingsInput) =>
    saveSettings(input),
  );
  // 테마는 세그먼트 변경 즉시 단독 저장 (bizboxId 등 다른 필드에 영향 없음)
  // nativeTheme 도 함께 갱신 — 비브런시 재질·신호등이 즉시 새 테마를 따른다.
  // 맥 창 전용이므로 MO 에는 열지 않는다(데스크톱 전용 ipcMain.handle).
  ipcMain.handle('settings:theme:set', async (_e, theme: ThemePref) => {
    nativeTheme.themeSource = theme;
    return saveTheme(theme);
  });

  // ── 알림음 (환경설정 전용 — 맥에서만 소리가 나므로 MO 에는 열지 않는다) ──
  // 고를 수 있는 음원 목록: /System/Library/Sounds + ~/Library/Sounds 스캔
  ipcMain.handle('settings:sounds:list', async () => listSounds());
  // 미리듣기 — 고르는 즉시 들려준다. 목록에 없는 이름은 playSound 가 무시한다
  ipcMain.handle('settings:sounds:preview', async (_e, name: string) => {
    playSound(name);
    return { ok: true };
  });
  // 선택 저장 — [저장] 버튼 없이 즉시 저장(테마·터미널 알림 강도와 같은 규칙)
  ipcMain.handle(
    'settings:sounds:set',
    async (_e, kind: NotifySoundKind, name: string) => {
      const ok = setNotifySound(kind, name);
      return { ok, sounds: getSettingsForRenderer().sounds };
    },
  );
}
