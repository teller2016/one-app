// 분할(스플릿) 그룹 상태기계 — 트리 배열 보관·영속화·죽은 세션 정리·드래그 앤 드롭·경계 그립.
//
// TerminalSection 에서 떼어냈다. 여기 있는 것들은 서로 촘촘히 얽혀 있는데(같은 flush 안
// 실행 순서, 드래그 종료 안전망, 그립 드래그 중 저장 스킵) 섹션 안에 흩어져 있을 때는
// 수백 줄 떨어진 조각끼리 불변식을 공유했다. 한 파일로 모아 그 불변식을 옆에 둔다.
//
// **화면은 activeId 의 함수다**: 포커스 세션이 그룹에 속하면 그 그룹 전체가 보이고,
// 어디에도 안 속하면 혼자 전체 화면이다. 그룹 밖 탭을 눌러도 그룹은 해체되지 않고
// 화면만 바뀐다(예전 '포커스 슬롯 교체' 의미론은 그룹을 덮어써서 폐기 — 사용자 지적).
// 그룹은 pane 2개 이상일 때만 존재하고, 1개로 붕괴하면 배열에서 빠져 단일로 복귀한다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  DragEvent as ReactDragEvent,
  MutableRefObject,
  PointerEvent as ReactPointerEvent,
} from 'react';
import { useToast } from '../../../components/Toast';
import { beginPointerDrag } from '../../../lib/pointerDrag';
import type { TerminalSessionInfo } from '../../../../shared/types';
import {
  LAYOUT_STORAGE_KEY,
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
import type {
  DropSide,
  LayoutGrip,
  LayoutNode,
  LayoutPane,
  PaneRect,
  PanelNode,
} from './layout';

// ── 영속화 — selKey → 트리 **배열** (terminal:lastActive 와 같은 방식) ──
// 세션 생존 여부는 로드 시점에 보지 않는다(아직 세션 목록이 없다) —
// sessionsReady 이후 sanitize effect 가 걷어낸다.
function savedLayouts(): Record<string, LayoutNode[]> {
  try {
    const raw = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? '{}') as Record<
      string,
      unknown
    >;
    const out: Record<string, LayoutNode[]> = {};
    for (const [key, v] of Object.entries(raw)) {
      const list = Array.isArray(v) ? v : [v]; // 구버전(트리 하나) 호환
      const trees = list
        .map(deserializeLayout)
        // 단일 panel 트리는 저장 대상이 아니다(그룹 = pane 2개 이상) — 손상 방어
        .filter((t): t is LayoutNode => !!t && t.kind === 'split');
      if (trees.length > 0) out[key] = trees;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * 저장 — ⚠️ 통째 쓰기가 아니라 **자기 소유 키만** 갈아끼운다(read-merge-write).
 * localStorage 는 메인 창과 팝아웃 창들이 공유하는데, 각 창의 state 는 자기 마운트
 * 시점의 스냅숏이라 통째로 쓰면 다른 창이 그 사이 저장한 키를 옛값으로 되돌린다.
 */
function persistLayouts(
  map: Record<string, LayoutNode[]>,
  ownsKey: (key: string) => boolean
): void {
  let stored: Record<string, unknown> = {};
  try {
    stored = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? '{}') as Record<
      string,
      unknown
    >;
  } catch {
    stored = {};
  }
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(stored)) if (!ownsKey(k)) next[k] = v;
  for (const [k, v] of Object.entries(map)) if (ownsKey(k)) next[k] = v;
  if (Object.keys(next).length === 0) localStorage.removeItem(LAYOUT_STORAGE_KEY);
  else localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(next));
}

/** 메인 창의 레이아웃 키 소유 범위 — 팝아웃 키(win:*)만 남의 것이다 */
const OWNS_MAIN_KEYS = (key: string): boolean => !key.startsWith('win:');

