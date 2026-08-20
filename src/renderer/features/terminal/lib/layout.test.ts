// 터미널 분할 레이아웃 테스트 — layout.ts 의 순수 함수만 다룬다.
//
// 이 트리는 화면 배치일 뿐 아니라 **attach 계약**이기도 하다: main 의 데스크톱 attach 추적이
// 세션 id `Set`(ipc.ts `desktopAttached`)이라 같은 세션의 pane 이 둘이면 한쪽 detach 가 다른
// 쪽의 출력 방송까지 끊는다. 그래서 "한 세션은 트리에 한 번만" 이 최우선 불변식이고,
// moveSession(선제 제거)·replaceSession(swap)·sanitizeLayout(중복 제거)이 3중으로 지킨다.
//
// 참조 유지(무변화면 원본 그대로) 규칙도 함께 고정한다 — 상위 useMemo·memo 가 그 identity 로
// 재계산을 건너뛰고, 그립 드래그 중에는 ratio 가 리셋되는지 여부까지 여기에 달려 있다.
import { describe, expect, it } from 'vitest';
import {
  MAX_SPLIT_PANES,
  computeLayout,
  deserializeLayout,
  dropSideAt,
  findSplit,
  groupOf,
  moveSession,
  panelsOf,
  removeFromGroups,
  replaceGroup,
  replaceSession,
  sanitizeLayout,
  sessionIdsOf,
  setRatio,
  splitAt,
} from './layout';
import type { LayoutNode, PanelNode, SplitNode } from './layout';

const panel = (sessionId: string, id = `p-${sessionId}`): PanelNode => ({
  kind: 'panel',
  id,
  sessionId,
});

const split = (
  a: LayoutNode,
  b: LayoutNode,
  over: Partial<Omit<SplitNode, 'kind' | 'a' | 'b'>> = {}
): SplitNode => ({
  kind: 'split',
  id: 's1',
  orientation: 'row',
  ratio: 0.5,
  a,
  b,
  ...over,
});

/** 최우선 불변식 — 한 세션이 트리에 두 번 나오면 안 된다 */
const noDuplicateSession = (root: LayoutNode) => {
  const ids = sessionIdsOf(root);
  expect(new Set(ids).size).toBe(ids.length);
};

describe('splitAt — 대상 pane 을 둘로 가른다', () => {
  it('left·top 이면 새 세션이 앞(a), right·bottom 이면 뒤(b)', () => {
    const root = panel('A');
    const left = splitAt(root, root.id, 'left', 'B') as SplitNode;
    expect(left.orientation).toBe('row');
    expect(sessionIdsOf(left)).toEqual(['B', 'A']);

    const bottom = splitAt(root, root.id, 'bottom', 'B') as SplitNode;
    expect(bottom.orientation).toBe('column');
    expect(sessionIdsOf(bottom)).toEqual(['A', 'B']);
  });

  it('대상이 없으면 원본 참조 그대로 (상위 memo 가 재계산을 건너뛴다)', () => {
    const root = split(panel('A'), panel('B'));
    expect(splitAt(root, 'p-없음', 'right', 'C')).toBe(root);
  });

  it('중첩 트리에서도 대상 pane 만 갈라진다', () => {
    const root = split(panel('A'), panel('B'));
    const next = splitAt(root, 'p-B', 'right', 'C');
    expect(sessionIdsOf(next)).toEqual(['A', 'B', 'C']);
    noDuplicateSession(next);
  });
});

describe('replaceSession — 중앙 드롭(세션 교체)', () => {
  it('트리 안 세션을 끌어오면 **맞바꾼다** (덮어쓰면 같은 세션이 두 pane 이 된다)', () => {
    const root = split(panel('A'), panel('B'));
    const next = replaceSession(root, 'p-A', 'B');
    expect(sessionIdsOf(next)).toEqual(['B', 'A']);
    noDuplicateSession(next);
  });

  it('트리 밖 세션이면 그 자리만 바뀐다', () => {
    const root = split(panel('A'), panel('B'));
    expect(sessionIdsOf(replaceSession(root, 'p-A', 'C'))).toEqual(['C', 'B']);
  });

  it('같은 세션을 같은 자리에 놓으면 원본 참조 그대로', () => {
    const root = split(panel('A'), panel('B'));
    expect(replaceSession(root, 'p-A', 'A')).toBe(root);
  });
});

