// contextBridge — 렌더러는 window.overtimeApp 으로만 메인과 통신한다
// (파일 이름이 빌드 산출물 preload.js 가 되므로 바꾸지 말 것)
import { contextBridge, ipcRenderer } from 'electron';
import type {
  AccountView,
  OvertimeDefaults,
  OvertimeProgress,
  OvertimeSubmitInput,
  OvertimeSubmitResult,
  SaveAccountInput,
} from '../shared/types';

contextBridge.exposeInMainWorld('overtimeApp', {
  /** 저장된 계정 정보 (비밀번호는 저장 여부만) */
  getAccount: (): Promise<AccountView> => ipcRenderer.invoke('account:get'),
  saveAccount: (input: SaveAccountInput): Promise<AccountView> =>
    ipcRenderer.invoke('account:save', input),
  /** 마지막 작성 내용 (업무 대상·수행 내용·사유) */
  getDefaults: (): Promise<OvertimeDefaults> => ipcRenderer.invoke('defaults:get'),
  /** 연장근무내역서 작성·상신 (previewOnly 면 상신 없이 창만 띄운다) */
  submit: (input: OvertimeSubmitInput): Promise<OvertimeSubmitResult> =>
    ipcRenderer.invoke('overtime:submit', input),
  /** 미리보기 창 닫기 */
  closePreview: (): Promise<{ closed: boolean }> =>
    ipcRenderer.invoke('overtime:preview:close'),
  /** 진행 단계 구독 — 해제 함수를 반환한다 */
  onProgress: (cb: (progress: OvertimeProgress) => void) => {
    const listener = (_e: unknown, progress: OvertimeProgress) => cb(progress);
    ipcRenderer.on('overtime:progress', listener);
    return () => ipcRenderer.removeListener('overtime:progress', listener);
  },
  /** 기본 브라우저로 링크 열기 */
  openExternal: (url: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('app:openExternal', url),
});
