import { ipcMain } from 'electron';
import { openEaBox } from './eaBox';
import { runExpendDraft } from './expend';
import { runOvertimeDraft } from './overtime';
import {
  getExpendDefaults,
  getOvertimeDefaults,
  getVacationDefaults,
  saveExpendDefaults,
  saveOvertimeDefaults,
  saveVacationDefaults,
} from './store';
import { fetchVacationStatus, runVacationDraft } from './vacation';
import { getCredentials } from '../settings/store';
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
} from '../../../shared/types';

/** 진행 단계를 렌더러와 터미널 로그에 함께 보낸다 (창이 닫혔으면 무시) */
const progressSender = (sender: Electron.WebContents) => (step: string) => {
  console.log(`[approval] ${step}`);
  try {
    const progress: ApprovalProgress = { step };
    sender.send('approval:progress', progress);
  } catch {
    // noop
  }
};

const NO_ACCOUNT = '비즈박스 계정이 없습니다. [환경설정]에서 ID·비밀번호를 저장하세요.';

/** 결재(야근·지출결의서·휴가신청서) IPC 핸들러 등록 */
export function registerApprovalIpc() {
  ipcMain.handle('approval:overtime:defaults', (): OvertimeDefaults =>
    getOvertimeDefaults(),
  );
  ipcMain.handle('approval:expend:defaults', (): ExpendDefaults =>
    getExpendDefaults(),
  );
  ipcMain.handle('approval:vacation:defaults', (): VacationDefaults =>
    getVacationDefaults(),
  );

  // 야근 결재 — 자동화 창으로 양식 작성 (상신은 사용자가 그 창에서 직접)
  ipcMain.handle(
    'approval:overtime:submit',
    async (e, input: OvertimeSubmitInput): Promise<OvertimeSubmitResult> => {
      if (!getCredentials()) return { ok: false, error: NO_ACCOUNT };
      // 업무내용은 시도 시점에 바로 저장 — 실패해도 다음 입력에서 재사용할 수 있게
      saveOvertimeDefaults({
        target: input.target,
        content: input.content,
        reason: input.reason,
      });
      try {
        const { title } = await runOvertimeDraft(input, progressSender(e.sender));
        return { ok: true, title };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  // 지출결의서 — 항목을 채운 뒤 상신하지 않고 화면을 남긴다
  ipcMain.handle(
    'approval:expend:run',
    async (e, input: ExpendInput): Promise<ExpendResult> => {
      if (!getCredentials()) return { ok: false, error: NO_ACCOUNT };
      if (input.parking) {
        saveExpendDefaults({
          manCount: input.parking.manCount,
          halfCount: input.parking.halfCount,
        });
      }
      try {
        return await runExpendDraft(input, progressSender(e.sender));
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  // 휴가신청서 — 작성 + [내역추가] + [결재상신] → 전자결재 창까지 준비 (상신은 사용자가)
  ipcMain.handle(
    'approval:vacation:submit',
    async (e, input: VacationInput): Promise<VacationResult> => {
      if (!getCredentials()) return { ok: false, error: NO_ACCOUNT };
      // 비상연락망·인수인계는 매번 같으니 시도 시점에 저장해 다음 입력에 채운다
      saveVacationDefaults({
        emergencyContact: input.emergencyContact,
        handovers: input.handovers,
      });
      try {
        return await runVacationDraft(input, progressSender(e.sender));
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  // 연차 현황 조회 (잔여연차 표시)
  ipcMain.handle(
    'approval:vacation:status',
    async (): Promise<{ ok: boolean; status?: VacationStatus; error?: string }> => {
      if (!getCredentials()) return { ok: false, error: NO_ACCOUNT };
      try {
        return { ok: true, status: await fetchVacationStatus() };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  // 전자결재 상신함 열기 — 작성 후 "내가 올린 문서" 확인 경로 (작성 창과 별개 창)
  ipcMain.handle(
    'approval:open-ea-box',
    async (): Promise<{ ok: boolean; error?: string }> => {
      if (!getCredentials()) return { ok: false, error: NO_ACCOUNT };
      try {
        await openEaBox();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );
}