describe('moveSession — 가장자리 드롭(자리 옮기기)', () => {
  it('트리 안 세션은 제거 후 재분할된다 — 중복이 남지 않는다', () => {
    const root = split(panel('A'), split(panel('B'), panel('C'), { id: 's2' }));
    const next = moveSession(root, 'C', 'p-A', 'left');
    expect(sessionIdsOf(next)).toEqual(['C', 'A', 'B']);
    noDuplicateSession(next);
  });

  it('트리 밖 세션이면 분할만 한다', () => {
    const root = split(panel('A'), panel('B'));
    const next = moveSession(root, 'Z', 'p-B', 'bottom');
    expect(sessionIdsOf(next)).toEqual(['A', 'B', 'Z']);
    noDuplicateSession(next);
  });

  it('자기 pane 모서리에 놓으면 배치가 그대로다 (원본 참조)', () => {
    const root = split(panel('A'), panel('B'));
    expect(moveSession(root, 'A', 'p-A', 'right')).toBe(root);
  });

  it('⚠️ 이미 그 자리인 형제로 놓으면 no-op — 제거→재분할하면 ratio 가 0.5 로 리셋된다', () => {
    // A|B 에서 A 를 B 의 왼쪽에 놓기 = 지금과 같은 배치. 비율을 손대지 않아야 한다.
    const root = split(panel('A'), panel('B'), { ratio: 0.8 });
    expect(moveSession(root, 'A', 'p-B', 'left')).toBe(root);
  });

  it('방향이 다르면(가로 → 세로) no-op 이 아니다', () => {
    const root = split(panel('A'), panel('B'), { ratio: 0.8 });
    const next = moveSession(root, 'A', 'p-B', 'top');
    expect(next).not.toBe(root);
    expect((next as SplitNode).orientation).toBe('column');
    noDuplicateSession(next);
  });

  it('center 는 replaceSession 과 같은 처리(swap)', () => {
    const root = split(panel('A'), panel('B'));
    expect(sessionIdsOf(moveSession(root, 'B', 'p-A', 'center'))).toEqual(['B', 'A']);
  });
});

describe('removeFromGroups — 세션이 빠지면 형제가 승격한다', () => {
  it('pane 2개짜리 그룹에서 하나가 빠지면 그룹이 해체된다', () => {
    const groups = [split(panel('A'), panel('B'))];
    expect(removeFromGroups(groups, 'A')).toEqual([]);
  });

  it('3개짜리는 형제 승격으로 살아남는다', () => {
    const groups = [split(panel('A'), split(panel('B'), panel('C'), { id: 's2' }))];
    const next = removeFromGroups(groups, 'B');
    expect(sessionIdsOf(next[0])).toEqual(['A', 'C']);
  });

  it('속하지 않은 세션이면 원본 배열 참조 그대로', () => {
    const groups = [split(panel('A'), panel('B'))];
    expect(removeFromGroups(groups, 'Z')).toBe(groups);
  });

  it('다른 그룹은 건드리지 않는다', () => {
    const g1 = split(panel('A'), panel('B'));
    const g2 = split(panel('C'), panel('D'), { id: 's2' });
    const next = removeFromGroups([g1, g2], 'C');
    expect(next).toEqual([g1]); // g2 는 해체, g1 은 그대로
    expect(next[0]).toBe(g1);
  });
});

describe('sanitizeLayout — 죽은 세션·중복 제거 (최후 방어선)', () => {
  it('죽은 세션이 빠지고 형제가 승격한다', () => {
    const root = split(panel('A'), split(panel('B'), panel('C'), { id: 's2' }));
    const next = sanitizeLayout(root, new Set(['A', 'C']));
    expect(sessionIdsOf(next as LayoutNode)).toEqual(['A', 'C']);
  });

  it('전멸하면 null', () => {
    const root = split(panel('A'), panel('B'));
    expect(sanitizeLayout(root, new Set())).toBeNull();
  });

  it('전부 살아 있으면 원본 참조 — 살아 있는 그룹이 매 브로드캐스트마다 다시 만들어지지 않는다', () => {
    const root = split(panel('A'), panel('B'));
    expect(sanitizeLayout(root, new Set(['A', 'B']))).toBe(root);
  });

  it('⚠️ 직렬화가 손상돼 같은 세션이 두 번 있으면 뒤의 것을 버린다', () => {
    // 남아 있으면 pane 두 개가 한 세션에 attach 해 한쪽 detach 가 다른 쪽 출력을 끊는다
    const root = split(panel('A', 'p1'), panel('A', 'p2'));
    const next = sanitizeLayout(root, new Set(['A']));
    expect(next).toEqual(panel('A', 'p1'));
  });
});

describe('setRatio — 경계 드래그', () => {
  it('범위를 벗어나면 클램프하고 소수 3자리로 자른다', () => {
    const root = split(panel('A'), panel('B'));
    expect((setRatio(root, 's1', 0.01) as SplitNode).ratio).toBe(0.15);
    expect((setRatio(root, 's1', 9) as SplitNode).ratio).toBe(0.85);
    // 범위 안(0.15~0.85) 값이라야 반올림만 걸린다 — localStorage 에 긴 부동소수를 남기지 않는다
    expect((setRatio(root, 's1', 0.333333) as SplitNode).ratio).toBe(0.333);
  });

  it('같은 값이면 원본 참조 (드래그 중 불필요한 리렌더 방지)', () => {
    const root = split(panel('A'), panel('B'), { ratio: 0.5 });
    expect(setRatio(root, 's1', 0.5)).toBe(root);
  });
});

