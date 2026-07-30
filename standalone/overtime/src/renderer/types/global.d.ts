import type {
  AccountView,
  ExpendDefaults,
  ExpendInput,
  ExpendResult,
  OvertimeDefaults,
  OvertimeProgress,
  OvertimeSubmitInput,
  OvertimeSubmitResult,
  SaveAccountInput,
} from '../../shared/types';

declare global {
  interface Window {
    overtimeApp: {
      getAccount: () => Promise<AccountView>;
      saveAccount: (input: SaveAccountInput) => Promise<AccountView>;
      getDefaults: () => Promise<OvertimeDefaults>;
      getExpendDefaults: () => Promise<ExpendDefaults>;
      submit: (input: OvertimeSubmitInput) => Promise<OvertimeSubmitResult>;
      runExpend: (input: ExpendInput) => Promise<ExpendResult>;
      closeKeptWindow: () => Promise<{ closed: boolean }>;
      /** 진행 단계 구독 — 해제 함수를 반환한다 */
      onProgress: (cb: (progress: OvertimeProgress) => void) => () => void;
      openExternal: (url: string) => Promise<{ ok: boolean }>;
    };
  }
}

export {};
