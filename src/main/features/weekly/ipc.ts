import { ipcMain } from 'electron';
import { collectWeekly } from './collect';
import { getCredentials } from '../settings/store';
import type { WeeklyFetchResult, WeeklyProgress } from '../../../shared/types';

/** 주간보고 관련 IPC 핸들러 등록 */
export function registerWeeklyIpc() {
  // 개인별 주간 일정 수집 (weekOffset: 0=이번주, -1=지난주 …)
  ipcMain.handle(
    'weekly:fetch',
    async (e, weekOffset: number): Promise<WeeklyFetchResult> => {
      const cred = getCredentials();
      if (!cred)
        return {
          ok: false,
          error: '비즈박스 계정이 없습니다. [환경설정]에서 저장하세요.',
        };
      try {
        const offset = Number.isFinite(weekOffset) ? Math.trunc(weekOffset) : 0;
        console.log(`[weekly] 수집 시작 (offset ${offset})`);
        const { rows, period } = await collectWeekly(offset, cred, (step) => {
          // 진행 단계를 렌더러와 터미널 로그에 전달 (창이 닫혔으면 무시)
          console.log(`[weekly] ${step}`);
          try {
            const progress: WeeklyProgress = { step };
            e.sender.send('weekly:progress', progress);
          } catch {
            // noop
          }
        });
        console.log(`[weekly] 수집 완료 — ${rows.length}행 (${period.start}~${period.end})`);
        return { ok: true, rows, period };
      } catch (err) {
        console.error('[weekly] 수집 실패:', (err as Error).message);
        return { ok: false, error: (err as Error).message };
      }
    },
  );
}