describe('computeLayout — 트리 → %rect', () => {
  it('가로 분할은 ratio 대로 폭을 나누고 빈틈이 없다', () => {
    const { panes, grips } = computeLayout(split(panel('A'), panel('B'), { ratio: 0.3 }));
    expect(panes.map((p) => p.rect.width)).toEqual([30, 70]);
    expect(panes[1].rect.left).toBe(30);
    expect(panes[0].rect.height).toBe(100);
    // 경계 grip 은 두 pane 사이 — 실폭은 CSS 가 벌린다(여기선 0)
    expect(grips).toHaveLength(1);
    expect(grips[0]).toMatchObject({ splitId: 's1', orientation: 'row' });
    expect(grips[0].rect.left).toBe(30);
    expect(grips[0].rect.width).toBe(0);
  });

  it('세로 분할은 높이를 나눈다', () => {
    const { panes } = computeLayout(
      split(panel('A'), panel('B'), { orientation: 'column', ratio: 0.25 })
    );
    expect(panes.map((p) => p.rect.height)).toEqual([25, 75]);
    expect(panes[1].rect.top).toBe(25);
  });

  it('중첩 트리 — 면적 합이 100 이다', () => {
    const { panes } = computeLayout(
      split(panel('A'), split(panel('B'), panel('C'), { id: 's2', orientation: 'column' }))
    );
    const area = panes.reduce((sum, p) => sum + (p.rect.width * p.rect.height) / 100, 0);
    expect(Math.round(area)).toBe(100);
    expect(panes).toHaveLength(3);
  });
});

describe('dropSideAt — X자 판정 + 중앙 데드존', () => {
  const W = 100;
  const H = 100;

  it('가운데는 center(세션 교체)', () => {
    expect(dropSideAt(50, 50, W, H)).toBe('center');
  });

  it('네 모서리 방향은 각각의 변', () => {
    expect(dropSideAt(5, 50, W, H)).toBe('left');
    expect(dropSideAt(95, 50, W, H)).toBe('right');
    expect(dropSideAt(50, 5, W, H)).toBe('top');
    expect(dropSideAt(50, 95, W, H)).toBe('bottom');
  });

  it('축별 정규화라 pane 이 납작해도 대각선이 모서리를 지난다', () => {
    // 폭 400 × 높이 100 에서 좌상단 모서리 근처 — 비정규화라면 left 로 잡힌다
    expect(dropSideAt(20, 5, 400, 100)).toBe('top');
  });

  it('크기가 0이면 center (드래그 중 레이아웃 붕괴 방어)', () => {
    expect(dropSideAt(0, 0, 0, 0)).toBe('center');
  });
});

describe('deserializeLayout — 저장값 복원', () => {
  it('정상 트리는 그대로 복원된다', () => {
    const root = split(panel('A'), panel('B'), { ratio: 0.4 });
    expect(deserializeLayout(JSON.parse(JSON.stringify(root)))).toEqual(root);
  });

  it('ratio 는 복원 시에도 클램프된다', () => {
    const bad = { ...split(panel('A'), panel('B')), ratio: 2 };
    expect((deserializeLayout(bad) as SplitNode).ratio).toBe(0.85);
  });

  it('형태가 깨졌으면 null — 통째로 버리고 단일 뷰로 돌아간다', () => {
    expect(deserializeLayout(null)).toBeNull();
    expect(deserializeLayout({ kind: 'panel' })).toBeNull(); // sessionId 없음
    expect(deserializeLayout({ ...split(panel('A'), panel('B')), ratio: 'x' })).toBeNull();
    expect(deserializeLayout({ ...split(panel('A'), panel('B')), a: 1 })).toBeNull();
  });
});

describe('그룹 목록 유틸', () => {
  const g1 = split(panel('A'), panel('B'));
  const g2 = split(panel('C'), panel('D'), { id: 's2' });

  it('groupOf — 세션이 속한 그룹을 찾는다 (없으면 null)', () => {
    expect(groupOf([g1, g2], 'C')).toBe(g2);
    expect(groupOf([g1, g2], 'Z')).toBeNull();
  });

  it('replaceGroup — split 이 아니게 되면(해체) 목록에서 빠진다', () => {
    expect(replaceGroup([g1, g2], g2, null)).toEqual([g1]);
    expect(replaceGroup([g1, g2], g2, panel('C'))).toEqual([g1]);
  });

  it('replaceGroup — prev 와 next 가 같은 참조면 원본 배열 그대로', () => {
    const groups = [g1, g2];
    expect(replaceGroup(groups, g1, g1)).toBe(groups);
  });

  it('findSplit — 노드 id 로 찾는다 (트리 참조는 setRatio 마다 바뀐다)', () => {
    const nested = split(panel('A'), g2);
    expect(findSplit(nested, 's2')).toBe(g2);
    expect(findSplit(nested, '없음')).toBeNull();
    expect(findSplit(panel('A'), 's1')).toBeNull();
  });

  it('panelsOf — 분할 상한(MAX_SPLIT_PANES) 판정의 근거', () => {
    expect(panelsOf(g1)).toHaveLength(2);
    expect(MAX_SPLIT_PANES).toBeGreaterThanOrEqual(2);
  });
});
