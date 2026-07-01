// 프로세스(main / preload / renderer) 간 공용 타입

export type ScheduleDateOption = {
  type: 'today' | 'yesterday' | 'date';
  date?: string;
};

export type ScheduleRunPayload = {
  scheduleText: string;
  startTime: string;
  dateOption: ScheduleDateOption;
  testMode: boolean;
};

export type ScheduleRunResult = {
  ok: boolean;
  error?: string;
  code?: number | null;
};

export type ScheduleOutputChunk = { stream: string; data: string };

export type ScheduleDoneInfo = { code: number | null };

// ── 환경설정 ──
export type AppSettingsView = {
  bizboxId: string;
  hasPassword: boolean;
};

export type SaveSettingsInput = {
  bizboxId: string;
  password?: string; // 빈 값이면 기존 비밀번호 유지
};
