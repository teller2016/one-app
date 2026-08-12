// 터미널 섹션 — LNB(워크스페이스 → 워크트리 트리) + 상단 세션 탭 + xterm + 우측 변경사항
// (Superset 스타일 오케스트레이터). 세션은 main 프로세스 소유라 탭·창을 닫아도 유지되고,
// MO(모바일)와 같은 세션을 공유한다. 워크트리를 고르면 탭바가 그 위치(cwd)의 세션들로 바뀐다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  DragEvent as ReactDragEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import type {
  ChangesTarget,
  TerminalPreset,
  TerminalSessionInfo,
  TerminalWorkspace,
  WorktreeInfo,
} from '../../../../shared/types';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { useConfirm } from '../../../components/ConfirmDialog';
import { EmptyState } from '../../../components/EmptyState';
import { Icon } from '../../../components/Icon';
import { useToast } from '../../../components/Toast';
import { Tooltip } from '../../../components/Tooltip';
import type { TerminalFocusRequest } from '../../../lib/sectionNav';
import { useTerminalFocusRequest } from '../../../lib/sectionNav';
import { usePolling } from '../../../lib/usePolling';
import { ChangesOverlay, ChangesView } from '../../changes';
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
} from '../lib/layout';
import type {
  DropSide,
  LayoutGrip,
  LayoutNode,
  PaneRect,
  PanelNode,
} from '../lib/layout';
import {
  agentIdFromCommand,
  presetsForWorkspace,
  worktreeName,
} from '../lib/workspace';
import type { WorkspaceSelection } from '../lib/workspace';
import { MoAccessModal } from './MoAccessModal';
import { NewSessionModal } from './NewSessionModal';
import { PresetBar } from './PresetBar';
import { PresetsModal } from './PresetsModal';
import { NewWorkspaceModal } from './NewWorkspaceModal';
import { NewWorktreeModal } from './NewWorktreeModal';
import { SessionTabs } from './SessionTabs';
import type { TabItem } from './SessionTabs';
import {
  FONT_SIZE_DEFAULT,
  FONT_SIZE_KEY,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  TerminalView,
} from './TerminalView';
import type { TerminalPaneHandle } from './TerminalView';
import { WorkspaceNav } from './WorkspaceNav';

// 터미널 IPC 노출 여부 — 개발 중 main/preload 변경은 HMR 이 안 되므로(렌더러만 갱신)
// 앱을 재시작하기 전까지 이 API 가 없다. 없으면 버튼이 조용히 죽는 대신 안내를 띄운다.
const terminalApi = () => window.oneApp?.terminal;

// 워크트리 목록·±변경량 갱신 주기 — 로컬 git 명령 몇 개라 수십 ms, 보이는 동안만 돈다
const WORKTREE_POLL_MS = 10_000;

/**
 * 동시에 살려 두는 xterm pane 수 상한 (최근 사용 순).
 *
 * 세션은 그대로 두고 **화면(pane)만** 재활용한다 — 버려진 pane 은 다시 고르는 순간
 * attach 로 복원되므로(tmux 가 전체 화면을 다시 그린다) 잃는 것은 xterm 쪽 스크롤백·
 * 선택 영역뿐이다. 상한이 필요한 이유는 WebGL 컨텍스트가 **브라우저 전역으로 개수 제한**이
 * 있어서, 넘기면 오래된 컨텍스트가 강제 유실되며 이미 열린 터미널이 깨지기 때문이다.
 */
const MAX_LIVE_PANES = 8;

/** 프리셋이 없는 위치에 넘길 고정 빈 배열 — 매번 [] 를 만들면 pane 의 memo 가 깨진다 */
const NO_PRESETS: TerminalPreset[] = [];

// 변경사항 드로어 너비 — 좌측 모서리 드래그로 조절, localStorage 기억
const CHANGES_MIN_W = 240;
const CHANGES_MAX_W = 640;
const CHANGES_DEFAULT_W = 320;

// 워크스페이스 패널 너비 — 우측 모서리 드래그로 조절하고 SNAP 아래로 끌면 아이콘 타일만 남는다.
// (앱 사이드바 Sidebar.tsx 와 같은 규칙 — 저장은 놓는 순간 1회)
// 축소 폭 48 = border(1) + 타일(34) 중앙 정렬 → 좌우 6.5px
// (40 은 타일이 벽에 붙어 답답했다 — 2026-08-06 사용자 지적. 구분선도 6px 인셋과 세트)
const SIDE_COLLAPSED_W = 48;
const SIDE_MIN_W = 180;
const SIDE_MAX_W = 400;
const SIDE_DEFAULT_W = 240;
/** 드래그로 이 폭 아래까지 끌면 축소 모드로 넘어간다 */
const SIDE_SNAP_W = 140;

// 터미널 글자 크기 — 세션 pane 이 여러 개 살아 있으므로 값은 여기 한 곳에서만 들고
// 모든 pane 에 내려준다 (화면 취향이라 localStorage 로 충분 — 보존 대상 아님)
function savedFontSize(): number {
  const n = Number(localStorage.getItem(FONT_SIZE_KEY));
  return Number.isFinite(n) && n >= FONT_SIZE_MIN && n <= FONT_SIZE_MAX
    ? n
    : FONT_SIZE_DEFAULT;
}

function savedChangesWidth(): number {
  const saved = Number(localStorage.getItem('terminal:changesWidth'));
  return Number.isFinite(saved) && saved >= CHANGES_MIN_W && saved <= CHANGES_MAX_W
    ? saved
    : CHANGES_DEFAULT_W;
}

function savedSideWidth(): number {
  const saved = Number(localStorage.getItem('terminal:sideWidth'));
  return Number.isFinite(saved) && saved >= SIDE_MIN_W && saved <= SIDE_MAX_W
    ? saved
    : SIDE_DEFAULT_W;
}

