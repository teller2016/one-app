import { describe, expect, it } from 'vitest';
import {
  formatShortDate,
  isCheckTime,
  normalizeDayKey,
  previousWeekday,
} from './registerCheck';

const cfg = { remoteDays: [1, 5], remoteStart: '09:00', officeStart: '09:30' };

describe('previousWeekday', () => {
  it('화요일 → 월요일', () => {
    expect(previousWeekday(new Date(2026, 8, 29, 10)).getDate()).toBe(28);
  });
  it('월요일 → 지난 금요일', () => {
    const d = previousWeekday(new Date(2026, 9, 5, 10));
    expect([d.getMonth(), d.getDate(), d.getDay()]).toEqual([9, 2, 5]);
  });
  it('월초 월요일 → 전월 금요일', () => {
    const d = previousWeekday(new Date(2026, 5, 1, 10)); // 2026-06-01 월
    expect([d.getMonth(), d.getDate()]).toEqual([4, 29]);
  });
});

describe('isCheckTime', () => {
  it('재택 요일은 재택 시작 시각부터', () => {
    expect(isCheckTime(new Date(2026, 9, 5, 8, 59), cfg)).toBe(false); // 월
    expect(isCheckTime(new Date(2026, 9, 5, 9, 0), cfg)).toBe(true);
  });
  it('출근 요일은 출근 시작 시각부터', () => {
    expect(isCheckTime(new Date(2026, 8, 29, 9, 10), cfg)).toBe(false); // 화
    expect(isCheckTime(new Date(2026, 8, 29, 9, 30), cfg)).toBe(true);
  });
  it('주말은 확인하지 않는다', () => {
    expect(isCheckTime(new Date(2026, 9, 3, 12), cfg)).toBe(false); // 토
  });
});

it('formatShortDate', () => {
  expect(formatShortDate(new Date(2026, 8, 29))).toBe('9/29(화)');
});

it('normalizeDayKey — 옛 0패딩 없는 키도 같은 날로 읽는다', () => {
  expect(normalizeDayKey('2026-10-1')).toBe('2026-10-01');
  expect(normalizeDayKey('2026-09-30')).toBe('2026-09-30');
  expect(normalizeDayKey('2026/10/01')).toBeNull();
  expect(normalizeDayKey(3)).toBeNull();
});
