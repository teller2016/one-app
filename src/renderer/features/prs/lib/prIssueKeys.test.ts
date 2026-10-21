import { describe, expect, it } from 'vitest';
import type { JiraIssueStatus } from '../../../../shared/types';
import { primaryIssueKey, prIssueKeys } from './prIssueKeys';

const st: JiraIssueStatus = { status: '해결됨', statusCategory: 'indeterminate' };

describe('prIssueKeys', () => {
  it('브랜치 키가 제목 키보다 앞선다', () => {
    expect(prIssueKeys({ head: 'feature/SSB-86', title: '[SSB-90] fix: 후기' })).toEqual([
      'SSB-86',
      'SSB-90',
    ]);
  });

  it('브랜치에 키가 없으면 제목에서 찾는다 (light 단계의 head 없음 포함)', () => {
    expect(prIssueKeys({ head: 'feature/cart-total', title: '[SSB-37] feat: 쿠폰' })).toEqual([
      'SSB-37',
    ]);
    expect(prIssueKeys({ title: '[SSB-37] feat: 쿠폰' })).toEqual(['SSB-37']);
  });

  it('같은 키는 한 번만, 접미사(-v2)는 떼고 잡는다', () => {
    expect(
      prIssueKeys({ head: 'feature/SSB-137-v2', title: '[SSB-137-v2] feat(mypage): 설정' }),
    ).toEqual(['SSB-137']);
  });
});

describe('primaryIssueKey', () => {
  it('Jira 에 없는 브랜치 오탐은 건너뛰고 상태가 있는 키를 고른다', () => {
    const pr = { head: 'release/V2-1', title: '[SSB-37] feat: 쿠폰' };
    expect(primaryIssueKey(pr, { 'SSB-37': st })).toBe('SSB-37');
  });

  it('상태를 아직 모르면 첫 후보(브랜치)', () => {
    expect(primaryIssueKey({ head: 'feature/SSB-86', title: '[SSB-90] x' }, {})).toBe('SSB-86');
  });

  it('키가 없으면 undefined', () => {
    expect(primaryIssueKey({ head: 'main', title: 'chore: 정리' }, {})).toBeUndefined();
  });
});
