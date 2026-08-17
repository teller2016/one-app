// 터미널 섹션 — LNB(워크스페이스 → 워크트리 트리) + 상단 세션 탭 + xterm + 우측 변경사항
// (Superset 스타일 오케스트레이터). 세션은 main 프로세스 소유라 탭·창을 닫아도 유지되고,
// MO(모바일)와 같은 세션을 공유한다. 워크트리를 고르면 탭바가 그 위치(cwd)의 세션들로 바뀐다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  MouseEvent as ReactMouseEvent,
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
import { EmptyState } from '../../../components/EmptyState';
import { Icon } from '../../../components/Icon';
import { useToast } from '../../../components/Toast';
import { Tooltip } from '../../../components/Tooltip';
import type { TerminalFocusRequest } from '../../../lib/sectionNav';
import {
  setSessionVisibilityCheck,
  useTerminalFocusRequest,
} from '../../../lib/sectionNav';
import { beginPointerDrag } from '../../../lib/pointerDrag';
import { useSplitGroups } from '../lib/useSplitGroups';
import { useWorkspaceActions } from '../lib/useWorkspaceActions';
import { usePolling } from '../../../lib/usePolling';
import { ChangesOverlay, ChangesView } from '../../changes';
// 분할 트리를 직접 만지는 것은 useSplitGroups 뿐이다 — 여기선 탭바가 '통탭'을 만들 때
// 그룹 소속을 조회하는 두 함수만 쓴다
import { groupOf, sessionIdsOf } from '../lib/layout';
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
import { errMsg } from '../../../lib/errMsg';

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

/** 탭 표시 순서 — 화면(selKey)별 세션 id 배열. 화면 취향이라 분할 레이아웃과 같이 localStorage */
const TAB_ORDER_KEY = 'terminal:tabOrder';

