import { ipcMain, shell } from 'electron';
import {
  getAccount,
  getAccountView,
  getDefaults,
  saveAccount,
  saveDefaults,
} from './store';
import { closePreviewWindow, runOvertimeSubmit } from './submit';
import type {
  AccountView,
  OvertimeDefaults,
  OvertimeProgress,
  OvertimeSubmitInput,
  OvertimeSubmitResult,
  SaveAccountInput,
} from '../shared/types';

/** 렌더러 ↔ 메인 IPC 핸들러 등록 */
export function registerIpc() {
  ipcMain.handle('account:get', (): AccountView => getAccountView());
  ipcMain.handle(
    'account:save',
    (_e, input: SaveAccountInput): AccountView => saveAccount(input),
  );
  ipcMain.handle('defaults:get', (): OvertimeDefaults => getDefaults());

  // 상신(또는 미리보기) 실행 — 브라우저 자동화라 수십 초 걸린다
  ipcMain.handle(
    'overtime:submit',
    async (e, input: OvertimeSubmitInput): Promise<OvertimeSubmitResult> => {
      const account = getAccount();
      if (!account) {
        return {
          ok: false,
          error: '계정이 없습니다. [설정]에서 사번(ID)과 비밀번호를 저장하세요.',
        };
      }
      // 업무내용은 시도 시점에 바로 저장 — 실패해도 다음 입력에서 재사용할 수 있게
      saveDefaults({
        target: input.target,
        content: input.content,
        reason: input.reason,
      });
      try {
        const { title, docUrl, preview } = await runOvertimeSubmit(
          input,
          account,
          (step) => {
            // 진행 단계를 렌더러와 터미널 로그에 전달 (창이 닫혔으면 무시)
            // eslint-disable-next-line no-console
            console.log(`[overtime] ${step}`);
            try {
              const progress: OvertimeProgress = { step };
              e.sender.send('overtime:progress', progress);
            } catch {
              // noop
            }
          },
        );
        return { ok: true, title, docUrl: docUrl ?? undefined, preview };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  // 미리보기 창 닫기 — 페이지 이탈 가드 때문에 창이 안 닫힐 때의 확실한 경로
  ipcMain.handle('overtime:preview:close', () => closePreviewWindow());

  // 외부 브라우저로 링크 열기 (http/https 만 허용)
  ipcMain.handle('app:openExternal', async (_e, url: string) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      await shell.openExternal(url);
      return { ok: true };
    }
    return { ok: false };
  });
}
