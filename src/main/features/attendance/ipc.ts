import { ipcMain } from 'electron';
import { runAttendance } from './attend';
import { getCredentials } from '../settings/store';
import type { AttendanceResult } from '../../../shared/types';

/** 출퇴근(근태) 관련 IPC 핸들러 등록 */
export function registerAttendanceIpc() {
  // 현재 출퇴근 시각 조회
  ipcMain.handle('attendance:fetch', async (): Promise<AttendanceResult> => {
    const cred = getCredentials();
    if (!cred)
      return {
        ok: false,
        error: '비즈박스 계정이 없습니다. [환경설정]에서 저장하세요.',
      };
    try {
      return { ok: true, info: await runAttendance('status', cred) };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  // 출근/퇴근 찍기
  ipcMain.handle(
    'attendance:stamp',
    async (_e, action: 'come' | 'leave'): Promise<AttendanceResult> => {
      const cred = getCredentials();
      if (!cred)
        return {
          ok: false,
          error: '비즈박스 계정이 없습니다. [환경설정]에서 저장하세요.',
        };
      try {
        return { ok: true, info: await runAttendance(action, cred) };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );
}
