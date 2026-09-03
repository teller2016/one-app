// contextBridge — 렌더러는 window.oneApp 으로만 메인과 통신한다.
// (파일 이름이 빌드 산출물 preload.js 가 되므로 바꾸지 말 것)
//
// 본체 `src/preload/preload.ts` 의 **부분집합**이다. 채널 이름·인자·반환 모양을 본체와 똑같이
// 맞춰야 본체 렌더러 컴포넌트(결재 폼·티켓 보고)가 수정 없이 돈다. 본체에서 이 앱이 쓰는
// 채널이 늘면 여기와 `src/renderer/types/global.d.ts` 를 함께 늘린다 — 빠지면 typecheck 가 잡는다.
import { contextBridge, ipcRenderer } from 'electron';
import type {
  ApprovalProgress,
  ExpendInput,
  JiraReportPrefs,
  JiraReportQuery,
  OvertimeSubmitInput,
  SaveSettingsInput,
  ThemePref,
  VacationInput,
} from '@one/shared/types';

contextBridge.exposeInMainWorld('oneApp', {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (input: SaveSettingsInput) => ipcRenderer.invoke('settings:set', input),
    setTheme: (theme: ThemePref) => ipcRenderer.invoke('settings:theme:set', theme),
  },
  approval: {
    getOvertimeDefaults: () => ipcRenderer.invoke('approval:overtime:defaults'),
    getExpendDefaults: () => ipcRenderer.invoke('approval:expend:defaults'),
    getVacationDefaults: () => ipcRenderer.invoke('approval:vacation:defaults'),
    submitOvertime: (input: OvertimeSubmitInput) =>
      ipcRenderer.invoke('approval:overtime:submit', input),
    runExpend: (input: ExpendInput) => ipcRenderer.invoke('approval:expend:run', input),
    submitVacation: (input: VacationInput) =>
      ipcRenderer.invoke('approval:vacation:submit', input),
    vacationStatus: () => ipcRenderer.invoke('approval:vacation:status'),
    openEaBox: () => ipcRenderer.invoke('approval:open-ea-box'),
    /** 진행 단계 구독 — 해제 함수를 반환한다 */
    onProgress: (cb: (progress: ApprovalProgress) => void) => {
      const listener = (_e: unknown, progress: ApprovalProgress) => cb(progress);
      ipcRenderer.on('approval:progress', listener);
      return () => ipcRenderer.removeListener('approval:progress', listener);
    },
  },
  jira: {
    // 티켓 보고만 — 내 이슈·주간·작업 시작은 이 앱에 없다
    report: {
      projects: (force?: boolean) => ipcRenderer.invoke('jira:report:projects', force),
      search: (query: JiraReportQuery) => ipcRenderer.invoke('jira:report:search', query),
      getPrefs: () => ipcRenderer.invoke('jira:report:prefs:get'),
      savePrefs: (prefs: Partial<JiraReportPrefs>) =>
        ipcRenderer.invoke('jira:report:prefs:set', prefs),
    },
  },
  /** 새 버전 확인 — 이 앱만의 채널(본체엔 없다). 실패해도 예외를 던지지 않는다 */
  update: {
    check: () => ipcRenderer.invoke('update:check'),
  },
  /** 기본 브라우저로 링크 열기 */
  openExternal: (url: string) => ipcRenderer.invoke('app:openExternal', url),
});
