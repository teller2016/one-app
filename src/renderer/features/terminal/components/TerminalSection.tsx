// 터미널 섹션 — LNB(워크스페이스 → 워크트리 트리) + 상단 세션 탭 + xterm + 우측 변경사항
// (Superset 스타일 오케스트레이터). 세션은 main 프로세스 소유라 탭·창을 닫아도 유지되고,
// MO(모바일)와 같은 세션을 공유한다. 워크트리를 고르면 탭바가 그 위치(cwd)의 세션들로 바뀐다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type {
  ChangesTarget,
  TerminalPreset,
  TerminalSessionInfo,
  TerminalWindowInfo,
  TerminalWorkspace,
  WorktreeInfo,
} from '../../../../shared/types';
import { termWaitToastKey } from '../../../../shared/types';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { EmptyState } from '../../../components/EmptyState';
import { Icon } from '../../../components/Icon';
import { useToast, useToastDismiss } from '../../../components/Toast';
import { Tooltip } from '../../../components/Tooltip';
import type { TerminalFocusRequest } from '../../../lib/sectionNav';
import {
  setSessionVisibilityCheck,
  useTerminalFocusRequest,
} from '../../../lib/sectionNav';
import { beginPointerDrag } from '../../../lib/pointerDrag';
import { useSessionHistory } from '../lib/useSessionHistory';
import { useSplitGroups } from '../lib/useSplitGroups';
import { useWorkspaceActions } from '../lib/useWorkspaceActions';
import { usePolling } from '../../../lib/usePolling';
import { ChangesOverlay, ChangesView } from '../../changes';
import type { DropSide } from '../lib/layout';
import {
  buildTabView,
  orderTabSessions,
  persistTabOrder,
  pruneWindowScreenState,
  savedTabOrders,
  useLastActive,
} from '../lib/tabs';
import {
  agentIdFromCommand,
  presetsForWorkspace,
  sameSelection,
  selectionKey,
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
import { TerminalPanes } from './TerminalPanes';
import { FONT_SIZE_DEFAULT, FONT_SIZE_MAX, FONT_SIZE_MIN } from './TerminalView';
import { usePaneOrchestration } from '../lib/usePaneOrchestration';
import { useTerminalShortcuts } from '../lib/useTerminalShortcuts';
import { WorkspaceNav } from './WorkspaceNav';
import { errMsg } from '../../../lib/errMsg';

// 터미널 IPC 노출 여부 — 개발 중 main/preload 변경은 HMR 이 안 되므로(렌더러만 갱신)
// 앱을 재시작하기 전까지 이 API 가 없다. 없으면 버튼이 조용히 죽는 대신 안내를 띄운다.
const terminalApi = () => window.oneApp?.terminal;

// 워크트리 목록·±변경량 갱신 주기 — 로컬 git 명령 몇 개라 수십 ms, 보이는 동안만 돈다
const WORKTREE_POLL_MS = 10_000;

/** 프리셋이 없는 위치에 넘길 고정 빈 배열 — 매번 [] 를 만들면 pane 의 memo 가 깨진다 */
const NO_PRESETS: TerminalPreset[] = [];

/** '만든 세션이 목록에 나타나면 활성화' 대기의 상한 — 브로드캐스트는 즉시 오므로
 *  이만큼 지나도 안 왔으면 그 세션은 오지 않는 것이다(activateSession 참고) */
const PENDING_ACTIVATE_TTL_MS = 3000;

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

/** active=false 는 keep-alive 로 숨은 상태(App 이 언마운트 대신 visibility 로 숨긴다) —
 *  pane 숨김(크기 주장 중지)·폴링 중지·전역 단축키 해제·포털 모달 닫기가 걸린다 */
export function TerminalSection({ active = true }: { active?: boolean }) {
  const toast = useToast();
  const dismissToast = useToastDismiss();
  const [sessions, setSessions] = useState<TerminalSessionInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const [workspaces, setWorkspaces] = useState<TerminalWorkspace[]>([]);
  const [worktrees, setWorktrees] = useState<Record<string, WorktreeInfo[]>>({});
  const [expanded, setExpanded] = useState<string[]>(savedExpanded);
  const [selection, setSelection] = useState<WorkspaceSelection | null>(savedSelection);
  // 탭 순서 — 사용자가 탭을 끌어 정한 표시 순서(화면별). 없는 화면·새 세션은 생성 순서.
  // 저장은 reorderTabs 가 그 화면 키만 갈아끼운다(persistTabOrder — 팝아웃 창과 공유 저장소)
  const [tabOrders, setTabOrders] = useState<Record<string, string[]>>(savedTabOrders);

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
    // ⚠️ **항상 경량 조회**(detail=false) — LNB 는 경로·브랜치·세션 수만 그린다.
    // 상세는 워크트리마다 `git status --untracked-files=all` + `git diff` 를 돌리는데,
    // 그건 이 폴링(10초·워크스페이스 전부)에서 감당할 비용이 아니다. 미커밋 변경량이
    // 필요한 곳은 자기가 상세로 부른다(워크트리 제거 확인 · Jira 작업 시작 모달).
    const entries = await Promise.all(
      list.map(async (ws) => {
        try {
          return [ws.id, await api.worktrees(ws.id, false)] as const;
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

  // ── 팝아웃 창 배정 미러 — 분리된 세션은 자리표시자 탭으로만 남고 pane 을 만들지
  // 않는다("한 세션 = 전 창 통틀어 pane 1개" — 정본은 main 의 windows.ts) ──
  const [termWindows, setTermWindows] = useState<TerminalWindowInfo[]>([]);
  const [windowsReady, setWindowsReady] = useState(false);
  useEffect(() => {
    const api = terminalApi()?.windows;
    if (!api) return;
    void api.list().then((list) => {
      setTermWindows(list);
      setWindowsReady(true); // 아래 win:* 청소가 빈 초기 배열로 돌면 산 창 상태를 지운다
    });
    return api.onChanged(setTermWindows);
  }, []);
  // 닫힌 팝아웃의 화면 상태(localStorage win:* — 레이아웃·탭 순서·활성 기억) 청소 —
  // 창 id 는 재사용되지 않아 다시 읽힐 일이 없다. 산 창의 키는 배정 목록이 지켜 준다.
  useEffect(() => {
    if (!windowsReady) return;
    pruneWindowScreenState(termWindows.map((w) => w.id));
  }, [windowsReady, termWindows]);
  /** 분리 세션 id → 팝아웃 창 id */
  const detachedIds = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of termWindows) for (const id of w.sessionIds) m.set(id, w.id);
    return m;
  }, [termWindows]);
  const detachedIdsRef = useRef(detachedIds);
  detachedIdsRef.current = detachedIds;
  /** 이 창(메인) 소유 세션들 — 분할 sanitize·pane 렌더 기준. 분리된 세션이 빠지는
   *  즉시 pane 이 언마운트돼 detach 되고, 그룹 트리는 sanitize 가 걷어낸다 */
  const mainSessions = useMemo(
    () =>
      detachedIds.size === 0
        ? sessions
        : sessions.filter((s) => !detachedIds.has(s.id)),
    [sessions, detachedIds]
  );
  /** livePanes 에서도 걷어낸다 — 참조 안정(useMemo) 필수 (usePaneOrchestration) */
  const detachedIdSet = useMemo(
    () => (detachedIds.size === 0 ? undefined : new Set(detachedIds.keys())),
    [detachedIds]
  );

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

  // 화면 키 — 탭 순서·분할 레이아웃·마지막 활성 세션·방문 히스토리가 전부 이 키로 갈린다
  const selKey = selectionKey(selection);

  // 탭 목록 — 이 화면의 세션들을 **사용자가 정한 순서**로. 순서에 없는 세션(새로 만든 것)은
  // 뒤에 원래 순서(생성 순)대로 남는다.
  const tabSessions = useMemo(() => {
    const base = !selection
      ? []
      : selection.kind === 'other'
        ? otherSessions
        : sessions.filter((s) => s.cwd === selection.path);
    return orderTabSessions(base, tabOrders[selKey]);
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
  const { lastActiveRef, rememberActive } = useLastActive();
  // 최신값 ref — 드롭·그립·선택 콜백의 참조를 고정하기 위한 것(pane·탭바 memo 유지)
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const selKeyRef = useRef(selKey);
  selKeyRef.current = selKey;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;

  // ── 다른 섹션·다른 창에서 넘어온 '이 세션을 열어라' 요청 — 처리 effect 는 아래에.
  // 선언이 여기(분할 그룹 훅보다 위)인 이유: 크로스 윈도우 드롭 콜백이 setFocusReq 를
  // 캡처하는데, 뒤에 선언하면 렌더 중 TDZ 에 걸린다.
  const [focusReq, setFocusReq] = useState<TerminalFocusRequest | null>(null);
  useTerminalFocusRequest(setFocusReq); // setState 는 identity 가 고정이라 그대로 넘긴다

  // ── 크로스 윈도우 드래그 미러 — 다른 창(팝아웃)이 끄는 세션이면 이 창도 드롭 존을 켠다 ──
  const [remoteDragId, setRemoteDragId] = useState<string | null>(null);
  useEffect(() => {
    const api = terminalApi()?.windows;
    if (!api) return;
    return api.onDragState((state) => {
      setRemoteDragId(
        state && state.sourceWindowId !== 'main' ? state.sessionId : null
      );
    });
  }, []);

  // 크로스 드롭의 '도착 후 분할 배치' 대기 — moveSession 브로드캐스트로 세션이
  // 이 창 소속이 된 **뒤에** 트리에 넣어야 sanitize 가 즉시 걷어내지 않는다
  const pendingDropRef = useRef<{
    sessionId: string;
    panelId: string;
    side: DropSide;
  } | null>(null);

  /** 다른 창의 세션이 이 창 pane 존에 드롭됐다 — 배정 이동 + 후속 배치 예약 */
  const onRemoteZoneDrop = useCallback(
    (id: string, panelId: string, side: DropSide) => {
      const api = terminalApi()?.windows;
      if (!api) return;
      const s = sessionsRef.current.find((x) => x.id === id);
      const sel = selectionRef.current;
      // 이 화면(워크트리)의 세션일 때만 분할 의미를 살린다 — 그룹은 selKey 소유물이라
      // 워크트리 경계를 넘는 분할은 만들지 않는다(복귀 + 그 워크트리로 이동 폴백)
      const matches = !!s && sel?.kind === 'worktree' && s.cwd === sel.path;
      void api.moveSession(id, 'main').then((res) => {
        if (!res.ok) {
          toast(res.error || '세션을 가져오지 못했습니다.', 'fail');
          return;
        }
        if (matches) {
          pendingDropRef.current = { sessionId: id, panelId, side };
        } else if (s) {
          toast('다른 워크트리의 세션이라 그 워크트리로 이동합니다.', 'info');
          setFocusReq({ sessionId: id, cwd: s.cwd });
        }
      });
    },
    [toast]
  );

  /** 다른 창의 탭을 탭바에 드롭 — 메인으로 복귀 + 그 세션의 워크트리로 이동·활성화 */
  const adoptSession = useCallback((id: string) => {
    const api = terminalApi()?.windows;
    if (!api) return;
    const cwd = sessionsRef.current.find((s) => s.id === id)?.cwd;
    void api.moveSession(id, 'main').then((res) => {
      if (res.ok && cwd) setFocusReq({ sessionId: id, cwd });
    });
  }, []);

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
    peekGroup,
    applyDropAt,
    onZoneDragOver,
    onZoneDragLeave,
    onZoneDrop,
    onSplitGripDown,
  } = useSplitGroups({
    selKey,
    selKeyRef,
    // ⚠️ sessions 가 아니라 **mainSessions** — 이 창의 sanitize 기준은 '세션 생존'이
    // 아니라 '메인 창 소속'이다. 팝아웃으로 분리된 세션이 그룹 트리에 남으면
    // 자리표시자와 pane 없는 그룹이 화면을 차지한다.
    sessions: mainSessions,
    sessionsReady,
    activeId,
    activeIdRef,
    setActiveId,
    rememberActive,
    // 크로스 윈도우 — 팝아웃 탭 드래그를 미러해 이 창 pane 존을 켜고, 드롭은 배정
    // 이동(moveSession) + 도착 후 배치(pendingDropRef → applyDropAt)로 처리한다
    remoteDragId,
    onRemoteZoneDrop,
  });

  // 크로스 드롭 후속 배치 — moveSession 브로드캐스트로 세션이 mainSessions 에
  // 나타나면 예약해 둔 pane 자리에 넣는다 (그 전에 넣으면 sanitize 가 걷어낸다)
  useEffect(() => {
    const p = pendingDropRef.current;
    if (!p) return;
    if (!mainSessions.some((s) => s.id === p.sessionId)) return;
    pendingDropRef.current = null;
    applyDropAt(p.sessionId, p.panelId, p.side);
  }, [mainSessions, applyDropAt]);

  /** 화면 전환만 — 히스토리에 남기지 않는다(새 세션 자동 활성화 등 자동 경로용).
   *  탭 클릭 = 화면 전환뿐이다 — 그룹 소속이면 그 그룹이, 아니면 단일 전체 화면이
   *  따라온다(뷰 = activeId 의 함수). 그룹을 건드리지 않는다. */
  const applyTab = useCallback(
    (id: string) => {
      rememberActive(selKeyRef.current, id);
      setActiveId(id);
    },
    [rememberActive]
  );

  // ── 섹션 안 뒤로/앞으로 — 세션·워크트리 전환을 히스토리에 쌓는다 (lib/useSessionHistory.ts) ──
  const { recordVisit } = useSessionHistory({
    active,
    selection,
    activeId,
    sessions,
    selectWorkspace: selectAndSave,
    setActiveId,
    rememberActive,
  });

  /** 탭 클릭·⌘1~9·⌃Tab — 사용자가 고른 전환이라 히스토리에 남긴다 */
  const selectTab = useCallback(
    (id: string) => {
      // 자리표시자(팝아웃 세션) — 화면 전환이 아니라 그 창 포커스다
      if (detachedIdsRef.current.has(id)) {
        void terminalApi()?.windows?.focusSession(id);
        return;
      }
      if (activeIdRef.current !== id) recordVisit();
      applyTab(id);
    },
    [applyTab, recordVisit]
  );

  /** LNB 워크트리·기타 선택 — 사용자 조작이라 히스토리에 남긴다
   *  (워크스페이스·워크트리를 갓 만든 뒤의 자동 이동은 selectAndSave 를 그대로 쓴다) */
  const selectWorkspaceTab = useCallback(
    (sel: WorkspaceSelection | null) => {
      if (sameSelection(sel, selectionRef.current)) return;
      recordVisit();
      selectAndSave(sel);
    },
    [recordVisit, selectAndSave]
  );

  /** 탭 드래그로 정한 새 순서 — 이 화면(selKey)만 기억한다(다른 워크트리는 그대로).
   *  받은 배열이 지금 탭 목록 전체라 죽은 세션 id 는 재정렬할 때마다 자연히 정리된다.
   *  ⚠️ 참조가 고정돼야 한다 — SessionTabs 가 memo 라 콜백이 바뀌면 탭바가 매번 리렌더된다. */
  const reorderTabs = useCallback(
    (ids: string[]) => {
      setTabOrders((cur) => ({ ...cur, [selKeyRef.current]: ids }));
      persistTabOrder(selKeyRef.current, ids);
    },
    [selKeyRef]
  );

  // ── 탭바 표시 구조 — 단일 | 그룹(통탭) | 자리표시자 아이템 목록 (lib/tabs.ts 공유) ──
  const tabView = useMemo(
    () => buildTabView(tabSessions, groups, detachedIds),
    [tabSessions, groups, detachedIds]
  );

  /** pane 클릭 = 포커스 이동 — 분할 중 어느 터미널이 키보드·⌘F 를 받는지 정한다 */
  const focusPane = useCallback(
    (id: string) => {
      if (activeIdRef.current === id) return;
      rememberActive(selKeyRef.current, id);
      setActiveId(id);
    },
    [rememberActive]
  );

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
  // applyTab 경유 — 분할 중이면 새 세션이 포커스된 슬롯을 이어받는다(탭 클릭과 동일 의미론).
  // 히스토리에는 남기지 않는다 — 사용자가 '이동'한 게 아니라 만든 세션이 따라온 것이다
  const pendingRef = useRef<string | null>(null);
  const pendingTimerRef = useRef<number | null>(null);
  // 대기가 풀렸음을 아래 '활성 세션 보정' effect 에 알리는 신호 — ref 변화는 렌더를
  // 만들지 않으므로, 만료로 비웠을 때 보정을 다시 돌리려면 상태가 하나 필요하다
  const [pendingCleared, setPendingCleared] = useState(0);

  /** 대기 해제(소비·만료 공용) — 타이머까지 함께 정리한다 */
  const clearPending = useCallback(() => {
    if (pendingTimerRef.current !== null) {
      window.clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }
    if (pendingRef.current === null) return;
    pendingRef.current = null;
    setPendingCleared((n) => n + 1);
  }, []);
  useEffect(() => () => clearPending(), [clearPending]);

  /** 대기 만료 — 그 id 의 세션은 오지 않는다. 사용자가 [이동]으로 부른 경우가 대부분이라
   *  조용히 넘기면 "눌렀는데 아무 일도 없다"가 되므로 이유를 알린다. */
  const expirePending = useCallback(() => {
    const missed = pendingRef.current;
    clearPending();
    if (missed) toast('세션을 찾지 못했습니다 — 이미 종료된 세션입니다.', 'fail');
  }, [clearPending, toast]);

  useEffect(() => {
    const pending = pendingRef.current;
    if (pending && sessions.some((s) => s.id === pending)) {
      clearPending();
      applyTab(pending);
    }
  }, [sessions, selKey, applyTab, clearPending]);

  useEffect(() => {
    if (pendingRef.current) return;
    if (
      activeId &&
      tabSessions.some((s) => s.id === activeId) &&
      // 활성 세션이 팝아웃으로 분리됐다 — 자리표시자를 activeId 로 두면 화면이 빈다
      !detachedIds.has(activeId)
    )
      return;
    // ⚠️ 이 effect 는 useSplitGroups 의 sanitize effect **뒤에** 돌아야 한다(훅 호출이
    // 위에 있어 그렇게 된다) — 그룹 뷰에서 focused 가 죽으면 그쪽이 남은 멤버를
    // rememberActive 로 먼저 기억해 두고, 여기서 그 remembered 를 읽어 같은 세션을
    // 고른다. 순서가 뒤집히면 둘이 서로 다른 setActiveId 를 쌓아 나중 것이 이긴다.
    const remembered = lastActiveRef.current.get(selKey);
    // 자리표시자는 폴백 후보가 아니다 — pane 이 없는 세션을 고르면 화면이 빈다
    const selectable = tabView.tabs.filter((s) => !detachedIds.has(s.id));
    setActiveId(
      selectable.find((s) => s.id === remembered)?.id ?? selectable[0]?.id ?? null
    );
  }, [tabSessions, tabView, activeId, selKey, pendingCleared, lastActiveRef, detachedIds]);

  /** 세션 생성·복제 직후 — 목록에 나타나면 그 세션을 활성화한다.
   *  ⚠️ 목록에 **끝내 나타나지 않는 id**(이미 종료된 세션의 알림 [이동] 등)를 받으면
   *  위 대기 플래그가 영영 남아 '활성 세션 보정' 이 통째로 멈춘다 — 탭을 직접 누르기
   *  전까지 화면이 빈 채로 고착됐다. 만료 타이머로 반드시 풀어 준다. */
  const activateSession = useCallback(
    (id: string) => {
      clearPending();
      pendingRef.current = id;
      pendingTimerRef.current = window.setTimeout(
        expirePending,
        PENDING_ACTIVATE_TTL_MS
      );
      setActiveId(id);
    },
    [clearPending, expirePending]
  );

  // ── '이 세션을 열어라' 요청 처리 (Jira [작업] → femc 세션 · 크로스 윈도우 복귀) ──
  // ⚠️ 요청이 도착한 시점엔 워크스페이스·워크트리 목록이 아직 없을 수 있다.
  // 그래서 담아 두고, 목록이 준비되면 **그 세션의 위치로 선택을 옮긴 뒤** 활성화한다 —
  // 선택을 안 옮기면 다른 워크트리를 보던 중일 때 탭 목록에 그 세션이 없다.
  // (state 선언은 크로스 윈도우 드롭 콜백보다 위 — 그쪽 주석 참고)
  useEffect(() => {
    if (!focusReq) return;
    // 그 세션이 팝아웃 창에 있으면 그 창 포커스가 곧 '열기'다 (Jira [작업] 등)
    const popoutId = detachedIds.get(focusReq.sessionId);
    if (popoutId) {
      void terminalApi()?.windows?.focus(popoutId);
      setFocusReq(null);
      return;
    }
    const wtReady = workspaces.every((w) => !!worktrees[w.id]);
    // 세션 목록도 기다린다 — 없으면 '이 세션이 살아 있는가' 판정을 할 수 없어
    // 죽은 세션 요청이 대기 만료(안내 토스트)로 흘러가야 할지 알 수 없다
    if (!wsReady || !sessionsReady || !wtReady) return; // 목록 도착까지 보류
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
  }, [
    focusReq,
    wsReady,
    sessionsReady,
    workspaces,
    worktrees,
    selectAndSave,
    activateSession,
    detachedIds,
  ]);

  // ── pane 오케스트레이션 — 살아 있는 pane(LRU)·글자 크기·pane 핸들·포커스 안전망·
  // 스크롤 상태. 팝아웃 창과 공유하는 훅(lib/usePaneOrchestration.ts)에 있다.
  const {
    livePanes,
    fontSize,
    changeFontSize,
    registerPaneHandle,
    openActiveSearch,
    scrollActiveToBottom,
    reclaimFocus,
    scrolledUp,
    onScrolledChange,
  } = usePaneOrchestration({
    activeId,
    activeGroupIds,
    activeIdRef,
    rootRef,
    excludeIds: detachedIdSet, // 분리 세션은 pane 을 만들지 않는다(그 창이 유일 pane)
  });

  // ── 팝아웃 분리·복귀 — 배정 변경은 전부 main(windows.ts)에 위임한다 ──
  const focusWindow = useCallback((windowId: string) => {
    void terminalApi()?.windows?.focus(windowId);
  }, []);
  const returnSession = useCallback((id: string) => {
    void terminalApi()?.windows?.moveSession(id, 'main');
  }, []);
  /** 탭을 창 밖에 놓았다 — 그 좌표에 팝아웃 창을 만든다 (그룹 멤버면 그룹째) */
  const detachToWindow = useCallback(
    (id: string, x: number, y: number) => {
      const api = terminalApi()?.windows;
      if (!api) return;
      // 트리는 무변경 조회(peekGroup)로 떠 간다 — 이 화면의 그룹 트리는 배정
      // 브로드캐스트 뒤 sanitize 가 지우므로, 창 생성이 거부돼도 잃는 것이 없다
      const group = peekGroup(id);
      void api.open(
        group
          ? { sessionIds: group.ids, layout: group.layout, x, y }
          : { sessionIds: [id], x, y }
      );
    },
    [peekGroup]
  );

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

  // 이미 떠 있던 입력대기 토스트는 그 세션이 화면에 올라오면 거둔다 — 눈으로 확인한
  // 알림이 남아 있을 이유가 없다(sticky 라 스스로 사라지지 않는다). 발신 '전' 억제는
  // 위의 visibility check 가, '이미 뜬 것' 정리는 여기가 맡아 짝을 이룬다.
  // 보고 있는 세션만 닫는다 — 아직 확인하지 않은 다른 세션의 알림까지 지우면 놓친다.
  useEffect(() => {
    if (!active) return;
    const shown = activeGroupIds ?? (activeId ? [activeId] : []);
    for (const id of shown) dismissToast(termWaitToastKey(id));
  }, [active, activeId, activeGroupIds, dismissToast]);

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

  // ── 세션 단축키 — 팝아웃 창과 공유하는 훅(lib/useTerminalShortcuts.ts)에 있다 ──
  useTerminalShortcuts(active, {
    tabs: tabView.tabs,
    activeId,
    activeSession,
    selectTab,
    closeSession,
    canCreate,
    createShell,
    toggleChanges,
  });

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
          otherBusy={otherSessions.some(
            (s) => s.working && !!s.agentId && s.agentId !== 'shell',
          )}
          onToggleExpand={toggleExpand}
          onSelect={selectWorkspaceTab}
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
          onDetachToWindow={detachToWindow}
          onFocusWindow={focusWindow}
          onReturnSession={returnSession}
          remoteDraggingId={remoteDragId}
          onAdoptSession={adoptSession}
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

        {/* pane 영역 — 마크업·불변식은 TerminalPanes(팝아웃 창과 공유)에 있다.
            ⚠️ sessions 가 아니라 mainSessions — 분리 세션의 pane 이 숨은 채 attach 를
            붙들면 '한 세션 = 전 창 pane 1개' 불변식이 깨진다(즉시 언마운트 = detach) */}
        <TerminalPanes
          sessions={mainSessions}
          livePanes={livePanes}
          active={active}
          activeId={activeId}
          fontSize={fontSize}
          layoutRects={layoutRects}
          panesRef={panesRef}
          dropZones={dropZones}
          hintRect={hintRect}
          onFocusPane={focusPane}
          onRegisterHandle={registerPaneHandle}
          onScrolledChange={onScrolledChange}
          onZoneDragOver={onZoneDragOver}
          onZoneDragLeave={onZoneDragLeave}
          onZoneDrop={onZoneDrop}
          onSplitGripDown={onSplitGripDown}
        >
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
        </TerminalPanes>
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
