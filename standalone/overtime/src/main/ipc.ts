import { ipcMain, shell } from 'electron';
import { runExpendDraft } from './expend';
import { closeKeptPage } from './keeper';
import {
  getAccount,
  getAccountView,
  getDefaults,
  getExpendDefaults,
  saveAccount,
  saveDefaults,
  saveExpendDefaults,
} from './store';
import { runOvertimeSubmit } from './submit';
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
} from '../shared/types';

/** 진행 단계를 렌더러와 터미널 로그에 함께 보낸다 (창이 닫혔으면 무시) */
const progressSender = (sender: Electron.WebContents) => (step: string) => {
  // eslint-disable-next-line no-console
  console.log(`[draft] ${step}`);
  try {
    const progress: OvertimeProgress = { step };
    sender.send('draft:progress', progress);
  } catch {
    // noop
  }
};

/** 렌더러 ↔ 메인 IPC 핸들러 등록 */
export function registerIpc() {
  ipcMain.handle('account:get', (): AccountView => getAccountView());
  ipcMain.handle(
    'account:save',
    (_e, input: SaveAccountInput): AccountView => saveAccount(input),
  );
  ipcMain.handle('defaults:get', (): OvertimeDefaults => getDefaults());
  ipcMain.handle('expend:defaults:get', (): ExpendDefaults => getExpendDefaults());

  // 야근 결재 상신(또는 미리보기) — 브라우저 자동화라 수십 초 걸린다
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
          progressSender(e.sender),
        );
        return { ok: true, title, docUrl: docUrl ?? undefined, preview };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  // 지출결의서 작성 — 항목을 채운 뒤 상신하지 않고 화면을 남긴다
  ipcMain.handle(
    'expend:run',
    async (e, input: ExpendInput): Promise<ExpendResult> => {
      const account = getAccount();
      if (!account) {
        return {
          ok: false,
          error: '계정이 없습니다. [설정]에서 사번(ID)과 비밀번호를 저장하세요.',
        };
      }
      if (input.parking) {
        saveExpendDefaults({
          manCount: input.parking.manCount,
          halfCount: input.parking.halfCount,
        });
      }
      try {
        return await runExpendDraft(input, account, progressSender(e.sender));
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  // 남겨둔 자동화 창 닫기 — 페이지 이탈 가드로 창이 안 닫힐 때의 확실한 경로
  ipcMain.handle('window:close-kept', () => closeKeptPage());

  // 외부 브라우저로 링크 열기 (http/https 만 허용)
  ipcMain.handle('app:openExternal', async (_e, url: string) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      await shell.openExternal(url);
      return { ok: true };
    }
    return { ok: false };
  });
}