/** 그룹이 하나도 없는 selKey 에 쓰는 고정 빈 배열 — 매번 [] 를 만들면 파생 memo 가 깨진다 */
const NO_GROUPS: LayoutNode[] = [];

/** 단일 모드(트리 없음)의 드롭 존이 쓰는 전체 화면 rect + 가상 panelId */
const FULL_RECT: PaneRect = { left: 0, top: 0, width: 100, height: 100 };
const SINGLE_PANEL_ID = '__single__';

export type SplitGroups = {
  /** 지금 selKey 의 그룹 트리들 — 탭바가 '통탭' 을 만들 때 쓴다 */
  groups: LayoutNode[];
  /** 보고 있는 그룹의 세션 id 들 (단일 뷰면 null) — livePanes 가 쓴다 */
  activeGroupIds: string[] | null;
  /** 보는 그룹의 pane %rect + 경계 grip (단일 뷰면 null) */
  layoutRects: {
    panes: LayoutPane[];
    grips: LayoutGrip[];
    bySession: Map<string, LayoutPane>;
  } | null;
  /** `.terminal__panes` 엘리먼트 — 그립이 포인터 좌표를 비율로 환산할 때 쓴다 */
  panesRef: MutableRefObject<HTMLDivElement | null>;
  /** 드래그 중인 세션 id (탭바 표시 + 드롭 존 노출 조건) */
  dragSession: string | null;
  /** 드래그 중에만 pane 위에 덮는 투명 오버레이들 */
  dropZones: Array<{ panelId: string; rect: PaneRect }> | null;
  /** 드롭 프리뷰 rect — 분할될 반쪽(중앙이면 pane 전체) */
  hintRect: PaneRect | null;
  onDragStartSession: (id: string) => void;
  onDragEndSession: () => void;
  /** 그룹 멤버 탭을 탭바 빈 영역에 드롭 = 그룹에서 분리 */
  detachSession: (id: string) => void;
  /** 그 세션이 속한 그룹의 멤버·직렬화 트리 — **무변경 조회**(팝아웃 창 밖 드롭이
   *  최초 레이아웃으로 쓴다). 트리 제거는 배정 변경 후 sanitize 가 알아서 한다. */
  peekGroup: (id: string) => { ids: string[]; layout: string } | null;
  /** 임의 세션을 지금 화면의 pane 자리에 드롭한 것처럼 배치 — 크로스 윈도우 드롭이
   *  배정 이동(브로드캐스트) **후에** 분할을 완성할 때 쓴다(참조 고정) */
  applyDropAt: (sessionId: string, panelId: string, side: DropSide) => void;
  // 드롭 존 오버레이가 그대로 쓰는 세 핸들러 — 판정(X자·중앙 데드존)은 전부 안에서 한다
  onZoneDragOver: (e: ReactDragEvent<HTMLDivElement>, panelId: string) => void;
  onZoneDragLeave: () => void;
  onZoneDrop: (e: ReactDragEvent<HTMLDivElement>, panelId: string) => void;
  onSplitGripDown: (e: ReactPointerEvent<HTMLDivElement>, g: LayoutGrip) => void;
};

