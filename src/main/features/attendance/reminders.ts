// 출퇴근 리마인더 설정 저장 — 비밀 정보가 없어 평문 JSON(userData/reminders.json)에 저장.
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import type {
  ReminderConfig,
  ReminderSlot,
  ReminderRepeat,
  DayReminderConfig,
} from '../../../shared/types';

const filePath = () => path.join(app.getPath('userData'), 'reminders.json');

// 기본값 — 월~금 출근 09:00 / 퇴근 18:00 (사용자가 요일별로 조정)
const defaults = (): ReminderConfig => ({
  days: [1, 2, 3, 4, 5].map((day) => ({
    day,
    come: { enabled: true, time: '09:00' },
    leave: { enabled: true, time: '18:00' },
  })),
  repeat: { enabled: false, minutes: 10 },
});

const normalizeSlot = (s: Partial<ReminderSlot> | undefined): ReminderSlot => ({
  enabled: !!s?.enabled,
  time: typeof s?.time === 'string' && /^\d{2}:\d{2}$/.test(s.time) ? s.time : '09:00',
});

// 반복 간격은 1~120분으로 보정 (이전 버전 파일엔 repeat 가 없을 수 있음)
const normalizeRepeat = (r: Partial<ReminderRepeat> | undefined): ReminderRepeat => ({
  enabled: !!r?.enabled,
  minutes:
    typeof r?.minutes === 'number' && Number.isFinite(r.minutes)
      ? Math.min(120, Math.max(1, Math.round(r.minutes)))
      : 10,
});

export function getReminderConfig(): ReminderConfig {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath(), 'utf8')) as ReminderConfig;
    if (Array.isArray(parsed.days)) {
      return { days: parsed.days, repeat: normalizeRepeat(parsed.repeat) };
    }
  } catch {
    // 파일 없음/손상 → 기본값
  }
  return defaults();
}

export function saveReminderConfig(config: ReminderConfig): ReminderConfig {
  const clean: ReminderConfig = {
    days: (config?.days ?? [])
      .filter((d) => d && d.day >= 1 && d.day <= 5)
      .map(
        (d): DayReminderConfig => ({
          day: d.day,
          come: normalizeSlot(d.come),
          leave: normalizeSlot(d.leave),
        }),
      ),
    repeat: normalizeRepeat(config?.repeat),
  };
  fs.writeFileSync(filePath(), JSON.stringify(clean, null, 2), 'utf8');
  return clean;
}
