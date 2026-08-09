import { ipcMain } from 'electron';
import { handleShared } from '../../lib/moIpc';
import { runAttendance } from './attend';
import { getCredentials } from '../settings/store';
import { getReminderConfig, saveReminderConfig } from './reminders';
import { refreshReminderSchedule } from './scheduler';
import type {
  AttendanceResult,
  ReminderConfig,
} from '../../../shared/types';

/** 출퇴근(근태) 관련 IPC 핸들러 등록 */
export function registerAttendanceIpc() {
  // 현재 출퇴근 시각 조회 (MO 공유 — 헤드리스라 폰에서도 안전. 수십 초 걸릴 수 있다)
  handleShared('attendance:fetch', async (): Promise<AttendanceResult> => {
    const cred = getCredentials();
    if (!cred)
      return {
        ok: false,
        error: '비즈박스 계정이 없습니다. [환경설정]에서 저장하세요.',
      };
    try {
      return { ok: true, info: await runAttendance('status') };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  });

  // 출근/퇴근 찍기 (MO 공유 — 폰에서도 확인 다이얼로그를 거친다)
  handleShared(
    'attendance:stamp',
    async (action: 'come' | 'leave'): Promise<AttendanceResult> => {
      const cred = getCredentials();
      if (!cred)
        return {
          ok: false,
          error: '비즈박스 계정이 없습니다. [환경설정]에서 저장하세요.',
        };
      try {
        return { ok: true, info: await runAttendance(action) };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  // 출퇴근 리마인더 설정 조회/저장 (스케줄러는 저장값을 매 tick 읽으므로 재시작 불필요)
  ipcMain.handle('reminders:get', (): ReminderConfig => getReminderConfig());
  ipcMain.handle('reminders:set', (_e, config: ReminderConfig): ReminderConfig => {
    const saved = saveReminderConfig(config);
    // 전부 껐으면 타이머를 멈추고, 다시 켜면 되살린다 (재시작 없이 반영)
    refreshReminderSchedule();
    return saved;
  });
}
