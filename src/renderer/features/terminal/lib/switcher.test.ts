// ⌘⇧P 세션 전환 — 저장소별 묶음·정렬·검색 테스트
import { describe, expect, it } from 'vitest';
import type { TerminalOverviewItem } from '../../../../shared/types';
import { groupSessions, matches, phaseCounts, showBranch } from './switcher';

const ws = (id: string, name = id) => ({ id, name });
let seq = 0;
const item = (o: Partial<TerminalOverviewItem>): TerminalOverviewItem => ({
  id: `s${++seq}`,
  cwd: '/x',
  tabTitle: 'tab',
  status: 'idle',
  working: false,
  workspace: null,
  branch: null,
  title: null,
  firstPrompt: null,
  lastPrompt: null,
  activityAt: 0,
  ...o,
});

describe('groupSessions', () => {
  it('묶음 안은 입력 대기 → 작업 중 → 쉬는 중, 같으면 최근순', () => {
    const a = item({ workspace: ws('w'), status: 'idle', activityAt: 9 });
    const b = item({ workspace: ws('w'), status: 'busy', working: true, activityAt: 1 });
    const c = item({ workspace: ws('w'), status: 'waiting', activityAt: 2 });
    const d = item({ workspace: ws('w'), status: 'waiting', activityAt: 5 });
    const [g] = groupSessions([a, b, c, d]);
    expect(g.sessions.map((s) => s.id)).toEqual([d.id, c.id, b.id, a.id]);
  });

  it('묶음끼리는 가장 급한 세션 기준, 워크스페이스 밖(기타)은 맨 아래', () => {
    const other = item({ status: 'waiting', activityAt: 99 });
    const runOnly = item({ workspace: ws('run'), status: 'busy', working: true, activityAt: 50 });
    const hasWait = item({ workspace: ws('wait'), status: 'waiting', activityAt: 1 });
    const idle = item({ workspace: ws('wait'), status: 'idle', activityAt: 80 });
    const groups = groupSessions([other, runOnly, idle, hasWait]);
    expect(groups.map((g) => g.key)).toEqual(['wait', 'run', '']);
    expect(groups[0].sessions.map((s) => s.id)).toEqual([hasWait.id, idle.id]);
  });

  it('busy 여도 working 이 아니면 쉬는 중으로 센다', () => {
    expect(phaseCounts([item({ status: 'busy', working: false }), item({ status: 'waiting' })])).toEqual({
      wait: 1,
      run: 0,
      idle: 1,
    });
  });
});

describe('matches', () => {
  it('제목·요청·저장소·브랜치를 함께 찾는다', () => {
    const s = item({ title: '주문 필터', lastPrompt: '커밋해줘', workspace: ws('w', 'BBJ admin'), branch: 'bugfix/bbj-1125' });
    expect(matches(s, 'bbj admin')).toBe(true);
    expect(matches(s, '1125 주문')).toBe(true);
    expect(matches(s, '배포')).toBe(false);
  });
});

describe('showBranch', () => {
  it('기본 브랜치·없음은 칩을 달지 않는다', () => {
    expect(showBranch('main')).toBe(false);
    expect(showBranch('master')).toBe(false);
    expect(showBranch(null)).toBe(false);
    expect(showBranch('feature/SSB-9')).toBe(true);
  });
});
