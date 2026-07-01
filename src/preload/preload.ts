// preload: 렌더러에 안전하게 노출할 API를 contextBridge 로 등록한다.
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts
import { contextBridge, ipcRenderer } from 'electron';
import type { ScheduleRunPayload, SaveSettingsInput } from '../shared/types';

contextBridge.exposeInMainWorld('oneApp', {
  schedule: {
    // 매크로 실행 (앱 내부에서 puppeteer 직접 실행)
    run: (payload: ScheduleRunPayload) =>
      ipcRenderer.invoke('schedule:run', payload),
    // 실행 중지 (자동화 브라우저 닫기)
    cancel: () => ipcRenderer.invoke('schedule:cancel'),
    // 실행 로그(stdout/stderr/info) 구독. 해제 함수를 반환한다.
    onOutput: (cb: (chunk: { stream: string; data: string }) => void) => {
      const listener = (
        _e: unknown,
        chunk: { stream: string; data: string },
      ) => cb(chunk);
      ipcRenderer.on('schedule:output', listener);
      return () => ipcRenderer.removeListener('schedule:output', listener);
    },
    // 프로세스 종료 이벤트 구독. 해제 함수를 반환한다.
    onDone: (cb: (info: { code: number | null }) => void) => {
      const listener = (_e: unknown, info: { code: number | null }) => cb(info);
      ipcRenderer.on('schedule:done', listener);
      return () => ipcRenderer.removeListener('schedule:done', listener);
    },
  },
  settings: {
    // 현재 설정 조회 (비밀번호 값은 오지 않고 설정 여부만)
    get: () => ipcRenderer.invoke('settings:get'),
    // 설정 저장 (비밀번호는 암호화되어 저장)
    set: (input: SaveSettingsInput) => ipcRenderer.invoke('settings:set', input),
  },
});
