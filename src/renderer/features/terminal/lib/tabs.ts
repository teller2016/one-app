// 탭바 상태 헬퍼 — 탭 순서(localStorage)·통탭(tabView) 구성·마지막 활성 세션 기억.
// 메인 창(TerminalSection)과 팝아웃 창(TerminalPopoutApp)이 같은 규칙을 쓰도록
// TerminalSection 에서 떼어냈다. 화면 키(selKey)는 메인 창이 `'{wsId}:{path}'`,
// 팝아웃 창이 `win:<popoutId>` 를 쓰고 저장소는 공유한다(오리진 동일 — 키로만 갈린다).
import { useCallback, useRef } from 'react';
import type { TerminalSessionInfo } from '../../../../shared/types';
import { groupOf, sessionIdsOf } from './layout';
import type { LayoutNode } from './layout';
import type { TabItem } from '../components/SessionTabs';

/** 탭 표시 순서 — 화면(selKey)별 세션 id 배열. 화면 취향이라 분할 레이아웃과 같이 localStorage */
export const TAB_ORDER_KEY = 'terminal:tabOrder';

export function savedTabOrders(): Record<string, string[]> {
  try {
    const raw = JSON.parse(localStorage.getItem(TAB_ORDER_KEY) ?? '{}') as Record<
      string,
      unknown
    >;
    const out: Record<string, string[]> = {};
    for (const [key, v] of Object.entries(raw)) {
      const ids = Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
      if (ids.length > 0) out[key] = ids;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * 탭 순서 저장 — ⚠️ 통째 쓰기가 아니라 **그 화면(selKey) 키만** 갈아끼운다.
 * localStorage 는 메인 창·팝아웃 창이 공유하는데, 각 창의 state 는 자기 마운트 시점
 * 스냅숏이라 통째로 쓰면 다른 창이 그 사이 저장한 화면의 순서를 옛값으로 되돌린다.
 */
export function persistTabOrder(selKey: string, ids: string[]): void {
  let stored: Record<string, unknown> = {};
  try {
    stored = JSON.parse(localStorage.getItem(TAB_ORDER_KEY) ?? '{}') as Record<
      string,
      unknown
    >;
  } catch {
    stored = {};
  }
  stored[selKey] = ids;
  localStorage.setItem(TAB_ORDER_KEY, JSON.stringify(stored));
}

/** 팝아웃이 닫혀 다시 읽힐 일 없는 `win:*` 키 청소 — 메인 창이 배정 목록 기준으로 부른다 */
export function pruneWindowScreenState(liveWindowIds: string[]): void {
  const live = new Set(liveWindowIds.map((id) => `win:${id}`));
  for (const storageKey of [TAB_ORDER_KEY, 'terminal:layout', 'terminal:lastActive']) {
    try {
      const raw = JSON.parse(localStorage.getItem(storageKey) ?? '{}') as Record<
        string,
        unknown
      >;
      let changed = false;
      for (const key of Object.keys(raw)) {
        if (key.startsWith('win:') && !live.has(key)) {
          delete raw[key];
          changed = true;
        }
      }
      if (changed) localStorage.setItem(storageKey, JSON.stringify(raw));
    } catch {
      // 손상 저장소는 각 소유자(useSplitGroups 등)가 로드 시 알아서 버린다
    }
  }
}

/** 이 화면의 세션들을 사용자 지정 순서로 — 순서에 없는 세션(새로 만든 것)은 뒤에 원래 순서대로 */
export function orderTabSessions(
  base: TerminalSessionInfo[],
  order: string[] | undefined
): TerminalSessionInfo[] {
  if (!order || base.length < 2) return base;
  const rank = new Map(order.map((id, i) => [id, i]));
  // ⚠️ 미지정은 MAX_SAFE_INTEGER — Infinity 로 두면 둘 다 미지정일 때 차가 NaN 이 되어
  // 비교가 무의미해진다(같은 값이면 0 이어야 안정 정렬이 원래 순서를 지킨다).
  const at = (id: string) => rank.get(id) ?? Number.MAX_SAFE_INTEGER;
  return [...base].sort((a, b) => at(a.id) - at(b.id));
}

/**
 * 탭바 표시 구조 — 단일 세션 | 분할 그룹(멤버 배열) | 자리표시자(팝아웃 분리) 아이템 목록.
 * 그룹은 첫 멤버의 원래 자리에 멤버들을 인접 정렬해 **하나의 박스(tab-pack)** 로
 * 렌더된다. tabs 는 평탄화된 표시 순서(⌘1..9·⌃Tab·활성 보정용) — 자리표시자도
 * 번호는 차지한다(⌘n = 그 창 포커스). 활성 보정 폴백에서의 제외는 호출부 몫이다.
 */
export function buildTabView(
  tabSessions: TerminalSessionInfo[],
  groups: LayoutNode[],
  /** 팝아웃으로 분리된 세션 → 창 id — 메인 창만 쓴다(팝아웃 창은 생략) */
  detachedIds?: Map<string, string>
): { items: TabItem[]; tabs: TerminalSessionInfo[] } {
  const byId = new Map(tabSessions.map((s) => [s.id, s]));
  const placed = new Set<string>();
  const items: TabItem[] = [];
  const tabs: TerminalSessionInfo[] = [];
  for (const s of tabSessions) {
    if (placed.has(s.id)) continue;
    const windowId = detachedIds?.get(s.id);
    if (windowId) {
      // 다른 창으로 분리된 세션 — 탭 자리는 남기되(복귀 시 제자리) pane 은 그 창 소유
      items.push({ kind: 'detached', session: s, windowId });
      tabs.push(s);
      placed.add(s.id);
      continue;
    }
    const g = groups.length > 0 ? groupOf(groups, s.id) : null;
    const members = g
      ? sessionIdsOf(g)
          .map((id) => byId.get(id))
          .filter((x): x is TerminalSessionInfo => !!x)
      : [];
    if (members.length < 2) {
      // 그룹 미소속(또는 sanitize 전 과도기라 멤버가 1개뿐) — 일반 탭
      items.push({ kind: 'single', session: s });
      tabs.push(s);
      placed.add(s.id);
      continue;
    }
    for (const m of members) {
      placed.add(m.id);
      tabs.push(m);
    }
    items.push({ kind: 'group', members });
  }
  return { items, tabs };
}

/**
 * 화면(selKey)별 마지막 활성 세션 기억 — localStorage 미러로 재마운트·재시작에도 유지.
 * 반환 콜백은 참조 고정(useSplitGroups·활성 보정 effect 에 그대로 넘긴다).
 */
export function useLastActive(): {
  lastActiveRef: React.MutableRefObject<Map<string, string>>;
  rememberActive: (key: string, id: string) => void;
} {
  const lastActiveRef = useRef(
    new Map<string, string>(
      (() => {
        try {
          return Object.entries(
            JSON.parse(localStorage.getItem('terminal:lastActive') ?? '{}') as Record<
              string,
              string
            >
          );
        } catch {
          return [];
        }
      })()
    )
  );
  const rememberActive = useCallback((key: string, id: string) => {
    lastActiveRef.current.set(key, id);
    // ⚠️ 그 키만 read-merge-write — 통째로 쓰면 다른 창(팝아웃)이 그 사이 저장한
    // 화면의 기억을 이 창의 마운트 시점 스냅숏으로 되돌린다
    let stored: Record<string, unknown> = {};
    try {
      stored = JSON.parse(localStorage.getItem('terminal:lastActive') ?? '{}') as Record<
        string,
        unknown
      >;
    } catch {
      stored = {};
    }
    stored[key] = id;
    localStorage.setItem('terminal:lastActive', JSON.stringify(stored));
  }, []);
  return { lastActiveRef, rememberActive };
}
