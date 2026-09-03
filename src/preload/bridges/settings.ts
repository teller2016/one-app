// 환경설정 브리지 — 본체 preload 와 단독 배포판(standalone/lite) preload 가 **함께 조립**한다.
//
// ⚠️ 채널 이름은 여기 한 곳에만 둔다. 예전엔 lite 가 이 블록을 문자열까지 손으로 복제했는데,
// 그러면 채널 이름이 바뀌어도 lite 는 typecheck 를 통과한 채(타입은 shared/types 에서 오므로)
// 런타임에 "No handler registered" 로 터졌다. 인터페이스를 구현과 같은 파일에 두어 preload 와
// 렌더러 타입(global.d.ts)이 같은 계약을 가리키게 한다.
import type { IpcRenderer } from 'electron';
import type { AppSettingsView, SaveSettingsInput, ThemePref } from '../../shared/types';

export interface SettingsBridge {
  /** 현재 설정 조회 (비밀번호 값은 오지 않고 설정 여부만) */
  get: () => Promise<AppSettingsView>;
  /** 설정 저장 (비밀번호는 암호화되어 저장) */
  set: (input: SaveSettingsInput) => Promise<AppSettingsView>;
  /** 테마만 즉시 저장 (다음 실행의 창 배경색 결정에 main 이 읽음) */
  setTheme: (theme: ThemePref) => Promise<AppSettingsView>;
}

export const settingsBridge = (ipcRenderer: IpcRenderer): SettingsBridge => ({
  get: () => ipcRenderer.invoke('settings:get'),
  set: (input) => ipcRenderer.invoke('settings:set', input),
  setTheme: (theme) => ipcRenderer.invoke('settings:theme:set', theme),
});