export function useSplitGroups({
  selKey,
  selKeyRef,
  sessions,
  sessionsReady,
  activeId,
  activeIdRef,
  setActiveId,
  rememberActive,
  windowId = 'main',
  remoteDragId = null,
  onRemoteZoneDrop,
  ownsLayoutKey = OWNS_MAIN_KEYS,
}: {
  selKey: string;
  /** 최신값 ref — 드롭·그립 콜백의 참조를 고정하기 위한 것(pane·탭바 memo 유지) */
  selKeyRef: MutableRefObject<string>;
  sessions: TerminalSessionInfo[];
  /** 세션 목록 첫 수신 완료 — 이전에 sanitize 하면 복원한 그룹을 오파기한다 */
  sessionsReady: boolean;
  activeId: string | null;
  activeIdRef: MutableRefObject<string | null>;
  setActiveId: (id: string | null) => void;
  rememberActive: (key: string, id: string) => void;
  /** 이 창의 id ('main' | popoutId) — 창 간 드래그 중계의 출처 표기 */
  windowId?: string;
  /** 다른 창에서 끌고 있는 세션(중계 미러) — 있으면 이 창도 드롭 존을 켠다 */
  remoteDragId?: string | null;
  /** 다른 창의 세션이 이 창 pane 존에 드롭됐다 — 배정 이동은 호스트가 정한다
   *  (이 훅은 로컬 트리만 소유하고 IPC 를 모른다) */
  onRemoteZoneDrop?: (sessionId: string, panelId: string, side: DropSide) => void;
  /** localStorage 레이아웃 맵에서 이 창이 소유한 키 — 저장은 이 범위만 갈아끼운다
   *  (기본 = 메인 창: win:* 제외 전부. 팝아웃은 자기 `win:<id>` 하나) */
  ownsLayoutKey?: (key: string) => boolean;
}): SplitGroups {
  const toast = useToast();
  const [layouts, setLayouts] = useState<Record<string, LayoutNode[]>>(savedLayouts);
  const layoutsRef = useRef(layouts);
  layoutsRef.current = layouts;

  const groups = layouts[selKey] ?? NO_GROUPS;
  const activeTree = useMemo(
    () => (activeId ? groupOf(groups, activeId) : null),
    [groups, activeId]
  );
  const activeGroupIds = useMemo(
    () => (activeTree ? sessionIdsOf(activeTree) : null),
    [activeTree]
  );

  const updateGroups = useCallback((key: string, next: LayoutNode[]) => {
    setLayouts((cur) => {
      const prev = cur[key] ?? NO_GROUPS;
      if (prev === next) return cur;
      if (next.length === 0) {
        if (!(key in cur)) return cur;
        const rest = { ...cur };
        delete rest[key];
        return rest;
      }
      return { ...cur, [key]: next };
    });
  }, []);

  // 저장 — 그립 드래그 중엔 프레임마다 쓰지 않는다(pointerup 이 ref 로 1회 저장,
  // 마지막 setState 가 그 뒤에 렌더되면 이 effect 가 최종값을 다시 저장한다)
  const layoutDraggingRef = useRef(false);
  useEffect(() => {
    if (layoutDraggingRef.current) return;
    persistLayouts(layouts, ownsLayoutKey);
  }, [layouts, ownsLayoutKey]);

  // 죽은 세션을 그룹에서 걷어낸다(형제 승격 → 1개 남으면 그룹 해체) —
  // ⌘⇧W·자연사·외부 tmux kill 이 전부 여기로 수렴한다.
  // ⚠️ 목록 로드 완료 후에만 — 빈 초기 배열로 돌면 복원한 그룹을 통째로
  // 오파기한다(TerminalSection '선택 보정'의 ready 게이트와 같은 교훈).
  useEffect(() => {
    if (!sessionsReady) return;
    const list = layouts[selKey];
    if (!list) return;
    const alive = new Set(sessions.map((s) => s.id));
    let changed = false;
    let focusFallback: string | null = null;
    const next: LayoutNode[] = [];
    for (const g of list) {
      const r = sanitizeLayout(g, alive);
      if (r === g) {
        next.push(g);
        continue;
      }
      changed = true;
      // 보고 있던 그룹에서 focused 세션이 죽었으면 남은 멤버가 화면을 이어받는다
      const cur = activeIdRef.current;
      if (cur && !alive.has(cur) && sessionIdsOf(g).includes(cur) && r)
        focusFallback = sessionIdsOf(r)[0] ?? null;
      if (r && r.kind === 'split') next.push(r);
    }
    if (!changed) return;
    updateGroups(selKey, next);
    if (focusFallback) {
      // ⚠️ rememberActive 가 경합의 열쇠다 — 이 effect 뒤에 도는 TerminalSection 의
      // '활성 세션 보정' effect 가 remembered 를 먼저 찾으므로, 여기서 기억을 갱신해
      // 두면 둘 다 같은 세션을 고른다. 기억을 안 바꾸면 두 effect 가 서로 다른
      // setActiveId 를 쌓아 나중 것이 이긴다(같은 flush 안 순서 의존).
      rememberActive(selKey, focusFallback);
      setActiveId(focusFallback);
    }
  }, [
    sessions,
    sessionsReady,
    selKey,
    layouts,
    updateGroups,
    rememberActive,
    activeIdRef,
    setActiveId,
  ]);

  // ── 렌더 파생값 — **지금 보는 그룹**의 트리 → %rect (pane·경계 grip) ──
  const layoutRects = useMemo(() => {
    if (!activeTree) return null;
    const { panes, grips } = computeLayout(activeTree);
    return { panes, grips, bySession: new Map(panes.map((p) => [p.sessionId, p])) };
  }, [activeTree]);

  // ── 드래그 앤 드롭 — 탭(SessionTabs)이 소스, 드롭 존은 드래그 중에만 pane 위에 덮는다.
  // ⚠️ pane 자체에 dragover 를 걸지 않는 이유: xterm 의 canvas/textarea 가 이벤트를
  // 삼킬 수 있다 — 투명 오버레이가 최상단에서 독점하면 xterm 은 아예 보지 못한다.
  const [dragSession, setDragSession] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{ panelId: string; side: DropSide } | null>(
    null
  );
  // 자기 화면의 탭을 끌면 놓을 곳이 없다 — **드래그 중 다른 탭 위에 올리면 그 탭
  // (그룹 멤버면 그 그룹)의 화면이 열린다**(SessionTabs 의 스프링 로딩, selectTab 경유).
  // 원하는 화면을 하버로 열어 두고 아래 pane 에 놓으면 분할된다(2026-08-10 사용자 요청).
  const onDragStartSession = useCallback(
    (id: string) => {
      setDragSession(id);
      // 창 간 드래그 중계 — main 을 거쳐 전 창에 미러돼 다른 창도 드롭 존을 켠다.
      // 그룹 멤버면 멤버 전원을 실어 보낸다(창 밖 드롭의 그룹째 분리 판단용 참고 정보)
      const g = groupOf(layoutsRef.current[selKeyRef.current] ?? NO_GROUPS, id);
      window.oneApp?.terminal?.windows?.drag({
        sessionId: id,
        sourceWindowId: windowId,
        groupIds: g ? sessionIdsOf(g) : undefined,
      });
    },
    [windowId, selKeyRef]
  );
  const onDragEndSession = useCallback(() => {
    // 드롭이 밖에서 끝나도(무효 드롭 포함) 표시·드롭 존이 남지 않게 — WorkspaceNav 동일
    setDragSession(null);
    setDropHint(null);
    // 중계 회수 — 크로스 드롭으로 소스 탭이 언마운트되면 dragend 가 안 오지만,
    // 그 경우는 main 의 move-session 이 무조건 null 을 브로드캐스트해 준다
    window.oneApp?.terminal?.windows?.drag(null);
  }, []);

  // 다른 창의 드래그가 끝났는데 이 창에 드롭 프리뷰가 남았으면 거둔다 —
  // (원격 드래그는 이 창의 document dragend 안전망에 걸리지 않는다)
  useEffect(() => {
    if (!remoteDragId) setDropHint((cur) => (dragSession ? cur : null));
  }, [remoteDragId, dragSession]);

  // ⚠️ 크로스 윈도우 드롭은 배정 브로드캐스트로 **소스 탭이 언마운트**돼 dragend 가
  // 유실될 수 있다(document 안전망도 이 창의 drop/dragend 만 듣는다) — main 의
  // move-session 이 무조건 브로드캐스트하는 dragState null 을 회수 신호로도 쓴다.
  // 드래그 중에만 구독하므로 자기 dragend 가 보낸 null 에코로 루프가 돌지 않는다
  // (회수 즉시 구독 해제).
  useEffect(() => {
    if (!dragSession) return;
    const api = window.oneApp?.terminal?.windows;
    if (!api?.onDragState) return;
    return api.onDragState((state) => {
      if (state === null) onDragEndSession();
    });
  }, [dragSession, onDragEndSession]);

  // ⚠️ **드래그가 어떻게 끝나든 드롭 존은 반드시 사라져야 한다** — `dragend` 는 드래그
  // 소스 노드가 드롭 처리 중에 언마운트되면 오지 않는다(브라우저 공통 동작). 그러면
  // dragSession 이 남아 드롭 존 오버레이(absolute·z-index 3)가 pane 을 덮은 채 굳고,
  // 휠·클릭·드래그 선택이 전부 그 투명 레이어에 삼켜진다 — 2026-08-11 사용자 신고
  // ("합쳤다가 다시 분리하면 스크롤이 안 먹는다")의 실제 원인이었다(elementFromPoint 로
  // 휠 좌표가 .terminal__drop-zone 에 잡히는 것을 실측). 소스 탭에 의존하지 않고
  // document 에서 한 번 더 거둔다.
  // ⚠️ **bubble 단계여야 한다** — capture 로 잡으면 React 의 onDrop(applyDrop)이 값을
  // 읽기 전에 dragSession 을 비워 드롭 자체가 무효가 된다.
  useEffect(() => {
    if (!dragSession) return;
    const end = () => onDragEndSession();
    document.addEventListener('dragend', end);
    document.addEventListener('drop', end);
    return () => {
      document.removeEventListener('dragend', end);
      document.removeEventListener('drop', end);
    };
  }, [dragSession, onDragEndSession]);

  /** 그룹 멤버 탭을 탭바에 드롭 = 그룹에서 분리 — 혼자 전체 화면으로 (2026-08-10) */
  const detachSession = useCallback(
    (id: string) => {
      // 분리는 탭 구조(그룹 통탭 → 단일 탭)를 바꿔 **드래그 소스 탭이 언마운트**되는
      // 대표 경로다 — 위 안전망과 별개로 여기서도 직접 끝낸다(그룹 미소속이라
      // 아래에서 일찍 반환하더라도 드래그는 이미 끝난 것이다).
      onDragEndSession();
      const key = selKeyRef.current;
      const list = layoutsRef.current[key] ?? NO_GROUPS;
      const next = removeFromGroups(list, id);
      if (next === list) return; // 그룹 미소속 — 할 일 없음
      updateGroups(key, next);
      // '빼기'의 목적 자체가 단독 보기다 — 분리된 세션이 화면을 이어받는다
      rememberActive(key, id);
      setActiveId(id);
    },
    [updateGroups, rememberActive, onDragEndSession, selKeyRef, setActiveId]
  );

  /** 그룹 무변경 조회 — 창 밖 드롭이 그룹째 분리할 때 멤버·트리를 미리 떠 간다.
   *  여기서 트리를 지우지 않는 이유: 창 생성이 거부될 수 있고(다른 창 위 드롭 등),
   *  성공하면 배정 브로드캐스트로 세션들이 이 화면에서 빠져 sanitize 가 지운다. */
  const peekGroup = useCallback(
    (id: string): { ids: string[]; layout: string } | null => {
      const list = layoutsRef.current[selKeyRef.current] ?? NO_GROUPS;
      const g = groupOf(list, id);
      return g ? { ids: sessionIdsOf(g), layout: JSON.stringify(g) } : null;
    },
    [selKeyRef]
  );

  /** 존 안 포인터 위치 → X자(대각선) 판정 */
  const zoneSide = (e: ReactDragEvent<HTMLDivElement>): DropSide => {
    const r = e.currentTarget.getBoundingClientRect();
    return dropSideAt(e.clientX - r.left, e.clientY - r.top, r.width, r.height);
  };
  const onZoneDragOver = (e: ReactDragEvent<HTMLDivElement>, panelId: string) => {
    e.preventDefault(); // 없으면 drop 이 발화하지 않는다
    e.dataTransfer.dropEffect = 'move';
    const side = zoneSide(e);
    // dragover 는 고빈도 — 같은 값이면 setState 를 만들지 않는다
    setDropHint((cur) =>
      cur?.panelId === panelId && cur.side === side ? cur : { panelId, side }
    );
  };

  const onZoneDragLeave = () => setDropHint(null);
  const onZoneDrop = (e: ReactDragEvent<HTMLDivElement>, panelId: string) => {
    e.preventDefault();
    applyDrop(panelId, zoneSide(e));
  };

  const applyDrop = (panelId: string, side: DropSide) => {
    const dragged = dragSession;
    setDragSession(null);
    setDropHint(null);
    if (!dragged) {
      // 다른 창의 탭이 이 창 pane 존에 드롭됐다 — 로컬 트리를 여기서 만지지 않는다
      // (세션이 아직 이 창 소속이 아니라 sanitize 가 즉시 걷어낸다). 배정 이동과
      // 도착 후 배치(applyDropAt)는 호스트가 정한다.
      if (remoteDragId && onRemoteZoneDrop) onRemoteZoneDrop(remoteDragId, panelId, side);
      return;
    }
    applyDropAt(dragged, panelId, side);
  };

  /** 드롭 배치의 몸통 — dragged 세션을 panelId 의 side 에 놓는다.
   *  참조 고정 — 크로스 윈도우 드롭의 '도착 후 배치'가 effect 에서 부른다. */
  const applyDropAt = useCallback(
    (dragged: string, panelId: string, side: DropSide) => {
    const key = selKeyRef.current;
    const list = layoutsRef.current[key] ?? NO_GROUPS;
    const cur = activeIdRef.current;
    if (!cur) return;
    const view = groupOf(list, cur); // 지금 화면의 그룹 (없으면 단일 뷰)

    if (!view) {
      // 단일 뷰 — 활성 세션과 **새 그룹**을 만든다 (중앙 드롭은 그 세션으로 전환일 뿐).
      // 드래그 세션이 다른 그룹 소속이었으면 먼저 빼낸다(한 세션은 한 그룹에만).
      if (cur === dragged) return;
      if (side !== 'center') {
        const freed = removeFromGroups(list, dragged);
        const rootPanel: PanelNode = {
          kind: 'panel',
          id: crypto.randomUUID(),
          sessionId: cur,
        };
        updateGroups(key, [...freed, splitAt(rootPanel, rootPanel.id, side, dragged)]);
      }
      rememberActive(key, dragged);
      setActiveId(dragged);
      return;
    }

    const inView = sessionIdsOf(view).includes(dragged);
    if (side === 'center') {
      if (inView) {
        // 같은 그룹 안 — 두 슬롯 swap (불변식 유지)
        updateGroups(
          key,
          replaceGroup(list, view, replaceSession(view, panelId, dragged))
        );
      } else {
        // 밖에서 온 세션 — 그 pane 의 세션은 그룹 밖(단일)으로 나간다.
        // 드래그 세션이 다른 그룹 소속이었으면 먼저 빼낸다(view 는 다른 트리라 identity 유지).
        const freed = removeFromGroups(list, dragged);
        updateGroups(
          key,
          replaceGroup(freed, view, replaceSession(view, panelId, dragged))
        );
      }
    } else {
      if (inView) {
        updateGroups(
          key,
          replaceGroup(list, view, moveSession(view, dragged, panelId, side))
        );
      } else {
        if (panelsOf(view).length >= MAX_SPLIT_PANES) {
          toast(`분할은 최대 ${MAX_SPLIT_PANES}개까지입니다`, 'fail');
          return;
        }
        const freed = removeFromGroups(list, dragged);
        updateGroups(key, replaceGroup(freed, view, splitAt(view, panelId, side, dragged)));
      }
    }
    rememberActive(key, dragged);
    setActiveId(dragged); // 방금 놓은 세션이 포커스를 갖는다
    },
    [updateGroups, rememberActive, setActiveId, toast, selKeyRef, activeIdRef]
  );

  // 드롭 존 목록 — 분할 중이면 pane 마다, 단일 모드면 화면 전체 하나.
  // 다른 창의 드래그(remoteDragId 미러)도 이 창의 드롭 존을 켠다 — 크로스 윈도우 드롭
  const draggingAny = dragSession ?? remoteDragId;
  const dropZones = !draggingAny
    ? null
    : layoutRects
      ? layoutRects.panes.map((p) => ({ panelId: p.panelId, rect: p.rect }))
      : activeId
        ? [{ panelId: SINGLE_PANEL_ID, rect: FULL_RECT }]
        : null;

  // 드롭 프리뷰 rect — 분할될 반쪽(중앙이면 pane 전체)
  const hintRect = useMemo(() => {
    if (!dropHint) return null;
    const base =
      dropHint.panelId === SINGLE_PANEL_ID
        ? FULL_RECT
        : layoutRects?.panes.find((p) => p.panelId === dropHint.panelId)?.rect;
    if (!base) return null;
    let { left, top, width, height } = base;
    if (dropHint.side === 'left') width /= 2;
    else if (dropHint.side === 'right') {
      left += width / 2;
      width /= 2;
    } else if (dropHint.side === 'top') height /= 2;
    else if (dropHint.side === 'bottom') {
      top += height / 2;
      height /= 2;
    }
    return { left, top, width, height };
  }, [dropHint, layoutRects]);

  // ── 분할 경계 그립 — 포인터 드래그로 그 SplitNode 의 ratio 만 바꾼다.
  // fit·PTY resize 는 pane 자신의 ResizeObserver(rAF)·120ms 디바운스가 방어한다.
  const panesRef = useRef<HTMLDivElement | null>(null);
  const onSplitGripDown = (e: ReactPointerEvent<HTMLDivElement>, g: LayoutGrip) => {
    e.preventDefault();
    const box = panesRef.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return;
    const key = selKeyRef.current;
    const horizontal = g.orientation === 'row';
    layoutDraggingRef.current = true;
    // 그 split 의 영역(region, %)을 px 로 — 포인터 위치를 영역 안 비율로 환산한다
    const rl = box.left + (g.region.left / 100) * box.width;
    const rw = (g.region.width / 100) * box.width;
    const rt = box.top + (g.region.top / 100) * box.height;
    const rh = (g.region.height / 100) * box.height;
    beginPointerDrag(e, {
      cursor: horizontal ? 'col-resize' : 'row-resize',
      onMove: (ev) => {
        const ratio = horizontal ? (ev.clientX - rl) / rw : (ev.clientY - rt) / rh;
        if (!Number.isFinite(ratio)) return;
        // ⚠️ 트리는 setRatio 마다 참조가 바뀌므로 identity 가 아니라 splitId 로 찾는다
        const list = layoutsRef.current[key] ?? NO_GROUPS;
        const tree = list.find((t) => findSplit(t, g.splitId));
        if (!tree) return;
        updateGroups(key, replaceGroup(list, tree, setRatio(tree, g.splitId, ratio)));
      },
      onEnd: () => {
        layoutDraggingRef.current = false;
        persistLayouts(layoutsRef.current, ownsLayoutKey); // 놓는 순간 1회 저장
      },
    });
  };

  return {
    groups,
    activeGroupIds,
    layoutRects,
    panesRef,
    dragSession,
    dropZones,
    hintRect,
    onDragStartSession,
    onDragEndSession,
    detachSession,
    peekGroup,
    applyDropAt,
    onZoneDragOver,
    onZoneDragLeave,
    onZoneDrop,
    onSplitGripDown,
  };
}
