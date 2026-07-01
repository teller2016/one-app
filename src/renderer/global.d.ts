// preload 에서 contextBridge 로 노출한 window.oneApp 타입 선언
import type {
  ScheduleRunPayload,
  ScheduleRunResult,
  ScheduleOutputChunk,
  ScheduleDoneInfo,
} from '../shared/types';

declare global {
  interface Window {
    oneApp: {
      schedule: {
        run: (payload: ScheduleRunPayload) => Promise<ScheduleRunResult>;
        cancel: () => Promise<{ ok: boolean }>;
        onOutput: (cb: (chunk: ScheduleOutputChunk) => void) => () => void;
        onDone: (cb: (info: ScheduleDoneInfo) => void) => () => void;
      };
    };
  }
}
