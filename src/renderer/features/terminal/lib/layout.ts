// 터미널 분할 레이아웃 — 이진 트리 (토스 '트리 구조로 UI 를 만들어보자' 방식).
// PanelNode(세션 하나) / SplitNode(가로·세로 분할 + 비율)로 화면을 표현하고,
// 렌더는 트리를 순회해 %rect 를 계산한 뒤 pane 을 absolute 로 배치한다 —
// pane 이 React 트리에서 재부모화(reparenting)되면 xterm 이 언마운트되므로
// 트리는 상태로만 두고 화면은 플랫한 형제 + 좌표로 그린다.
//
// ⚠️ 불변식: 한 세션은 트리에 **한 번만** 등장한다 — main 의 attach 추적이
// 세션 id Set(ipc.ts desktopAttached)이라 같은 세션의 pane 이 둘이면
// 한쪽의 detach 가 다른 쪽의 data 방송까지 끊는다. moveSession(선제 제거)·
// replaceSession(swap)·sanitizeLayout(중복 제거)이 3중으로 지킨다.
//
// 모든 갱신 함수는 불변 갱신이며 **변화가 없으면 원본 참조를 그대로 반환**한다 —
// 참조가 같으면 상위의 useMemo·memo 가 재계산/리렌더를 건너뛴다.

export type PanelNode = { kind: 'panel'; id: string; sessionId: string };
export type SplitNode = {
  kind: 'split';
  id: string;
  /** row = 좌우 분할(a|b), column = 상하 분할(a 위/b 아래) */
  orientation: 'row' | 'column';
  /** a 의 비중 (RATIO_MIN~RATIO_MAX) */
  ratio: number;
  a: LayoutNode;
  b: LayoutNode;
};
export type LayoutNode = PanelNode | SplitNode;

/** 드롭 판정 결과 — 가장자리 4방향(분할) + 중앙(세션 교체) */
export type DropSide = 'left' | 'right' | 'top' | 'bottom' | 'center';

/** 컨테이너(.terminal__panes) 기준 % 좌표 */
export type PaneRect = { left: number; top: number; width: number; height: number };
export type LayoutPane = { panelId: string; sessionId: string; rect: PaneRect };
export type LayoutGrip = {
  splitId: string;
  orientation: 'row' | 'column';
  /** 경계선 위치 — row 면 width 0, column 이면 height 0 (실폭은 CSS 가 벌린다) */
  rect: PaneRect;
  /** 이 SplitNode 가 차지한 영역 — 포인터 좌표 → ratio 환산용 */
  region: PaneRect;
};

/** 동시 표시 pane 상한 — MAX_LIVE_PANES(8, WebGL 전역 컨텍스트 제한) 안에서
 *  숨은 pane 여유(탭 전환 즉시 복원)를 남기는 값 */
export const MAX_SPLIT_PANES = 4;
export const RATIO_MIN = 0.15;
export const RATIO_MAX = 0.85;
/** 중앙 데드존 — 정규화 좌표(|nx|,|ny| < 0.3)면 분할이 아니라 교체 */
export const CENTER_DEADZONE = 0.3;
/** localStorage 키 — selKey → 직렬화 트리 맵 (terminal:lastActive 와 같은 방식) */
export const LAYOUT_STORAGE_KEY = 'terminal:layout';

export function panelsOf(root: LayoutNode): PanelNode[] {
  if (root.kind === 'panel') return [root];
  return [...panelsOf(root.a), ...panelsOf(root.b)];
}

export function sessionIdsOf(root: LayoutNode): string[] {
  return panelsOf(root).map((p) => p.sessionId);
}

export function findPanel(root: LayoutNode, panelId: string): PanelNode | null {
  if (root.kind === 'panel') return root.id === panelId ? root : null;
  return findPanel(root.a, panelId) ?? findPanel(root.b, panelId);
}

/** panelId 를 직접 자식으로 가진 SplitNode */
function parentOf(root: LayoutNode, panelId: string): SplitNode | null {
  if (root.kind === 'panel') return null;
  if (
    (root.a.kind === 'panel' && root.a.id === panelId) ||
    (root.b.kind === 'panel' && root.b.id === panelId)
  )
    return root;
  return parentOf(root.a, panelId) ?? parentOf(root.b, panelId);
}

