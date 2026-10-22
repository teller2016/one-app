import { describe, expect, it } from 'vitest';
import { branchNameFor, isSafeBranchName, pickPlace, type PlanWorktree } from './ticketPlan';

const MAIN: PlanWorktree = { path: '/repo', branch: 'main', isMain: true, dirty: false };
const none = () => 0;

describe('branchNameFor', () => {
  it('버그 계열은 fix/, 그 외는 feature/', () => {
    expect(branchNameFor('SSB-1', '버그')).toBe('fix/SSB-1');
    expect(branchNameFor('SSB-1', 'Bug')).toBe('fix/SSB-1');
    expect(branchNameFor('SSB-1', '작업')).toBe('feature/SSB-1');
  });
});

describe('isSafeBranchName', () => {
  it('보통 브랜치 이름은 받는다', () => {
    for (const b of ['feature/SSB-137', 'fix/SSB-1-coupon', 'test/root-session-check', 'develop', 'release/1.2.0']) {
      expect(isSafeBranchName(b)).toBe(true);
    }
  });
  it('폴더·옵션으로 읽힐 수 있는 이름은 막는다', () => {
    for (const b of ['.', '..', '.git', 'src/.hidden', '-rf', 'a/-x', '/abs', 'a//b', 'a/', 'a..b', 'x.lock', 'a.', '', 'a b', "a'b", '~/x']) {
      expect(isSafeBranchName(b)).toBe(false);
    }
  });
});

describe('pickPlace', () => {
  it('① 그 티켓 브랜치의 워크트리가 있으면 거기', () => {
    const wt = { path: '/wt/a', branch: 'feature/SSB-1', isMain: false, dirty: true };
    expect(pickPlace({ key: 'SSB-1', issueType: '작업', worktrees: [MAIN, wt], branches: [], sessionsAt: none })).toEqual({
      kind: 'existing',
      path: '/wt/a',
      branch: 'feature/SSB-1',
      main: false,
    });
  });

  it('② 브랜치만 있으면(원격 포함) 그 브랜치로 새 워크트리 — 새 이름을 만들지 않는다', () => {
    expect(
      pickPlace({ key: 'SSB-1', issueType: '버그', worktrees: [MAIN], branches: ['main', 'origin/feature/SSB-1'], sessionsAt: none }),
    ).toEqual({ kind: 'new', branch: 'feature/SSB-1', fromBranch: true });
  });

  it('③ 주 체크아웃이 비어 있으면(기본 브랜치·변경 없음·세션 없음) 주 체크아웃', () => {
    expect(pickPlace({ key: 'SSB-1', issueType: '작업', worktrees: [MAIN], branches: ['main'], sessionsAt: none })).toEqual({
      kind: 'main',
      path: '/repo',
      branch: 'main',
    });
  });

  it('④ 주 체크아웃이 쓰이는 중이면 이슈 유형으로 새 브랜치 워크트리', () => {
    const busy = (p: string) => (p === '/repo' ? 1 : 0);
    expect(pickPlace({ key: 'SSB-1', issueType: '버그', worktrees: [MAIN], branches: [], sessionsAt: busy })).toEqual({
      kind: 'new',
      branch: 'fix/SSB-1',
      fromBranch: false,
    });
    const dirty = { ...MAIN, dirty: true };
    expect(pickPlace({ key: 'SSB-1', issueType: '작업', worktrees: [dirty], branches: [], sessionsAt: none }).kind).toBe('new');
    const onFeature = { ...MAIN, branch: 'feature/SSB-9' };
    expect(pickPlace({ key: 'SSB-1', issueType: '작업', worktrees: [onFeature], branches: [], sessionsAt: none }).kind).toBe('new');
  });
});
