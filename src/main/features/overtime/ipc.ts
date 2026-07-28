import { ipcMain } from 'electron';
import { runOvertimeSubmit } from './submit';
import { getOvertimeDefaults, saveOvertimeDefaults } from './store';
import { getCredentials } from '../settings/store';
import type {
  OvertimeDefaults,
  OvertimeProgress,
  OvertimeSubmitInput,
  OvertimeSubmitResult,
} from '../../../shared/types';

/** 야근 결재(연장근무내역서 상신) IPC 핸들러 등록 */
export function registerOvertimeIpc() {
  // 입력 기본값 조회 (마지막 상신 값)
  ipcMain.handle('overtime:defaults:get', (): OvertimeDefaults => getOvertimeDefaults());

  // 상신 실행 — headless 브라우저로 작성·상신 (수십 초 소요)
  ipcMain.handle(
    'overtime:submit',
    async (e, input: OvertimeSubmitInput): Promise<OvertimeSubmitResult> => {
      const cred = getCredentials();
      if (!cred)
        return {
          ok: false,
          error: '비즈박스 계정이 없습니다. [환경설정]에서 저장하세요.',
        };
      // 업무내용은 시도 시점에 바로 저장 — 실패해도 다음 입력에서 재사용할 수 있게
      saveOvertimeDefaults({
        target: input.target,
        content: input.content,
        reason: input.reason,
      });
      try {
        const { title, docUrl } = await runOvertimeSubmit(input, cred, (step) => {
          // 진행 단계를 렌더러와 터미널 로그에 전달 (창이 닫혔으면 무시)
          console.log(`[overtime] ${step}`);
          try {
            const progress: OvertimeProgress = { step };
            e.sender.send('overtime:progress', progress);
          } catch {
            // noop
          }
        });
        return { ok: true, title, docUrl: docUrl ?? undefined };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );
}
