// 결재 브리지(야근·휴가·지출결의서·상신함) — 본체 preload 와 단독 배포판 preload 가 함께 조립한다.
// 채널 이름은 여기 한 곳에만 둔다 — 이유는 settings.ts 머리말.
import type { IpcRenderer } from 'electron';
import type {
  ApprovalProgress,
  ExpendDefaults,
  ExpendInput,
  ExpendResult,
  OvertimeDefaults,
  OvertimeSubmitInput,
  OvertimeSubmitResult,
  VacationDefaults,
  VacationInput,
  VacationResult,
  VacationStatus,
} from '../../shared/types';

export interface ApprovalBridge {
  /** 입력 기본값 조회 (마지막 작성 값) */
  getOvertimeDefaults: () => Promise<OvertimeDefaults>;
  getExpendDefaults: () => Promise<ExpendDefaults>;
  getVacationDefaults: () => Promise<VacationDefaults>;
  /** 연장근무내역서 작성 (자동화 창 — 수십 초 소요) */
  submitOvertime: (input: OvertimeSubmitInput) => Promise<OvertimeSubmitResult>;
  /** 지출결의서 항목 작성 (상신은 사용자가 열린 창에서 직접) */
  runExpend: (input: ExpendInput) => Promise<ExpendResult>;
  /** 휴가신청서 작성 + 내역추가 */
  submitVacation: (input: VacationInput) => Promise<VacationResult>;
  /** 연차 현황 조회 (총·사용·잔여) */
  vacationStatus: () => Promise<{ ok: boolean; status?: VacationStatus; error?: string }>;
  /** 전자결재 상신함 창 열기 (작성 창과 별개 — 세션 주입으로 로그인 화면 없음) */
  openEaBox: () => Promise<{ ok: boolean; error?: string }>;
  /** 진행 단계 구독 (양식 열기 → 작성 → 상신). 해제 함수를 반환한다 */
  onProgress: (cb: (progress: ApprovalProgress) => void) => () => void;
}

export const approvalBridge = (ipcRenderer: IpcRenderer): ApprovalBridge => ({
  getOvertimeDefaults: () => ipcRenderer.invoke('approval:overtime:defaults'),
  getExpendDefaults: () => ipcRenderer.invoke('approval:expend:defaults'),
  getVacationDefaults: () => ipcRenderer.invoke('approval:vacation:defaults'),
  submitOvertime: (input) => ipcRenderer.invoke('approval:overtime:submit', input),
  runExpend: (input) => ipcRenderer.invoke('approval:expend:run', input),
  submitVacation: (input) => ipcRenderer.invoke('approval:vacation:submit', input),
  vacationStatus: () => ipcRenderer.invoke('approval:vacation:status'),
  openEaBox: () => ipcRenderer.invoke('approval:open-ea-box'),
  onProgress: (cb) => {
    const listener = (_e: unknown, progress: ApprovalProgress) => cb(progress);
    ipcRenderer.on('approval:progress', listener);
    return () => ipcRenderer.removeListener('approval:progress', listener);
  },
});