/** 대상 panel 을 SplitNode 로 치환 — left/top 은 새 세션이 a(앞), right/bottom 은 b(뒤) */
export function splitAt(
  root: LayoutNode,
  targetPanelId: string,
  side: Exclude<DropSide, 'center'>,
  newSessionId: string
): LayoutNode {
  if (root.kind === 'panel') {
    if (root.id !== targetPanelId) return root;
    const fresh: PanelNode = {
      kind: 'panel',
      id: crypto.randomUUID(),
      sessionId: newSessionId,
    };
    const before = side === 'left' || side === 'top';
    return {
      kind: 'split',
      id: crypto.randomUUID(),
      orientation: side === 'left' || side === 'right' ? 'row' : 'column',
      ratio: 0.5,
      a: before ? fresh : root,
      b: before ? root : fresh,
    };
  }
  const a = splitAt(root.a, targetPanelId, side, newSessionId);
  const b = splitAt(root.b, targetPanelId, side, newSessionId);
  return a === root.a && b === root.b ? root : { ...root, a, b };
}

/**
 * 세션의 panel 제거 + 형제 승격 — 부모 SplitNode 가 형제 서브트리로 치환된다.
 * ⚠️ 승격된 서브트리의 노드 id 는 보존한다 — 진행 중인 드롭 제스처의 panelId 참조가
 * 제거 후에도 유효해야 한다(moveSession 이 제거 → 재분할 순서로 쓴다).
 */
export function removeSession(root: LayoutNode, sessionId: string): LayoutNode | null {
  if (root.kind === 'panel') return root.sessionId === sessionId ? null : root;
  const a = removeSession(root.a, sessionId);
  const b = removeSession(root.b, sessionId);
  if (a === root.a && b === root.b) return root;
  if (a && b) return { ...root, a, b };
  return a ?? b;
}

/**
 * 중앙 드롭 — 대상 panel 의 세션을 교체한다.
 * 드롭 세션이 이미 트리의 다른 panel 에 있으면 두 panel 의 세션을 **맞바꾼다**(swap) —
 * 그대로 덮으면 같은 세션이 두 번 등장해 불변식이 깨진다.
 */
export function replaceSession(
  root: LayoutNode,
  panelId: string,
  sessionId: string
): LayoutNode {
  const target = findPanel(root, panelId);
  if (!target || target.sessionId === sessionId) return root;
  const existing = panelsOf(root).find((p) => p.sessionId === sessionId) ?? null;
  const map = (node: LayoutNode): LayoutNode => {
    if (node.kind === 'panel') {
      if (node.id === panelId) return { ...node, sessionId };
      if (existing && node.id === existing.id)
        return { ...node, sessionId: target.sessionId };
      return node;
    }
    const a = map(node.a);
    const b = map(node.b);
    return a === node.a && b === node.b ? node : { ...node, a, b };
  };
  return map(root);
}

/**
 * 드롭 적용 — 트리 안 세션이면 옮기고(선제 제거 → 재분할), 밖 세션이면 분할만.
 * 이미 같은 배치가 되는 드롭(자기 pane, 바로 옆 형제 자리)은 원본 참조를 반환한다.
 */
export function moveSession(
  root: LayoutNode,
  sessionId: string,
  targetPanelId: string,
  side: DropSide
): LayoutNode {
  if (side === 'center') return replaceSession(root, targetPanelId, sessionId);
  const target = findPanel(root, targetPanelId);
  if (!target) return root;
  if (target.sessionId === sessionId) return root; // 자기 pane 모서리 — 배치 불변

  // 결과가 지금과 같은 드롭이면 no-op — 대상의 부모 split 에서 드래그 세션이
  // 이미 그 방향·그 자리의 형제인 경우 (제거→재분할하면 ratio 만 0.5 로 리셋돼 버린다)
  const parent = parentOf(root, targetPanelId);
  if (parent) {
    const targetIsA = parent.a.kind === 'panel' && parent.a.id === targetPanelId;
    const sibling = targetIsA ? parent.b : parent.a;
    const wantRow = side === 'left' || side === 'right';
    const draggedBefore = side === 'left' || side === 'top'; // 드래그 세션이 a 자리인가
    if (
      sibling.kind === 'panel' &&
      sibling.sessionId === sessionId &&
      (parent.orientation === 'row') === wantRow &&
      draggedBefore !== targetIsA // 드래그가 a 자리 ↔ target 은 b 자리 (또는 그 반대)
    )
      return root;
  }

  const removed = removeSession(root, sessionId);
  // 트리 밖 세션이면 removed === root(참조 유지) — 그대로 분할하면 된다
  if (!removed || !findPanel(removed, targetPanelId)) return root; // 방어 — 도달 불가 경로
  return splitAt(removed, targetPanelId, side, sessionId);
}

