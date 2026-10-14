import { describe, expect, it } from 'vitest';
import { failureOf, formatAuditLine, summarizeArgs } from './moAuditFormat';

describe('summarizeArgs', () => {
  it('원시값은 그대로, 객체는 JSON 으로 잇는다', () => {
    expect(summarizeArgs(['proj-1', 42, { worktreePath: '/a/b' }])).toBe(
      'proj-1 · 42 · {"worktreePath":"/a/b"}',
    );
  });

  it('긴 글과 줄바꿈은 한 줄로 줄여 자른다', () => {
    const out = summarizeArgs(['첫 줄\n둘째 줄 ' + 'x'.repeat(80)]);
    expect(out.startsWith('첫 줄 둘째 줄 ')).toBe(true);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBe(61);
  });

  it('undefined·null·함수는 건너뛴다', () => {
    expect(summarizeArgs([undefined, null, () => 1, 'come'])).toBe('come');
  });
});

describe('failureOf', () => {
  it('{ ok: false, error } 이면 그 문구', () => {
    expect(failureOf({ ok: false, error: '이미 배포가 진행 중입니다.' })).toBe(
      '이미 배포가 진행 중입니다.',
    );
  });

  it('error 가 없으면 기본 문구', () => {
    expect(failureOf({ ok: false })).toBe('실패');
  });

  it('성공·원시값·ok 없는 객체는 null', () => {
    expect(failureOf({ ok: true })).toBeNull();
    expect(failureOf(undefined)).toBeNull();
    expect(failureOf({ commits: [] })).toBeNull();
  });
});

describe('formatAuditLine', () => {
  const at = new Date('2026-10-14T05:20:03.000Z');

  it('성공 줄', () => {
    expect(formatAuditLine(at, '출퇴근 찍기', 'attendance:stamp', ['come'], null)).toBe(
      '[2026-10-14T05:20:03.000Z] OK 출퇴근 찍기 (attendance:stamp) come\n',
    );
  });

  it('실패 줄은 이유를 붙인다', () => {
    expect(formatAuditLine(at, 'PR 머지', 'prs:merge', ['repo', 7], '충돌')).toBe(
      '[2026-10-14T05:20:03.000Z] FAIL PR 머지 (prs:merge) repo · 7 — 충돌\n',
    );
  });
});