function savedTabOrders(): Record<string, string[]> {
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

/** active=false 는 keep-alive 로 숨은 상태(App 이 언마운트 대신 visibility 로 숨긴다) —
 *  pane 숨김(크기 주장 중지)·폴링 중지·전역 단축키 해제·포털 모달 닫기가 걸린다 */
export function TerminalSection({ active = true }: { active?: boolean }) {
  const toast = useToast();
  const [sessions, setSessions] = useState<TerminalSessionInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const [workspaces, setWorkspaces] = useState<TerminalWorkspace[]>([]);
  const [worktrees, setWorktrees] = useState<Record<string, WorktreeInfo[]>>({});
  const [expanded, setExpanded] = useState<string[]>(savedExpanded);
  const [selection, setSelection] = useState<WorkspaceSelection | null>(savedSelection);
  // 탭 순서 — 사용자가 탭을 끌어 정한 표시 순서(화면별). 없는 화면·새 세션은 생성 순서
  const [tabOrders, setTabOrders] = useState<Record<string, string[]>>(savedTabOrders);
  useEffect(() => {
    if (Object.keys(tabOrders).length > 0)
      localStorage.setItem(TAB_ORDER_KEY, JSON.stringify(tabOrders));
  }, [tabOrders]);

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
  const available = !!terminalApi();

  // keep-alive 로 숨는 순간의 뒷정리 —
  // ① body 포털 모달(Modal)·전체화면 오버레이는 섹션을 visibility 로 숨겨도 화면 위에
  //    그대로 남으므로 닫는다(섹션이 언마운트되던 예전 동작과 동일).
  // ② 숨은 xterm(textarea)이 포커스를 쥔 채 남으면 다른 섹션에서의 타이핑이 그대로
  //    PTY 로 들어간다(⌘[ 같은 키보드 이동은 포커스를 옮기지 않는다) — 회수한다.
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (active) return;
    setNewWsOpen(false);
    setWorktreeFor(null);
    setNewSessionOpen(false);
    setPresetsOpen(false);
    setMoOpen(false);
    setChangesFullOpen(false);
    const el = document.activeElement;
    if (el instanceof HTMLElement && rootRef.current?.contains(el)) el.blur();
  }, [active]);

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
    // keep-alive 로 숨은 동안은 조회하지 않는다 — 복귀(active) 시 이 effect 가 1회 따라잡는다
    if (!active) return;
    void refreshWorktrees();
  }, [active, workspaces, refreshWorktrees]);
  // ⚠️ 인라인 화살표 금지(renderer-ui 규칙) — identity 가 매 렌더 바뀌면 인터벌이
  // 계속 리셋돼 10초 폴링이 한 번도 발화하지 않았다(2026-08-07 성능 감사에서 발견).
  const pollWorktrees = useCallback(() => {
    void refreshWorktrees();
  }, [refreshWorktrees]);
  // 섹션이 보일 때만 — 숨은 채로 워크스페이스마다 git 조회를 돌릴 이유가 없다
  usePolling(pollWorktrees, WORKTREE_POLL_MS, { immediate: false, enabled: active });

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

  // 화면 키 — 탭 순서·분할 레이아웃·마지막 활성 세션이 전부 이 키로 갈린다
  const selKey = !selection
    ? ''
    : selection.kind === 'other'
      ? 'other'
      : `${selection.wsId}:${selection.path}`;

  // 탭 목록 — 이 화면의 세션들을 **사용자가 정한 순서**로. 순서에 없는 세션(새로 만든 것)은
  // 뒤에 원래 순서(생성 순)대로 남는다.
  const tabSessions = useMemo(() => {
    const base = !selection
      ? []
      : selection.kind === 'other'
        ? otherSessions
        : sessions.filter((s) => s.cwd === selection.path);
    const order = tabOrders[selKey];
    if (!order || base.length < 2) return base;
    const rank = new Map(order.map((id, i) => [id, i]));
    // ⚠️ 미지정은 MAX_SAFE_INTEGER — Infinity 로 두면 둘 다 미지정일 때 차가 NaN 이 되어
    // 비교가 무의미해진다(같은 값이면 0 이어야 안정 정렬이 원래 순서를 지킨다).
    const at = (id: string) => rank.get(id) ?? Number.MAX_SAFE_INTEGER;
    return [...base].sort((a, b) => at(a.id) - at(b.id));
  }, [selection, sessions, otherSessions, tabOrders, selKey]);

  const selectedWt: WorktreeInfo | null =
    selection?.kind === 'worktree'
      ? (worktrees[selection.wsId] ?? []).find((w) => w.path === selection.path) ?? null
      : null;
  const canCreate = selection?.kind === 'worktree' && !selectedWt?.missing;

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
  const selKeyRef = useRef(selKey);
  selKeyRef.current = selKey;

  // ── 분할 그룹 — 상태기계 전체가 훅 안에 있다 (lib/useSplitGroups.ts) ──
  // 트리 보관·영속화·죽은 세션 정리·드래그 앤 드롭·경계 그립까지.
  // ⚠️ 그 안의 sanitize effect 는 아래 '활성 세션 보정' effect 와 **같은 flush 안 순서**로
  // 묶여 있다 — 그쪽이 rememberActive 로 기억해 둔 세션을 이쪽이 읽는다.
  const {
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
    onZoneDragOver,
    onZoneDragLeave,
    onZoneDrop,
    onSplitGripDown,
  } = useSplitGroups({
    selKey,
    selKeyRef,
    sessions,
    sessionsReady,
    activeId,
    activeIdRef,
    setActiveId,
    rememberActive,
  });

  const selectTab = useCallback(
    (id: string) => {
      // 탭 클릭 = 화면 전환뿐이다 — 그룹 소속이면 그 그룹이, 아니면 단일 전체 화면이
      // 따라온다(뷰 = activeId 의 함수). 그룹을 건드리지 않는다.
      rememberActive(selKey, id);
      setActiveId(id);
    },
    [rememberActive, selKey]
  );

  /** 탭 드래그로 정한 새 순서 — 이 화면(selKey)만 기억한다(다른 워크트리는 그대로).
   *  받은 배열이 지금 탭 목록 전체라 죽은 세션 id 는 재정렬할 때마다 자연히 정리된다.
   *  ⚠️ 참조가 고정돼야 한다 — SessionTabs 가 memo 라 콜백이 바뀌면 탭바가 매번 리렌더된다. */
  const reorderTabs = useCallback(
    (ids: string[]) => {
      setTabOrders((cur) => ({ ...cur, [selKeyRef.current]: ids }));
    },
    [selKeyRef]
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
  // ── 포커스 안전망 — 섹션 안을 클릭했으면 키보드 포커스를 pane 으로 되돌린다 ────────
  // ⌘C/⌘V 는 이 앱이 처리하지 않는다 — Electron 기본 메뉴의 role:copy/paste 라
  // **포커스된 편집 요소**에만 작동하고, xterm 은 클립보드 리스너를 자기 element·textarea
  // 에만 건다. 그래서 탭·툴바 버튼이 포커스를 쥐고 있으면 복사·붙여넣기가 조용히
  // 무반응이 된다(2026-08-13 '가끔 안 된다'의 정체 — 이미지 붙여넣기 위임도 함께 죽는다).
  // pane 의 포커스 복원 effect 는 `focused` 값이 **바뀔 때만** 도므로, 같은 탭을 다시
  // 누르는 것처럼 값이 그대로인 경로에서는 포커스가 영영 돌아오지 않았다.
  const reclaimFocus = useCallback((e: ReactMouseEvent) => {
    // 모달·피커 팝오버는 body portal 이라 DOM 상 섹션 밖이지만 **React 트리로는** 여기까지
    // 버블링된다 — 실제 DOM 포함 관계로 걸러야 모달 안 클릭을 건드리지 않는다.
    if (!(e.target instanceof Node) || !rootRef.current?.contains(e.target)) return;
    // ⚠️ rAF 로 미룬다 — 클릭이 만드는 포커스 이동(버튼 기본 포커스, 방금 열린 모달의
    // autoFocus)이 이 핸들러보다 **뒤에** 확정된다. 즉시 부르면 그것들을 빼앗는다.
    requestAnimationFrame(() => {
      // portal 이 떠 있으면 포커스 주인은 그쪽이다
      if (document.querySelector('.modal-overlay, .picker__pop')) return;
      // ⚠️ 텍스트를 드래그 선택한 직후면 손대지 않는다 — 변경사항 diff 를 선택해
      // ⌘C 하려는 순간 포커스를 옮기면 선택이 날아간다.
      if (window.getSelection()?.toString()) return;
      const el = document.activeElement as HTMLElement | null;
      // 입력 중이면 그대로 둔다(검색·이름 편집·커밋 메시지). xterm 의 입력도 TEXTAREA 라
      // 이 판정에 걸리는데, 그때는 이미 포커스가 터미널이므로 할 일이 없다.
      if (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA') return;
      if (el?.isContentEditable) return;
      if (activeIdRef.current)
        paneHandles.current.get(activeIdRef.current)?.focus();
    });
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

  // ── 워크트리를 IDE(Antigravity)로 열기 — 탭바 우측 액션 ──
  // 설치 여부는 한 번만 묻고, 미설치면 이름이 null 이라 버튼이 그려지지 않는다.
  const [editorName, setEditorName] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const api = window.oneApp?.workspaces;
    if (!api) return;
    // 조회 실패는 미설치와 같게 다룬다 — 버튼을 안 그리면 그만이다
    api
      .editorInfo()
      .then((info): void => {
        if (alive && info.available) setEditorName(info.name);
      })
      .catch((): void => setEditorName(null));
    return () => {
      alive = false;
    };
  }, []);

  const openInEditor = useCallback(async (): Promise<void> => {
    if (selection?.kind !== 'worktree') return;
    try {
      const res = await window.oneApp.workspaces.openEditor(
        selection.wsId,
        selection.path
      );
      if (!res.ok) toast(res.error || '열지 못했습니다.', 'fail');
    } catch (err) {
      toast(errMsg(err, '열지 못했습니다.'), 'fail');
    }
  }, [selection, toast]);

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
    // ⚠️ 이 effect 는 useSplitGroups 의 sanitize effect **뒤에** 돌아야 한다(훅 호출이
    // 위에 있어 그렇게 된다) — 그룹 뷰에서 focused 가 죽으면 그쪽이 남은 멤버를
    // rememberActive 로 먼저 기억해 두고, 여기서 그 remembered 를 읽어 같은 세션을
    // 고른다. 순서가 뒤집히면 둘이 서로 다른 setActiveId 를 쌓아 나중 것이 이긴다.
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

  // 입력대기 토스트 억제 — "그 세션을 지금 보고 있는가"를 App 의 토스트 브리지에 제공.
  // 최신값은 activeIdRef 와 같은 render 시점 대입 패턴 (콜백 identity 는 고정).
  const onScreenRef = useRef<{ active: boolean; ids: string[] }>({
    active: false,
    ids: [],
  });
  onScreenRef.current = {
    active,
    ids: activeGroupIds ?? (activeId ? [activeId] : []),
  };
  useEffect(() => {
    setSessionVisibilityCheck(
      (id) => onScreenRef.current.active && onScreenRef.current.ids.includes(id)
    );
    return () => setSessionVisibilityCheck(null);
  }, []);

  /** ⌘T — 모달 없이 현재 워크트리에서 바로 셸 세션을 연다 (2026-08-06 사용자 요청) */
  const createShell = useCallback(async () => {
    if (selection?.kind !== 'worktree') return;
    try {
      const info = await terminalApi()?.create({ cwd: selection.path });
      if (info) activateSession(info.id);
    } catch (err) {
      toast(`세션 생성 실패: ${errMsg(err)}`, 'fail');
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
        toast(`프리셋 실행 실패: ${errMsg(err)}`, 'fail');
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
  // 폭 전환 애니메이션은 접기/펴기에만 — 드래그 중에는 손끝을 그대로 따라와야 한다
  // (앱 Sidebar.tsx 와 같은 규칙). 두 그립이 동시에 잡히는 일은 없어 상태 하나로 충분하다.
  const [panelDragging, setPanelDragging] = useState(false);

  const onSideGripDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sideCollapsedRef.current ? SIDE_COLLAPSED_W : sideWidthRef.current;
    // 접으려고 왼쪽으로 끌면 도중에 MIN_W 구간을 지나며 폭이 최소값으로 갱신된다.
    // 그대로 두면 넓혀 뒀던 사람이 한 번 접었다 펴는 순간 최소폭을 얻는다 →
    // 접힌 채로 끝나면 '펼쳤을 때 폭'은 드래그 시작 시점 값으로 되돌린다.
    const keepW = sideWidthRef.current;
    setPanelDragging(true);
    beginPointerDrag(e, {
      cursor: 'col-resize',
      onMove: (ev) => {
        const raw = startW + (ev.clientX - startX);
        if (raw < SIDE_SNAP_W) {
          sideCollapsedRef.current = true;
          setSideCollapsed(true);
          return;
        }
        sideCollapsedRef.current = false;
        setSideCollapsed(false);
        const w = Math.round(Math.min(SIDE_MAX_W, Math.max(SIDE_MIN_W, raw)));
        sideWidthRef.current = w;
        setSideWidth(w);
      },
      onEnd: () => {
        setPanelDragging(false);
        if (sideCollapsedRef.current) {
          sideWidthRef.current = keepW;
          setSideWidth(keepW);
        }
        localStorage.setItem('terminal:sideWidth', String(sideWidthRef.current));
        localStorage.setItem(
          'terminal:sideCollapsed',
          sideCollapsedRef.current ? '1' : '0'
        );
      },
    });
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
    setPanelDragging(true);
    beginPointerDrag(e, {
      cursor: 'col-resize',
      onMove: (ev) => {
        const w = Math.round(
          Math.min(CHANGES_MAX_W, Math.max(CHANGES_MIN_W, startW + startX - ev.clientX))
        );
        changesWidthRef.current = w;
        setChangesWidth(w);
      },
      onEnd: () => {
        setPanelDragging(false);
        localStorage.setItem('terminal:changesWidth', String(changesWidthRef.current));
      },
    });
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
        toast(`세션 종료 실패: ${errMsg(err)}`, 'fail');
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
  // ⚠️ 리스너는 `active` 가 바뀔 때만 다시 건다 — deps 에 tabView·activeSession 을 넣으면
  // 세션 상태 브로드캐스트(초 단위)마다 걷었다 다시 달게 된다. 최신 클로저는 ref 로 넘긴다.
  const onSessionKey = (e: KeyboardEvent) => {
    // 이름 편집·검색 입력·커밋 메시지 작성 중에는 넘긴다.
    // ⚠️ TEXTAREA 도 막아야 한다 — 변경사항 드로어의 커밋 메시지가 공용 Textarea 라
    // 예전엔 작성 중 ⌘⇧W 가 확인 없이 세션을 죽였다. 단 xterm 의 입력도 textarea
    // (`.xterm-helper-textarea`)이므로 그것만 예외 — 아니면 터미널에 포커스가 있는
    // 동안 단축키가 전부 죽는다.
    const focused = document.activeElement as HTMLElement | null;
    if (focused?.tagName === 'INPUT') return;
    if (
      focused?.tagName === 'TEXTAREA' &&
      !focused.classList.contains('xterm-helper-textarea')
    )
      return;
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
  const onSessionKeyRef = useRef(onSessionKey);
  useEffect(() => {
    onSessionKeyRef.current = onSessionKey;
  });
  useEffect(() => {
    // keep-alive 로 숨은 동안은 바인딩 자체를 걷는다 — 안 걷으면 다른 섹션에서 누른
    // ⌘T·⌘⇧W 가 보이지 않는 터미널의 세션을 만들고 죽인다
    if (!active) return;
    const onKey = (e: KeyboardEvent) => onSessionKeyRef.current(e);
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active]);

  // 워크스페이스·워크트리 CRUD 는 통째로 훅에 있다 — LNB 에 그대로 펼쳐 넘긴다
  const wsActions = useWorkspaceActions({ sessions, setWorkspaces, refreshWorktrees });

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
      ref={rootRef}
      className={
        'terminal' +
        (sideCollapsed ? ' terminal--side-collapsed' : '') +
        (panelDragging ? ' terminal--dragging' : '')
      }
      // 섹션 안 버튼을 눌러 xterm 이 포커스를 잃으면 되돌린다 — 위 '포커스 안전망' 절
      onClick={reclaimFocus}
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
          {...wsActions}
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
          editorName={editorName}
          canOpenEditor={canCreate}
          onSelect={selectTab}
          onClose={closeSessionFromTab}
          onNew={openNewSession}
          onToggleChanges={toggleChanges}
          onOpenMo={openMoModal}
          onOpenEditor={openInEditor}
          onDragStartSession={onDragStartSession}
          onDragEndSession={onDragEndSession}
          onDetachSession={detachSession}
          onReorder={reorderTabs}
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
                  // 섹션이 keep-alive 로 숨으면 pane 전부를 '숨은 pane' 으로 내린다 —
                  // 크기 주장 중지(visibleRef)·⌘F 해제(focused)가 기존 게이트 그대로 걸리고,
                  // 복귀 시 visible/focused effect 가 fit·재주장·리드로·포커스를 복원한다
                  visible={active && (layoutRects ? !!pane : s.id === activeId)}
                  focused={active && s.id === activeId}
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
              onDragLeave={onZoneDragLeave}
              onDrop={(e) => onZoneDrop(e, z.panelId)}
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
            // 오버레이가 떠 있는 동안(이중 git 조회 방지)과 섹션이 keep-alive 로
            // 숨어 있는 동안(안 보는 diff 폴링은 낭비)은 드로어 폴링 중지
            polling={active && !changesFullOpen}
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