function savedExpanded(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem('terminal:wsExpanded') ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function savedSelection(): WorkspaceSelection | null {
  try {
    const v = JSON.parse(localStorage.getItem('terminal:wsSelection') ?? 'null');
    if (v?.kind === 'other') return { kind: 'other' };
    if (v?.kind === 'worktree' && typeof v.wsId === 'string' && typeof v.path === 'string')
      return { kind: 'worktree', wsId: v.wsId, path: v.path };
    return null;
  } catch {
    return null;
  }
}

// ── 분할 그룹 (lib/layout.ts) — selKey → 트리 **배열**을 localStorage 에 기억 ──
// terminal:lastActive 와 같은 방식. 세션 생존 여부는 여기서 보지 않는다(로드 시점엔
// 세션 목록이 없다) — sessionsReady 이후 sanitize effect 가 걷어낸다.
function savedLayouts(): Record<string, LayoutNode[]> {
  try {
    const raw = JSON.parse(
      localStorage.getItem(LAYOUT_STORAGE_KEY) ?? '{}'
    ) as Record<string, unknown>;
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

function persistLayouts(map: Record<string, LayoutNode[]>): void {
  if (Object.keys(map).length === 0) localStorage.removeItem(LAYOUT_STORAGE_KEY);
  else localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(map));
}

/** 그룹이 하나도 없는 selKey 에 쓰는 고정 빈 배열 — 매번 [] 를 만들면 파생 memo 가 깨진다 */
const NO_GROUPS: LayoutNode[] = [];

/** 단일 모드(트리 없음)의 드롭 존이 쓰는 전체 화면 rect + 가상 panelId */
const FULL_RECT: PaneRect = { left: 0, top: 0, width: 100, height: 100 };
const SINGLE_PANEL_ID = '__single__';

export function TerminalSection() {
  const confirm = useConfirm();
  const toast = useToast();
  const [sessions, setSessions] = useState<TerminalSessionInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const [workspaces, setWorkspaces] = useState<TerminalWorkspace[]>([]);
  const [worktrees, setWorktrees] = useState<Record<string, WorktreeInfo[]>>({});
  const [expanded, setExpanded] = useState<string[]>(savedExpanded);
  const [selection, setSelection] = useState<WorkspaceSelection | null>(savedSelection);

  const [newWsOpen, setNewWsOpen] = useState(false);
  const [worktreeFor, setWorktreeFor] = useState<TerminalWorkspace | null>(null);
  const [newSessionOpen, setNewSessionOpen] = useState(false);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [moOpen, setMoOpen] = useState(false);
  const [moRunning, setMoRunning] = useState(false);
  // 변경사항 드로어 — 열림 여부는 세션과 무관한 화면 취향이라 localStorage 로 기억
  const [changesOpen, setChangesOpen] = useState(
    () => localStorage.getItem('terminal:changesOpen') === '1'
  );
  const [changesFullOpen, setChangesFullOpen] = useState(false);
  // 분할 그룹(트리 배열) — selKey 별. 파생값·갱신·영속화는 아래 '분할 그룹' 블록
  const [layouts, setLayouts] = useState<Record<string, LayoutNode[]>>(savedLayouts);
  const available = !!terminalApi();

  const [fontSize, setFontSize] = useState(savedFontSize);
  // pane 들이 memo 로 묶여 있으므로 내려보내는 콜백은 전부 참조가 고정돼야 한다
  const changeFontSize = useCallback((n: number) => {
    localStorage.setItem(FONT_SIZE_KEY, String(n));
    setFontSize(n);
  }, []);

  // ── 워크스페이스 목록 — main 저장 + 브로드캐스트 구독 ──
  // ⚠️ ready 플래그 — 아래 '선택 보정' effect 가 목록 로드 **전**(빈 배열)에 돌면
  // 저장된 선택을 무효로 판정해 지우고 첫 워크스페이스로 폴백한다. 그래서 다른 섹션에
  // 다녀올 때마다(재마운트) 선택이 최상단 레포로 초기화됐다(2026-08-06 사용자 보고).
  const [wsReady, setWsReady] = useState(false);
  const [sessionsReady, setSessionsReady] = useState(false);
  useEffect(() => {
    const api = window.oneApp?.workspaces;
    if (!api) return;
    void api.list().then((list) => {
      setWorkspaces(list);
      setWsReady(true);
    });
    return api.onChanged(setWorkspaces);
  }, []);

  // ── 워크트리 목록·±변경량 — 워크스페이스가 바뀌면 즉시, 이후 폴링으로 따라간다 ──
  const workspacesRef = useRef(workspaces);
  workspacesRef.current = workspaces;
  const refreshWorktrees = useCallback(async () => {
    const api = window.oneApp?.workspaces;
    if (!api) return;
    const list = workspacesRef.current;
    const entries = await Promise.all(
      list.map(async (ws) => {
        try {
          return [ws.id, await api.worktrees(ws.id)] as const;
        } catch {
          // 삭제 직후 폴링 레이스 등 — 조용히 빈 목록 (다음 틱에 정리된다)
          return [ws.id, [] as WorktreeInfo[]] as const;
        }
      })
    );
    const next = Object.fromEntries(entries);
    // ⚠️ 10초 폴링은 대부분 **같은 결과**를 돌려준다 — 그때마다 새 객체로 갈아끼우면
    // 이 객체에 매달린 파생값(workspaceIdOf·프리셋 맵)과 LNB 가 통째로 다시 계산된다.
    // 내용이 같으면 이전 객체를 그대로 유지해 리렌더 자체를 만들지 않는다.
    setWorktrees((prev) =>
      JSON.stringify(prev) === JSON.stringify(next) ? prev : next
    );
  }, []);
  useEffect(() => {
    void refreshWorktrees();
  }, [workspaces, refreshWorktrees]);
  // ⚠️ 인라인 화살표 금지(renderer-ui 규칙) — identity 가 매 렌더 바뀌면 인터벌이
  // 계속 리셋돼 10초 폴링이 한 번도 발화하지 않았다(2026-08-07 성능 감사에서 발견).
  const pollWorktrees = useCallback(() => {
    void refreshWorktrees();
  }, [refreshWorktrees]);
  usePolling(pollWorktrees, WORKTREE_POLL_MS, { immediate: false });

  // ── 세션 목록·상태 — main 이 payload 로 push, 재조회는 최초 1회뿐 ──
  useEffect(() => {
    const api = terminalApi();
    if (!api) return;
    void api.list().then((list) => {
      setSessions(list);
      setSessionsReady(true); // '기타 세션' 선택 복원 판정도 목록 로드 후에만
    });
    return api.onSessions((list) => {
      if (list) setSessions(list);
      else void api.list().then(setSessions); // payload 미탑재(구버전 main) 폴백
    });
  }, []);

  // ── 프리셋 — 프리셋 바(⚙ 옆 칩) 목록. ?. 가드는 구 preload(재시작 전) 대비 ──
  const [presets, setPresets] = useState<TerminalPreset[]>([]);
  useEffect(() => {
    const api = window.oneApp?.workspaces?.presets;
    if (!api) return;
    void api.get().then(setPresets);
    return api.onChanged(setPresets);
  }, []);

  /** 세션 cwd 가 속한 워크스페이스 — 프리셋 스코프 판정용 (기타 세션이면 null) */
  const workspaceIdOf = useCallback(
    (cwd: string): string | null => {
      for (const ws of workspaces) {
        const list = worktrees[ws.id];
        if (list ? list.some((w) => w.path === cwd) : ws.repoPath === cwd)
          return ws.id;
      }
      return null;
    },
    [workspaces, worktrees]
  );

  // 위치(cwd)별 프리셋 목록 — pane 마다 렌더 중에 계산하면 매번 새 배열이 되어
  // pane 의 memo 가 통째로 깨진다(세션 상태 브로드캐스트는 초 단위로 온다).
  // 위치 집합이 그대로면 같은 배열 인스턴스를 계속 넘기도록 키를 문자열로 굳힌다.
  const cwdKey = useMemo(
    () => [...new Set(sessions.map((s) => s.cwd))].sort().join('\n'),
    [sessions]
  );
  const presetsByCwd = useMemo(() => {
    const map = new Map<string, TerminalPreset[]>();
    for (const cwd of cwdKey ? cwdKey.split('\n') : []) {
      const forWs = presetsForWorkspace(presets, workspaceIdOf(cwd));
      map.set(cwd, forWs.length > 0 ? forWs : NO_PRESETS);
    }
    return map;
  }, [cwdKey, presets, workspaceIdOf]);

  // MO 서버 실행 여부 — 아이콘에 상태 점 표시
  useEffect(() => {
    const api = terminalApi();
    if (!api) return;
    const refreshMo = async () => setMoRunning((await api.server.status()).running);
    void refreshMo();
    return api.server.onChanged(() => void refreshMo());
  }, []);

  // ── 파생값 — 선택된 워크트리의 세션들(탭), 어디에도 안 속한 세션들(기타) ──
  const allPaths = useMemo(() => {
    const set = new Set<string>();
    for (const list of Object.values(worktrees)) for (const wt of list) set.add(wt.path);
    return set;
  }, [worktrees]);

  const otherSessions = useMemo(
    () => sessions.filter((s) => !allPaths.has(s.cwd)),
    [sessions, allPaths]
  );

  const tabSessions = useMemo(() => {
    if (!selection) return [];
    if (selection.kind === 'other') return otherSessions;
    return sessions.filter((s) => s.cwd === selection.path);
  }, [selection, sessions, otherSessions]);

  const selectedWt: WorktreeInfo | null =
    selection?.kind === 'worktree'
      ? (worktrees[selection.wsId] ?? []).find((w) => w.path === selection.path) ?? null
      : null;
  const canCreate = selection?.kind === 'worktree' && !selectedWt?.missing;

  const selKey = !selection
    ? ''
    : selection.kind === 'other'
      ? 'other'
      : `${selection.wsId}:${selection.path}`;

  const selectAndSave = useCallback((sel: WorkspaceSelection | null) => {
    setSelection(sel);
    if (sel) localStorage.setItem('terminal:wsSelection', JSON.stringify(sel));
    else localStorage.removeItem('terminal:wsSelection');
  }, []);

  // ── 선택 보정 — 저장된 선택이 사라졌으면(워크트리 제거 등) 첫 워크스페이스로 폴백 ──
  // ⚠️ 목록 로드 완료 후에만 판정한다 — 빈 초기 상태에서 돌면 저장된 선택을 무효로
  // 오판해 지우고, 다른 섹션에 다녀올 때마다 최상단 레포로 초기화됐다(2026-08-06).
  useEffect(() => {
    if (!wsReady || !sessionsReady) return;
    const valid = (() => {
      if (!selection) return false;
      if (selection.kind === 'other') return otherSessions.length > 0;
      const ws = workspaces.find((w) => w.id === selection.wsId);
      if (!ws) return false;
      const list = worktrees[selection.wsId];
      return !list || list.some((w) => w.path === selection.path); // 목록 도착 전엔 보류
    })();
    if (valid) return;
    const first = workspaces[0];
    if (first) {
      selectAndSave({
        kind: 'worktree',
        wsId: first.id,
        path: worktrees[first.id]?.[0]?.path ?? first.repoPath,
      });
    } else if (otherSessions.length > 0) {
      selectAndSave({ kind: 'other' });
    } else if (selection) {
      selectAndSave(null);
    }
  }, [wsReady, sessionsReady, workspaces, worktrees, otherSessions, selection, selectAndSave]);

  // ── 활성 세션 보정 — 탭 목록이 바뀌면(전환·종료) 기억해 둔 탭 → 첫 탭 순으로.
  // 기억은 localStorage 에도 미러 — 섹션을 떠났다 와도(재마운트) 보던 세션이 유지된다
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
    localStorage.setItem(
      'terminal:lastActive',
      JSON.stringify(Object.fromEntries(lastActiveRef.current))
    );
  }, []);
  // 최신값 ref — 드롭·그립·선택 콜백의 참조를 고정하기 위한 것(pane·탭바 memo 유지)
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const layoutsRef = useRef(layouts);
  layoutsRef.current = layouts;
  const selKeyRef = useRef(selKey);
  selKeyRef.current = selKey;

  // ── 분할 그룹 — selKey 별 이진 트리 **배열** (lib/layout.ts, 2026-08-10 개편) ──
  // **화면은 activeId 의 함수다**: 포커스 세션이 그룹에 속하면 그 그룹 전체가 보이고,
  // 어디에도 안 속하면 혼자 전체 화면이다. 그룹 밖 탭을 눌러도 그룹은 해체되지 않고
  // 화면만 바뀐다(예전 '포커스 슬롯 교체' 의미론은 그룹을 덮어써서 폐기 — 사용자 지적).
  // 그룹은 pane 2개 이상일 때만 존재하고, 1개로 붕괴하면 배열에서 빠져 단일로 복귀한다.
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
    persistLayouts(layouts);
  }, [layouts]);

  // 죽은 세션을 그룹에서 걷어낸다(형제 승격 → 1개 남으면 그룹 해체) —
  // ⌘⇧W·자연사·외부 tmux kill 이 전부 여기로 수렴한다.
  // ⚠️ 목록 로드 완료 후에만 — 빈 초기 배열로 돌면 복원한 그룹을 통째로
  // 오파기한다(위 '선택 보정'의 ready 게이트와 같은 교훈).
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
      // ⚠️ rememberActive 가 경합의 열쇠다 — 이 effect 뒤에 도는 '활성 세션 보정'이
      // remembered 를 먼저 찾으므로, 여기서 기억을 갱신해 두면 둘 다 같은 세션을 고른다
      rememberActive(selKey, focusFallback);
      setActiveId(focusFallback);
    }
  }, [sessions, sessionsReady, selKey, layouts, updateGroups, rememberActive]);

  const selectTab = useCallback(
    (id: string) => {
      // 탭 클릭 = 화면 전환뿐이다 — 그룹 소속이면 그 그룹이, 아니면 단일 전체 화면이
      // 따라온다(뷰 = activeId 의 함수). 그룹을 건드리지 않는다.
      rememberActive(selKey, id);
      setActiveId(id);
    },
    [rememberActive, selKey]
  );

  // ── 탭바 표시 구조 — 단일 세션 | 분할 그룹(멤버 배열) 아이템 목록 ──
  // 그룹은 첫 멤버의 원래 자리에 멤버들을 인접 정렬해 **하나의 박스(tab-pack)** 로
  // 렌더된다. tabs 는 평탄화된 표시 순서(⌘1..9·⌃Tab·활성 보정용).
  const tabView = useMemo(() => {
    const byId = new Map(tabSessions.map((s) => [s.id, s]));
    const placed = new Set<string>();
    const items: TabItem[] = [];
    const tabs: TerminalSessionInfo[] = [];
    for (const s of tabSessions) {
      if (placed.has(s.id)) continue;
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
  }, [tabSessions, groups]);

  /** pane 클릭 = 포커스 이동 — 분할 중 어느 터미널이 키보드·⌘F 를 받는지 정한다 */
  const focusPane = useCallback(
    (id: string) => {
      if (activeIdRef.current === id) return;
      rememberActive(selKeyRef.current, id);
      setActiveId(id);
    },
    [rememberActive]
  );

  // ── 상단 공용 바 ↔ pane 연결 — 검색 열기·맨 아래로는 터미널 인스턴스를 직접
  // 만져야 해서 pane 이 핸들을 등록하고, 바는 **포커스 pane** 의 핸들만 부른다.
  const paneHandles = useRef(new Map<string, TerminalPaneHandle>());
  const registerPaneHandle = useCallback(
    (id: string, handle: TerminalPaneHandle | null) => {
      if (handle) paneHandles.current.set(id, handle);
      else paneHandles.current.delete(id);
    },
    []
  );
  const openActiveSearch = useCallback(() => {
    if (activeIdRef.current)
      paneHandles.current.get(activeIdRef.current)?.openSearch();
  }, []);
  const scrollActiveToBottom = useCallback(() => {
    if (activeIdRef.current)
      paneHandles.current.get(activeIdRef.current)?.scrollToBottom();
  }, []);
  // 스크롤백을 위로 올린 pane — 상단 바 [맨 아래로] 노출 판정.
  // tmux 세션은 xterm 이 아니라 tmux copy-mode 가 스크롤 상태의 주인이라, pane 이
  // 휠 위임 응답(scrolledUp)으로 올려 준다(TerminalView 의 '휠 스크롤' 절).
  const [scrolledUp, setScrolledUp] = useState<Record<string, boolean>>({});
  const onScrolledChange = useCallback((id: string, v: boolean) => {
    setScrolledUp((cur) => (!!cur[id] === v ? cur : { ...cur, [id]: v }));
  }, []);
  const revealActive = useCallback(async () => {
    const id = activeIdRef.current;
    if (!id) return;
    const res = await terminalApi()?.revealCwd(id);
    if (res && !res.ok) toast('위치를 열지 못했습니다.', 'fail');
  }, [toast]);

  // 방금 만든 세션 — 목록 브로드캐스트가 아직 안 왔으면 보정 효과가 첫 탭으로 되돌리므로,
  // 목록에 나타날 때까지 기다렸다가 활성화한다 (생성 응답과 브로드캐스트의 순서 무관).
  // selectTab 경유 — 분할 중이면 새 세션이 포커스된 슬롯을 이어받는다(탭 클릭과 동일 의미론)
  const pendingRef = useRef<string | null>(null);

  useEffect(() => {
    const pending = pendingRef.current;
    if (pending && sessions.some((s) => s.id === pending)) {
      pendingRef.current = null;
      selectTab(pending);
    }
  }, [sessions, selKey, selectTab]);

  useEffect(() => {
    if (pendingRef.current) return;
    if (activeId && tabSessions.some((s) => s.id === activeId)) return;
    // 그룹 뷰에서 focused 가 죽은 경우는 위 sanitize effect 가 남은 멤버를
    // rememberActive 로 먼저 기억해 두므로, 여기서도 같은 세션이 골라진다.
    const remembered = lastActiveRef.current.get(selKey);
    setActiveId(
      tabView.tabs.find((s) => s.id === remembered)?.id ??
        tabView.tabs[0]?.id ??
        null
    );
  }, [tabSessions, tabView, activeId, selKey]);

  /** 세션 생성·복제 직후 — 목록에 나타나면 그 세션을 활성화한다 */
  const activateSession = useCallback((id: string) => {
    pendingRef.current = id;
    setActiveId(id);
  }, []);

  // ── 다른 섹션에서 넘어온 '이 세션을 열어라' 요청 (Jira [작업] → femc 세션) ──
  // ⚠️ 요청이 도착한 시점엔 워크스페이스·워크트리 목록이 아직 없다(섹션에 막 들어왔다).
  // 그래서 담아 두고, 목록이 준비되면 **그 세션의 위치로 선택을 옮긴 뒤** 활성화한다 —
  // 선택을 안 옮기면 다른 워크트리를 보던 중일 때 탭 목록에 그 세션이 없다.
  const [focusReq, setFocusReq] = useState<TerminalFocusRequest | null>(null);
  useTerminalFocusRequest(setFocusReq); // setState 는 identity 가 고정이라 그대로 넘긴다
  useEffect(() => {
    if (!focusReq) return;
    const wtReady = workspaces.every((w) => !!worktrees[w.id]);
    if (!wsReady || !wtReady) return; // 목록 도착까지 보류
    const hit = workspaces.find(
      (ws) =>
        (worktrees[ws.id] ?? []).some((w) => w.path === focusReq.cwd) ||
        ws.repoPath === focusReq.cwd
    );
    selectAndSave(
      hit ? { kind: 'worktree', wsId: hit.id, path: focusReq.cwd } : { kind: 'other' }
    );
    activateSession(focusReq.sessionId);
    setFocusReq(null);
  }, [focusReq, wsReady, workspaces, worktrees, selectAndSave, activateSession]);

  // ── 살아 있는 pane — **실제로 본 적 있는 세션만** xterm 을 만든다 ──
  // 예전엔 sessions 전부를 마운트해서 터미널 섹션에 들어가는 순간 세션 수만큼
  // xterm·WebGL 컨텍스트·attach(tmux 클라이언트 spawn)가 한꺼번에 생겼다.
  // 지금은 화면의 세션(분할이면 레이아웃 전체, 아니면 활성 하나)만 붙이고, 한 번 연
  // pane 은 상한(MAX_LIVE_PANES)까지 유지해 전환 즉시성과 스크롤백·검색 상태를 지킨다.
  const [livePanes, setLivePanes] = useState<string[]>([]); // 화면 세션들 + 최근 사용 순
  useEffect(() => {
    const shown = activeGroupIds ?? (activeId ? [activeId] : []);
    if (shown.length === 0) return;
    setLivePanes((cur) => {
      // LRU 축출은 **화면 밖 세션만** 잘라낸다 — 보이는 pane 을 버리면 그 자리가 빈다
      const rest = cur.filter((id) => !shown.includes(id));
      const next = [
        ...shown,
        ...rest.slice(0, Math.max(0, MAX_LIVE_PANES - shown.length)),
      ];
      return next.length === cur.length && next.every((id, i) => id === cur[i])
        ? cur
        : next;
    });
  }, [activeId, activeGroupIds]);

  // ── 분할 렌더 파생값 — **지금 보는 그룹**의 트리 → %rect (pane·경계 grip) ──
  const layoutRects = useMemo(() => {
    if (!activeTree) return null;
    const { panes, grips } = computeLayout(activeTree);
    return { panes, grips, bySession: new Map(panes.map((p) => [p.sessionId, p])) };
  }, [activeTree]);

  // ── 분할 드래그 앤 드롭 — 탭(SessionTabs)이 소스, 드롭 존은 드래그 중에만 pane 위에 덮는다.
  // ⚠️ pane 자체에 dragover 를 걸지 않는 이유: xterm 의 canvas/textarea 가 이벤트를
  // 삼킬 수 있다 — 투명 오버레이가 최상단에서 독점하면 xterm 은 아예 보지 못한다.
  const [dragSession, setDragSession] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{ panelId: string; side: DropSide } | null>(
    null
  );
  // 자기 화면의 탭을 끌면 놓을 곳이 없다 — **드래그 중 다른 탭 위에 올리면 그 탭
  // (그룹 멤버면 그 그룹)의 화면이 열린다**(SessionTabs 의 스프링 로딩, selectTab 경유).
  // 원하는 화면을 하버로 열어 두고 아래 pane 에 놓으면 분할된다(2026-08-10 사용자 요청).
  const onDragStartSession = useCallback((id: string) => setDragSession(id), []);
  const onDragEndSession = useCallback(() => {
    // 드롭이 밖에서 끝나도(무효 드롭 포함) 표시·드롭 존이 남지 않게 — WorkspaceNav 동일
    setDragSession(null);
    setDropHint(null);
  }, []);

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
    [updateGroups, rememberActive, onDragEndSession]
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

  const applyDrop = (panelId: string, side: DropSide) => {
    const dragged = dragSession;
    setDragSession(null);
    setDropHint(null);
    if (!dragged) return;
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
        updateGroups(key, replaceGroup(list, view, replaceSession(view, panelId, dragged)));
      } else {
        // 밖에서 온 세션 — 그 pane 의 세션은 그룹 밖(단일)으로 나간다.
        // 드래그 세션이 다른 그룹 소속이었으면 먼저 빼낸다(view 는 다른 트리라 identity 유지).
        const freed = removeFromGroups(list, dragged);
        updateGroups(key, replaceGroup(freed, view, replaceSession(view, panelId, dragged)));
      }
    } else {
      if (inView) {
        updateGroups(key, replaceGroup(list, view, moveSession(view, dragged, panelId, side)));
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
  };

  // 드롭 존 목록 — 분할 중이면 pane 마다, 단일 모드면 화면 전체 하나
  const dropZones = !dragSession
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
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.style.cursor = horizontal ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    layoutDraggingRef.current = true;
    // 그 split 의 영역(region, %)을 px 로 — 포인터 위치를 영역 안 비율로 환산한다
    const rl = box.left + (g.region.left / 100) * box.width;
    const rw = (g.region.width / 100) * box.width;
    const rt = box.top + (g.region.top / 100) * box.height;
    const rh = (g.region.height / 100) * box.height;
    const move = (ev: PointerEvent) => {
      const ratio = horizontal ? (ev.clientX - rl) / rw : (ev.clientY - rt) / rh;
      if (!Number.isFinite(ratio)) return;
      // ⚠️ 트리는 setRatio 마다 참조가 바뀌므로 identity 가 아니라 splitId 로 찾는다
      const list = layoutsRef.current[key] ?? NO_GROUPS;
      const tree = list.find((t) => findSplit(t, g.splitId));
      if (!tree) return;
      updateGroups(key, replaceGroup(list, tree, setRatio(tree, g.splitId, ratio)));
    };
    const up = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      layoutDraggingRef.current = false;
      persistLayouts(layoutsRef.current); // 놓는 순간 1회 저장
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** ⌘T — 모달 없이 현재 워크트리에서 바로 셸 세션을 연다 (2026-08-06 사용자 요청) */
  const createShell = useCallback(async () => {
    if (selection?.kind !== 'worktree') return;
    try {
      const info = await terminalApi()?.create({ cwd: selection.path });
      if (info) activateSession(info.id);
    } catch (err) {
      toast(`세션 생성 실패: ${(err as Error).message}`, 'fail');
    }
  }, [selection, activateSession, toast]);

  /**
   * 프리셋 실행 — 그 위치의 새 세션에서 명령 자동 실행 (Superset new-tab 동일).
   * 세션이 아니라 **cwd** 를 받는다 — 세션이 하나도 없는 화면에서도 선택된
   * 워크트리 경로로 첫 세션을 프리셋으로 시작할 수 있어야 한다(2026-08-08).
   */
  const runPreset = useCallback(
    async (cwd: string, preset: TerminalPreset) => {
      try {
        const info = await terminalApi()?.create({
          cwd,
          // claude 프리셋 등은 에이전트로 태깅 — 입력대기 알림·상태 휴리스틱이 살아난다
          agentId: agentIdFromCommand(preset.command),
          command: preset.command,
          title: preset.name,
        });
        if (info) activateSession(info.id);
      } catch (err) {
        toast(`프리셋 실행 실패: ${(err as Error).message}`, 'fail');
      }
    },
    [activateSession, toast]
  );
  const openPresets = useCallback(() => setPresetsOpen(true), []);
  // 세션이 없을 때의 프리셋 — 선택된 워크트리 위치로 첫 세션을 만든다
  const selectionPresets = useMemo(
    () =>
      presetsForWorkspace(
        presets,
        selection?.kind === 'worktree' ? selection.wsId : null
      ),
    [presets, selection]
  );

  const activeSession = tabSessions.find((s) => s.id === activeId) ?? null;

  // ── 상단 공용 바 — pane 마다 있던 툴바를 탭바 아래 하나로 (2026-08-10 사용자 요청).
  // 프리셋은 포커스 세션의 위치 기준, 세션이 없으면 선택된 워크트리 기준.
  const barCwd =
    activeSession?.cwd ?? (selection?.kind === 'worktree' ? selection.path : null);
  const barPresets = activeSession
    ? (presetsByCwd.get(activeSession.cwd) ?? NO_PRESETS)
    : selectionPresets;
  const runPresetForBar = useCallback(
    (p: TerminalPreset): void => {
      if (barCwd) void runPreset(barCwd, p);
    },
    [barCwd, runPreset]
  );

  // ── 패널 너비·축소 (앱 사이드바 Sidebar.tsx 와 같은 규칙) ──
  const [changesWidth, setChangesWidth] = useState(savedChangesWidth);
  const changesWidthRef = useRef(changesWidth);
  const [sideWidth, setSideWidth] = useState(savedSideWidth);
  const [sideCollapsed, setSideCollapsed] = useState(
    () => localStorage.getItem('terminal:sideCollapsed') === '1'
  );
  const sideWidthRef = useRef(sideWidth);
  const sideCollapsedRef = useRef(sideCollapsed);
  const sideApplied = sideCollapsed ? SIDE_COLLAPSED_W : sideWidth;

  const onSideGripDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sideCollapsedRef.current ? SIDE_COLLAPSED_W : sideWidthRef.current;
    // 접으려고 왼쪽으로 끌면 도중에 MIN_W 구간을 지나며 폭이 최소값으로 갱신된다.
    // 그대로 두면 넓혀 뒀던 사람이 한 번 접었다 펴는 순간 최소폭을 얻는다 →
    // 접힌 채로 끝나면 '펼쳤을 때 폭'은 드래그 시작 시점 값으로 되돌린다.
    const keepW = sideWidthRef.current;
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const move = (ev: PointerEvent) => {
      const raw = startW + (ev.clientX - startX);
      if (raw < SIDE_SNAP_W) {
        sideCollapsedRef.current = true;
        setSideCollapsed(true);
        return;
      }
      sideCollapsedRef.current = false;
      setSideCollapsed(false);
      // 반올림 — devicePixelRatio 때문에 포인터 좌표가 소수로 오고, 그대로 두면
      // localStorage 에 '334.5' 같은 값이 남는다
      const w = Math.round(Math.min(SIDE_MAX_W, Math.max(SIDE_MIN_W, raw)));
      sideWidthRef.current = w;
      setSideWidth(w);
    };
    const up = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (sideCollapsedRef.current) {
        sideWidthRef.current = keepW;
        setSideWidth(keepW);
      }
      localStorage.setItem('terminal:sideWidth', String(sideWidthRef.current));
      localStorage.setItem(
        'terminal:sideCollapsed',
        sideCollapsedRef.current ? '1' : '0'
      );
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** 키보드·더블클릭으로도 접거나 펼 수 있어야 한다 — grip 은 포커스를 받는 separator 다 */
  const toggleSide = () => {
    const next = !sideCollapsedRef.current;
    sideCollapsedRef.current = next;
    setSideCollapsed(next);
    localStorage.setItem('terminal:sideCollapsed', next ? '1' : '0');
  };

  const onChangesGripDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = changesWidthRef.current;
    // 포인터 캡처 — 없으면 창 밖에서 버튼을 놓았을 때 pointerup 을 못 받아
    // body 의 col-resize 커서와 리스너가 그대로 남는다
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const move = (ev: PointerEvent) => {
      const w = Math.min(
        CHANGES_MAX_W,
        Math.max(CHANGES_MIN_W, startW + startX - ev.clientX)
      );
      changesWidthRef.current = w;
      setChangesWidth(w);
    };
    const up = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      localStorage.setItem('terminal:changesWidth', String(changesWidthRef.current));
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // 부수효과는 updater 밖에서 — updater 는 순수해야 한다(StrictMode 이중 호출)
  const toggleChanges = useCallback(() => {
    const next = !changesOpen;
    localStorage.setItem('terminal:changesOpen', next ? '1' : '0');
    setChangesOpen(next);
  }, [changesOpen]);

  const toggleExpand = useCallback(
    (wsId: string) => {
      const next = expanded.includes(wsId)
        ? expanded.filter((id) => id !== wsId)
        : [...expanded, wsId];
      localStorage.setItem('terminal:wsExpanded', JSON.stringify(next));
      setExpanded(next);
    },
    [expanded]
  );

  const ensureExpanded = (wsId: string) => {
    if (expanded.includes(wsId)) return;
    const next = [...expanded, wsId];
    localStorage.setItem('terminal:wsExpanded', JSON.stringify(next));
    setExpanded(next);
  };

  // 확인 없이 즉시 종료 (2026-08-06 사용자 요청 — Superset 도 바로 닫는다).
  // tmux 백엔드라 실수로 닫아도 프로세스만 죽고 복구 대상이 없다.
  const closeSession = useCallback(
    async (s: TerminalSessionInfo) => {
      try {
        await terminalApi()?.kill(s.id);
      } catch (err) {
        toast(`세션 종료 실패: ${(err as Error).message}`, 'fail');
      }
    },
    [toast]
  );
  const closeSessionFromTab = useCallback(
    (s: TerminalSessionInfo): void => {
      void closeSession(s);
    },
    [closeSession]
  );

  // ── 세션 단축키 — ⌘T 새 세션 · ⌘1..9 탭 전환 · ⌃Tab 순환 · ⌘⇧W 종료.
  // ⚠️ capture 단계 + stopPropagation 으로 잡는다 — bubble 로 잡으면 xterm 의 textarea
  // 핸들러가 먼저 처리해 같은 키가 셸에도 전달된다(⌃Tab 이 특히 그렇다).
  // ⚠️ ⌘W(창 닫기)·⌘+/-(전체 UI 줌)는 Electron 기본 메뉴가 선점하므로 쓰지 않는다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 이름 편집·검색 입력 중에는 넘긴다 (xterm 의 입력은 textarea 라 여기 안 걸린다)
      if ((document.activeElement as HTMLElement | null)?.tagName === 'INPUT') return;
      const claim = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      // 순회·번호는 **표시 순서**(tabView — 그룹 멤버 인접 정렬)를 따른다
      const tabs = tabView.tabs;
      if (e.ctrlKey && !e.metaKey && e.key === 'Tab') {
        if (tabs.length < 2) return;
        claim();
        const cur = tabs.findIndex((s) => s.id === activeId);
        const next = (cur + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length;
        selectTab(tabs[next].id);
        return;
      }
      if (!e.metaKey || e.altKey || e.ctrlKey) return;
      if (e.shiftKey) {
        if (e.key.toLowerCase() === 'w' && activeSession) {
          claim();
          void closeSession(activeSession);
        }
        return;
      }
      if (e.key === 't') {
        if (!canCreate) return;
        claim();
        void createShell(); // 모달 없이 바로 셸 — 에이전트 선택은 [+] 또는 프리셋 바
      } else if (e.key >= '1' && e.key <= '9') {
        const target = tabs[Number(e.key) - 1];
        if (!target) return;
        claim();
        selectTab(target.id);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [
    tabView,
    activeId,
    activeSession,
    canCreate,
    closeSession,
    selectTab,
    createShell,
  ]);

  const removeWorktree = useCallback(async (ws: TerminalWorkspace, wt: WorktreeInfo) => {
    const inUse = sessions.filter((s) => s.cwd === wt.path).length;
    const ok = await confirm({
      title: '워크트리 제거',
      message: [
        `'${worktreeName(wt)}'(${wt.branch ?? wt.head ?? '?'}) 워크트리 폴더를 제거합니다.`,
        wt.dirty ? '커밋하지 않은 변경이 함께 사라집니다.' : '',
        inUse > 0 ? `이 위치를 쓰는 세션 ${inUse}개의 작업 폴더가 사라집니다.` : '',
        '브랜치는 삭제되지 않습니다.',
      ]
        .filter(Boolean)
        .join(' '),
      confirmLabel: '제거',
      danger: true,
    });
    if (!ok) return;
    try {
      // dirty·missing 워크트리는 git 이 --force 를 요구한다 (확인은 위에서 이미 받았다)
      const r = await window.oneApp.workspaces.removeWorktree(
        ws.id,
        wt.path,
        wt.dirty || wt.missing
      );
      if (r.ok) {
        toast('워크트리를 제거했습니다');
        void refreshWorktrees();
      } else {
        toast(`워크트리 제거 실패: ${r.error ?? '알 수 없는 오류'}`, 'fail');
      }
    } catch (err) {
      toast(`워크트리 제거 실패: ${(err as Error).message}`, 'fail');
    }
  }, [sessions, confirm, toast, refreshWorktrees]);

  const removeWorkspace = useCallback(
    async (ws: TerminalWorkspace) => {
      const ok = await confirm({
        title: '워크스페이스 제거',
        message: `'${ws.name}' 를 목록에서 제거합니다. 저장소·워크트리 파일은 삭제되지 않습니다.`,
        confirmLabel: '제거',
        danger: true,
      });
      if (!ok) return;
      try {
        await window.oneApp.workspaces.delete(ws.id); // 목록 갱신은 onChanged 브로드캐스트
      } catch (err) {
        toast(`워크스페이스 제거 실패: ${(err as Error).message}`, 'fail');
      }
    },
    [confirm, toast]
  );

  // 이름·색 변경은 같은 save 채널 — 미지정 필드는 main 이 기존 값을 유지한다
  const saveWorkspace = useCallback(
    async (input: { id: string; name: string; repoPath: string; color?: number }) => {
      try {
        await window.oneApp.workspaces.save(input);
      } catch (err) {
        toast(`워크스페이스 저장 실패: ${(err as Error).message}`, 'fail');
      }
    },
    [toast]
  );

  // 드래그 순서 변경 — 브로드캐스트를 기다리면 드롭 순간 원래 자리로 튀어 보이므로
  // 로컬 목록을 먼저 재배열한다(낙관적 갱신 — main 저장 결과가 곧 덮어 확정)
  const reorderWorkspaces = useCallback(
    (ids: string[]) => {
      setWorkspaces((cur) => {
        const byId = new Map(cur.map((w) => [w.id, w]));
        const next: TerminalWorkspace[] = [];
        for (const id of ids) {
          const w = byId.get(id);
          if (w) {
            next.push(w);
            byId.delete(id);
          }
        }
        next.push(...byId.values());
        return next;
      });
      window.oneApp.workspaces.reorder(ids).catch((err: Error) => {
        toast(`순서 저장 실패: ${err.message}`, 'fail');
      });
    },
    [toast]
  );

  const revealWorkspace = useCallback(
    async (ws: TerminalWorkspace) => {
      const r = await window.oneApp.workspaces.reveal(ws.id);
      if (!r.ok) toast(`폴더를 열지 못했습니다: ${r.error ?? ''}`, 'fail');
    },
    [toast]
  );

  // ── LNB·탭바에 넘길 핸들러 — memo 유지를 위해 인라인 화살표를 쓰지 않는다 ──
  const handleRemoveWorktree = useCallback(
    (ws: TerminalWorkspace, wt: WorktreeInfo): void => {
      void removeWorktree(ws, wt);
    },
    [removeWorktree]
  );
  const handleRemoveWorkspace = useCallback(
    (ws: TerminalWorkspace): void => {
      void removeWorkspace(ws);
    },
    [removeWorkspace]
  );
  const handleRenameWorkspace = useCallback(
    (ws: TerminalWorkspace, name: string): void => {
      void saveWorkspace({ id: ws.id, name, repoPath: ws.repoPath });
    },
    [saveWorkspace]
  );
  const handleSetColor = useCallback(
    (ws: TerminalWorkspace, color: number): void => {
      void saveWorkspace({ id: ws.id, name: ws.name, repoPath: ws.repoPath, color });
    },
    [saveWorkspace]
  );
  const handleReveal = useCallback(
    (ws: TerminalWorkspace): void => {
      void revealWorkspace(ws);
    },
    [revealWorkspace]
  );
  const openNewWorkspace = useCallback(() => setNewWsOpen(true), []);
  const openNewSession = useCallback(() => setNewSessionOpen(true), []);
  const openMoModal = useCallback(() => setMoOpen(true), []);

  // 변경사항 대상 — 워크트리 선택이면 그 경로(세션 불필요), '기타'면 활성 세션의 cwd
  const changesTarget: ChangesTarget | null =
    selection?.kind === 'worktree'
      ? { workspaceId: selection.wsId, worktreePath: selection.path }
      : activeSession
        ? { sessionId: activeSession.id }
        : null;

  if (!available) {
    return (
      <div className="terminal">
        <Banner variant="warning">
          터미널 IPC 가 아직 로드되지 않았습니다 — 개발 중에는 렌더러만 핫리로드되므로
          main·preload 변경을 반영하려면 <code>npm start</code> 를 다시 실행해야 합니다.
        </Banner>
      </div>
    );
  }

  return (
    // 축소 시엔 섹션 좌측 여백도 줄인다 — 아이콘 폭(48)보다 패딩(28)이 도드라져
    // 접었는데도 왼쪽이 비어 보였다(2026-08-06 사용자 지적)
    <div
      className={'terminal' + (sideCollapsed ? ' terminal--side-collapsed' : '')}
    >
      <aside
        className={
          'terminal__side' + (sideCollapsed ? ' terminal__side--collapsed' : '')
        }
        style={{ width: sideApplied }}
      >
        <div className="terminal__side-head">
          {!sideCollapsed && (
            <span className="terminal__side-title">워크스페이스</span>
          )}
          <div className="terminal__side-actions">
            <Tooltip label="새 워크스페이스 — git 저장소 등록">
              <button
                type="button"
                className="icon-btn"
                aria-label="새 워크스페이스"
                onClick={openNewWorkspace}
              >
                <Icon name="plus" size={16} />
              </button>
            </Tooltip>
          </div>
        </div>

        <WorkspaceNav
          workspaces={workspaces}
          worktrees={worktrees}
          sessions={sessions}
          selection={selection}
          collapsed={sideCollapsed}
          expanded={expanded}
          otherCount={otherSessions.length}
          onToggleExpand={toggleExpand}
          onSelect={selectAndSave}
          onNewWorktree={setWorktreeFor}
          onRemoveWorktree={handleRemoveWorktree}
          onRemoveWorkspace={handleRemoveWorkspace}
          onReorder={reorderWorkspaces}
          onRename={handleRenameWorkspace}
          onSetColor={handleSetColor}
          onReveal={handleReveal}
        />
      </aside>

      {/* 패널 손잡이 — 끌어서 폭 조절, 더블클릭·Enter·Space 로 접기/펴기 */}
      <div
        className="terminal__side-grip"
        role="separator"
        aria-orientation="vertical"
        tabIndex={0}
        aria-label={sideCollapsed ? '워크스페이스 패널 펼치기' : '워크스페이스 패널 접기'}
        onPointerDown={onSideGripDown}
        onDoubleClick={toggleSide}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            toggleSide();
          }
        }}
      />

      <div className="terminal__main">
        <SessionTabs
          items={tabView.items}
          activeId={activeId}
          draggingId={dragSession}
          canCreate={canCreate}
          changesOpen={changesOpen}
          moRunning={moRunning}
          onSelect={selectTab}
          onClose={closeSessionFromTab}
          onNew={openNewSession}
          onToggleChanges={toggleChanges}
          onOpenMo={openMoModal}
          onDragStartSession={onDragStartSession}
          onDragEndSession={onDragEndSession}
          onDetachSession={detachSession}
        />

        {/* 상단 공용 바 — pane 마다 있던 툴바를 탭바 아래 하나로 고정(2026-08-10 사용자
            요청: 분할해도 전부 공유값이라 반복될 이유가 없다). 프리셋·글자크기는 원래
            공유 상태고, 검색·맨아래로·Finder 는 포커스 pane 에 핸들로 위임한다.
            워크스페이스 등록 전 화면에서는 등록이 먼저라 감춘다. */}
        {(activeSession || workspaces.length > 0) && (
          <div className="terminal__bar">
            <PresetBar
              presets={barPresets}
              cwd={barCwd ?? undefined}
              disabled={!barCwd}
              onRun={runPresetForBar}
              onEdit={openPresets}
            />
            {/* 아이콘 버튼은 전부 Tooltip — 접근성 이름은 aria-label (renderer-ui 규칙) */}
            <span className="terminal__bar-actions">
              <Tooltip label="검색 (⌘F)">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="검색"
                  disabled={!activeSession}
                  onClick={openActiveSearch}
                >
                  <Icon name="search" size={14} />
                </button>
              </Tooltip>
              <Tooltip label="글자 작게">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="글자 작게"
                  disabled={fontSize <= FONT_SIZE_MIN}
                  onClick={() => changeFontSize(Math.max(FONT_SIZE_MIN, fontSize - 1))}
                >
                  <Icon name="minus" size={14} />
                </button>
              </Tooltip>
              <Tooltip
                label={`글자 크기 ${fontSize}px — 눌러서 기본(${FONT_SIZE_DEFAULT}px)으로`}
              >
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`글자 크기 ${fontSize}px — 기본으로 되돌리기`}
                  onClick={() => changeFontSize(FONT_SIZE_DEFAULT)}
                >
                  <span className="terminal__bar-size">{fontSize}</span>
                </button>
              </Tooltip>
              <Tooltip label="글자 크게">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="글자 크게"
                  disabled={fontSize >= FONT_SIZE_MAX}
                  onClick={() => changeFontSize(Math.min(FONT_SIZE_MAX, fontSize + 1))}
                >
                  <Icon name="plus" size={14} />
                </button>
              </Tooltip>
              {!!activeId && scrolledUp[activeId] && (
                <Tooltip label="맨 아래로">
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="맨 아래로"
                    onClick={scrollActiveToBottom}
                  >
                    <Icon name="arrow-down-to-line" size={14} />
                  </button>
                </Tooltip>
              )}
              <Tooltip label="세션 위치를 Finder 에서 열기">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Finder 에서 열기"
                  disabled={!activeSession}
                  onClick={() => void revealActive()}
                >
                  <Icon name="folder" size={14} />
                </button>
              </Tooltip>
            </span>
          </div>
        )}

        {/* ⚠️ 세션마다 pane 을 만들고 **보이지 않는 것도 언마운트하지 않는다** — 예전엔
            key={activeId} 로 xterm 을 매번 파괴해서, 전환할 때마다 선택 영역·검색 상태가
            사라지고 attach 왕복 + TUI 전체 리렌더를 다시 겪었다. 숨은 pane 은 absolute
            inset:0 이라 활성 pane 과 같은 크기를 유지한다 — 탭바가 위에 생겼으므로
            기준 컨테이너는 __main 이 아니라 이 __panes 다(아니면 탭바 높이만큼 어긋난다).
            분할 중에는 트리의 pane 이 전부 보이고(%rect absolute), 트리 밖 pane 만 숨는다.
            pane 들은 트리 구조와 무관하게 **플랫한 형제**로 둔다 — React 트리에서
            재부모화되면 xterm 이 언마운트된다(토스 아티클과 같은 좌표 렌더 방식). */}
        <div className="terminal__panes" ref={panesRef}>
          {sessions
            // 본 적 있는 세션만 pane 을 만든다 — 섹션 진입 시 전 세션 동시 attach 방지
            .filter((s) => livePanes.includes(s.id))
            .map((s) => {
              const pane = layoutRects?.bySession.get(s.id);
              return (
                <TerminalView
                  key={s.id}
                  sessionId={s.id}
                  visible={layoutRects ? !!pane : s.id === activeId}
                  focused={s.id === activeId}
                  rectLeft={pane?.rect.left}
                  rectTop={pane?.rect.top}
                  rectW={pane?.rect.width}
                  rectH={pane?.rect.height}
                  onFocusPane={focusPane}
                  fontSize={fontSize}
                  onRegisterHandle={registerPaneHandle}
                  onScrolledChange={onScrolledChange}
                />
              );
            })}
          {/* 분할 경계 그립 — SplitNode 마다 하나, 드래그 = 그 노드의 ratio 조절 */}
          {layoutRects?.grips.map((g) => (
            <div
              key={g.splitId}
              className={`terminal__split-grip terminal__split-grip--${g.orientation}`}
              role="separator"
              aria-orientation={g.orientation === 'row' ? 'vertical' : 'horizontal'}
              aria-label="분할 비율 조절"
              style={
                g.orientation === 'row'
                  ? {
                      left: `${g.rect.left}%`,
                      top: `${g.rect.top}%`,
                      height: `${g.rect.height}%`,
                    }
                  : {
                      left: `${g.rect.left}%`,
                      top: `${g.rect.top}%`,
                      width: `${g.rect.width}%`,
                    }
              }
              onPointerDown={(e) => onSplitGripDown(e, g)}
            />
          ))}
          {/* 드롭 존 — 탭 드래그 중에만 pane 전체를 덮는 투명 레이어.
              X자 판정으로 상/하/좌/우(분할)·중앙(교체)을 정하고 프리뷰를 띄운다 */}
          {dropZones?.map((z) => (
            <div
              key={z.panelId}
              className="terminal__drop-zone"
              style={{
                left: `${z.rect.left}%`,
                top: `${z.rect.top}%`,
                width: `${z.rect.width}%`,
                height: `${z.rect.height}%`,
              }}
              onDragOver={(e) => onZoneDragOver(e, z.panelId)}
              onDragLeave={() => setDropHint(null)}
              onDrop={(e) => {
                e.preventDefault();
                applyDrop(z.panelId, zoneSide(e));
              }}
            />
          ))}
          {/* 드롭 프리뷰 — 분할될 반쪽(중앙 드롭이면 pane 전체)을 액센트로 표시 */}
          {hintRect && (
            <div
              className="terminal__drop-hint"
              style={{
                left: `${hintRect.left}%`,
                top: `${hintRect.top}%`,
                width: `${hintRect.width}%`,
                height: `${hintRect.height}%`,
              }}
            />
          )}
          {!activeSession && (
            <div className="terminal__empty">
              {workspaces.length === 0 && otherSessions.length === 0 ? (
                <div className="terminal__empty-body">
                  <EmptyState
                    icon="terminal"
                    message="워크스페이스가 없습니다"
                    hint="git 저장소를 등록하면 워크트리를 만들고 그 안에서 에이전트 세션을 시작할 수 있습니다."
                  />
                  <Button size="sm" onClick={() => setNewWsOpen(true)}>
                    새 워크스페이스
                  </Button>
                </div>
              ) : (
                <div className="terminal__empty-body">
                  <EmptyState
                    icon="terminal"
                    message="열린 세션이 없습니다"
                    hint={
                      canCreate
                        ? '탭바의 [+] 로 이 워크트리에서 에이전트 세션을 시작하세요 — 세션은 앱이 실행 중인 동안 유지되고, 모바일(MO)에서도 이어서 쓸 수 있습니다.'
                        : '좌측에서 워크트리를 선택하세요.'
                    }
                  />
                  {canCreate && (
                    <Button size="sm" onClick={() => setNewSessionOpen(true)}>
                      새 세션
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 변경사항 드로어 — 선택한 워크트리의 git 상태. key 로 대상 전환 시 상태 리셋 */}
      {changesOpen && changesTarget && (
        <aside className="terminal__changes" style={{ width: changesWidth }}>
          <div
            className="terminal__changes-grip"
            role="separator"
            aria-orientation="vertical"
            aria-label="변경사항 패널 너비 조절"
            onPointerDown={onChangesGripDown}
          />
          <ChangesView
            key={selection?.kind === 'other' ? `s:${activeId}` : selKey}
            target={changesTarget}
            onExpand={() => setChangesFullOpen(true)}
            // 오버레이가 떠 있는 동안 드로어 폴링 중지 — 같은 대상 이중 git 조회 방지
            polling={!changesFullOpen}
          />
        </aside>
      )}

      {/* 변경사항 전체 화면 — 드로어 ⤢ 버튼으로 진입 (사이드-바이-사이드 diff) */}
      {changesFullOpen && changesTarget && (
        <ChangesOverlay
          target={changesTarget}
          onClose={() => setChangesFullOpen(false)}
        />
      )}

      {newWsOpen && (
        <NewWorkspaceModal
          onCreated={(ws) => {
            ensureExpanded(ws.id);
            selectAndSave({ kind: 'worktree', wsId: ws.id, path: ws.repoPath });
            void refreshWorktrees();
          }}
          onClose={() => setNewWsOpen(false)}
        />
      )}
      {worktreeFor && (
        <NewWorktreeModal
          workspace={worktreeFor}
          onCreated={(path) => {
            ensureExpanded(worktreeFor.id);
            selectAndSave({ kind: 'worktree', wsId: worktreeFor.id, path });
            void refreshWorktrees();
          }}
          onClose={() => setWorktreeFor(null)}
        />
      )}
      {newSessionOpen && selection?.kind === 'worktree' && (
        <NewSessionModal
          cwd={selection.path}
          location={
            selectedWt
              ? `${worktreeName(selectedWt)} · ${selectedWt.branch ?? selectedWt.head ?? ''}`
              : selection.path
          }
          onCreated={activateSession}
          onClose={() => setNewSessionOpen(false)}
        />
      )}
      {presetsOpen && (
        <PresetsModal
          workspaces={workspaces}
          onClose={() => setPresetsOpen(false)}
        />
      )}
      {moOpen && <MoAccessModal onClose={() => setMoOpen(false)} />}
    </div>
  );
}