/** 경계 드래그 — ratio 클램프 + 소수 3자리(localStorage 에 긴 부동소수 방지) */
export function setRatio(root: LayoutNode, splitId: string, ratio: number): LayoutNode {
  const clamped =
    Math.round(Math.min(RATIO_MAX, Math.max(RATIO_MIN, ratio)) * 1000) / 1000;
  const map = (node: LayoutNode): LayoutNode => {
    if (node.kind === 'panel') return node;
    if (node.id === splitId)
      return node.ratio === clamped ? node : { ...node, ratio: clamped };
    const a = map(node.a);
    const b = map(node.b);
    return a === node.a && b === node.b ? node : { ...node, a, b };
  };
  return map(root);
}

/** 트리 순회 → pane %rect + 경계 grip 목록 (루트 = 0,0,100,100) */
export function computeLayout(root: LayoutNode): {
  panes: LayoutPane[];
  grips: LayoutGrip[];
} {
  const panes: LayoutPane[] = [];
  const grips: LayoutGrip[] = [];
  const walk = (node: LayoutNode, rect: PaneRect) => {
    if (node.kind === 'panel') {
      panes.push({ panelId: node.id, sessionId: node.sessionId, rect });
      return;
    }
    if (node.orientation === 'row') {
      const aW = rect.width * node.ratio;
      walk(node.a, { ...rect, width: aW });
      walk(node.b, { ...rect, left: rect.left + aW, width: rect.width - aW });
      grips.push({
        splitId: node.id,
        orientation: 'row',
        rect: { left: rect.left + aW, top: rect.top, width: 0, height: rect.height },
        region: rect,
      });
    } else {
      const aH = rect.height * node.ratio;
      walk(node.a, { ...rect, height: aH });
      walk(node.b, { ...rect, top: rect.top + aH, height: rect.height - aH });
      grips.push({
        splitId: node.id,
        orientation: 'column',
        rect: { left: rect.left, top: rect.top + aH, width: rect.width, height: 0 },
        region: rect,
      });
    }
  };
  walk(root, { left: 0, top: 0, width: 100, height: 100 });
  return { panes, grips };
}

/**
 * X자(대각선) 판정 — pane 안 좌표를 축별로 정규화(-1~1)해 어느 삼각형에 있는지 본다.
 * 축별 정규화라 pane 종횡비와 무관하게 대각선이 정확히 네 모서리를 지난다.
 */
export function dropSideAt(x: number, y: number, w: number, h: number): DropSide {
  if (w <= 0 || h <= 0) return 'center';
  const nx = (x / w) * 2 - 1;
  const ny = (y / h) * 2 - 1;
  if (Math.abs(nx) < CENTER_DEADZONE && Math.abs(ny) < CENTER_DEADZONE) return 'center';
  if (Math.abs(nx) > Math.abs(ny)) return nx < 0 ? 'left' : 'right';
  return ny < 0 ? 'top' : 'bottom';
}

/** 저장값 복원 — 형태만 검증한다(세션 생존 여부는 sanitizeLayout 이 나중에) */
export function deserializeLayout(v: unknown): LayoutNode | null {
  if (typeof v !== 'object' || v === null) return null;
  const n = v as Record<string, unknown>;
  if (n.kind === 'panel') {
    return typeof n.id === 'string' && typeof n.sessionId === 'string'
      ? { kind: 'panel', id: n.id, sessionId: n.sessionId }
      : null;
  }
  if (n.kind === 'split') {
    const a = deserializeLayout(n.a);
    const b = deserializeLayout(n.b);
    if (
      !a ||
      !b ||
      typeof n.id !== 'string' ||
      (n.orientation !== 'row' && n.orientation !== 'column') ||
      typeof n.ratio !== 'number' ||
      !Number.isFinite(n.ratio)
    )
      return null;
    return {
      kind: 'split',
      id: n.id,
      orientation: n.orientation,
      ratio: Math.min(RATIO_MAX, Math.max(RATIO_MIN, n.ratio)),
      a,
      b,
    };
  }
  return null;
}

/**
 * 죽은 세션 + 중복 세션 제거(불변식 최후 방어선 — 직렬화 손상 대비).
 * 부분 생존이면 형제 승격, 전멸이면 null. 변화 없으면 원본 참조.
 */
export function sanitizeLayout(
  root: LayoutNode,
  alive: ReadonlySet<string>
): LayoutNode | null {
  const seen = new Set<string>();
  const walk = (node: LayoutNode): LayoutNode | null => {
    if (node.kind === 'panel') {
      if (!alive.has(node.sessionId) || seen.has(node.sessionId)) return null;
      seen.add(node.sessionId);
      return node;
    }
    const a = walk(node.a);
    const b = walk(node.b);
    if (a === node.a && b === node.b) return node;
    if (a && b) return { ...node, a, b };
    return a ?? b;
  };
  return walk(root);
}
