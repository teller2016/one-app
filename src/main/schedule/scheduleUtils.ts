// 일정 파싱 / 시간·날짜 변환 (Day_Schedule_Macro/src/schedule.js 이식)
import type { ScheduleDateOption } from '../../shared/types';

export interface ScheduleItem {
  start: number;
  end: number;
  title: string;
}

// Date → 'YYYY-MM-DD'
export const formatDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// 'YYYY-MM-DD' 문자열 → Date (형식 및 존재 여부 검증)
export const parseDateString = (value: string): Date => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error(`잘못된 날짜 형식입니다: "${value}" (예: 2026-06-15)`);
  }

  const [, year, month, day] = match.map(Number);
  const date = new Date(year, month - 1, day);
  // 존재하지 않는 날짜(예: 2026-02-31)가 다른 날로 넘어가는 것을 방지
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    throw new Error(`존재하지 않는 날짜입니다: "${value}"`);
  }

  return date;
};

// 날짜 옵션 → 등록 기준 Date
export const resolveBaseDate = (dateOption: ScheduleDateOption): Date => {
  if (dateOption.type === 'yesterday') {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return date;
  }
  if (dateOption.type === 'date' && dateOption.date) {
    return parseDateString(dateOption.date);
  }
  return new Date();
};

// 소수 시간 → 'HH:mm' (10.5 → '10:30', 10.25 → '10:15')
export const formatTime = (time: number): string => {
  const numberTime = Number(time);
  const hour = Math.floor(numberTime);
  const minute = Math.round((numberTime - hour) * 60);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
};

// 소수 시간 + 기준 날짜 → 'YYYY-MM-DDTHH:mm:ss'
export const getDateTimeFormat = (time: number, baseDate: Date): string =>
  `${formatDate(baseDate)}T${formatTime(time)}:00`;

// 일정 줄 배열 → { start, end, title } 배열 (start 는 직전 일정 종료 시각으로 자동 계산)
export const getFilteredData = (
  lines: string[],
  workStartTime: number,
  lunchStartTime: number,
  lunchEndTime: number,
  onWarn?: (msg: string) => void,
): ScheduleItem[] => {
  const schedules: ScheduleItem[] = [];

  lines.forEach((line, index) => {
    const match = line.match(/^(\d+(?:\.\d+)?)\s+(.+)$/);
    if (!match) {
      onWarn?.(
        `⚠️  형식이 올바르지 않아 건너뜁니다 (${index + 1}번째 줄): "${line}"\n`,
      );
      return;
    }
    schedules.push({ end: parseFloat(match[1]), title: match[2], start: 0 });
  });

  let currentStartTime = workStartTime;
  schedules.forEach((schedule) => {
    schedule.start = currentStartTime;
    // 점심 시작 시간에 끝나는 일정 다음은 점심 종료 후 시작
    currentStartTime =
      schedule.end === lunchStartTime ? lunchEndTime : schedule.end;
  });

  return schedules;
};
