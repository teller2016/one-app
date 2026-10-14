import { describe, expect, it } from 'vitest';
import { alreadyStampedTime } from './stampGuard';

const TODAY = '2026.10.14';

describe('alreadyStampedTime', () => {
  it('오늘 출근이 찍혀 있으면 출근을 막는다', () => {
    expect(
      alreadyStampedTime('come', { comeTime: '09:02', leaveTime: null, date: TODAY }, TODAY),
    ).toBe('09:02');
  });

  it('출근 전이면 출근을 허용한다', () => {
    expect(
      alreadyStampedTime('come', { comeTime: null, leaveTime: null, date: '' }, TODAY),
    ).toBeNull();
  });

  it('위젯이 전날 기록을 보여주면 출근을 허용한다 (자정 직후)', () => {
    expect(
      alreadyStampedTime(
        'come',
        { comeTime: '09:00', leaveTime: '18:10', date: '2026.10.13' },
        TODAY,
      ),
    ).toBeNull();
  });

  it('퇴근이 찍혀 있으면 퇴근을 막는다', () => {
    expect(
      alreadyStampedTime('leave', { comeTime: '09:02', leaveTime: '18:30', date: TODAY }, TODAY),
    ).toBe('18:30');
  });

  it('자정 넘긴 야근 — 위젯 날짜가 전날이어도 퇴근이 찍혀 있으면 막는다', () => {
    expect(
      alreadyStampedTime(
        'leave',
        { comeTime: '09:00', leaveTime: '00:40', date: '2026.10.13' },
        TODAY,
      ),
    ).toBe('00:40');
  });

  it('출근만 했으면 퇴근을 허용한다', () => {
    expect(
      alreadyStampedTime('leave', { comeTime: '09:02', leaveTime: null, date: TODAY }, TODAY),
    ).toBeNull();
  });
});
