// 터미널 섹션 — LNB(워크스페이스 → 워크트리 트리) + 상단 세션 탭 + xterm + 우측 변경사항
// (Superset 스타일 오케스트레이터). 세션은 main 프로세스 소유라 탭·창을 닫아도 유지되고,
// MO(모바일)와 같은 세션을 공유한다. 워크트리를 고르면 탭바가 그 위치(cwd)의 세션들로 바뀐다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
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
import { usePolling } from '../../../lib/usePolling';
import { ChangesView } from '../../changes';
import {
  agentIdFromCommand,
  presetsForWorkspace,
  worktreeName,
} from '../lib/workspace';
import type { WorkspaceSelection } from '../lib/workspace';
import { MoAccessModal } from './MoAccessModal';
import { NewSessionModal } from './NewSessionModal';
import { PresetsModal } from './PresetsModal';
import { NewWorkspaceModal } from './NewWorkspaceModal';
import { NewWorktreeModal } from './NewWorktreeModal';
import { SessionTabs } from './SessionTabs';
import {
  FONT_SIZE_DEFAULT,
  FONT_SIZE_KEY,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  TerminalView,
} from './TerminalView';
import { WorkspaceNav } from './WorkspaceNav';

// 터미널 IPC 노출 여부 — 개발 중 main/preload 변경은 HMR 이 안 되므로(렌더러만 갱신)
// 앱을 재시작하기 전까지 이 API 가 없다. 없으면 버튼이 조용히 죽는 대신 안내를 띄운다.
const terminalApi = () => window.oneApp?.terminal;

// 워크트리 목록·±변경량 갱신 주기 — 로컬 git 명령 몇 개라 수십 ms, 보이는 동안만 돈다
const WORKTREE_POLL_MS = 10_000;

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
  const available = !!terminalApi();

  const [fontSize, setFontSize] = useState(savedFontSize);
  const changeFontSize = (n: number) => {
    localStorage.setItem(FONT_SIZE_KEY, String(n));
    setFontSize(n);
  };

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
    setWorktrees(Object.fromEntries(entries));
  }, []);
  useEffect(() => {
    void refreshWorktrees();
  }, [workspaces, refreshWorktrees]);
  usePolling(() => void refreshWorktrees(), WORKTREE_POLL_MS, { immediate: false });

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
  const rememberActive = (key: string, id: string) => {
    lastActiveRef.current.set(key, id);
    localStorage.setItem(
      'terminal:lastActive',
      JSON.stringify(Object.fromEntries(lastActiveRef.current))
    );
  };
  // 방금 만든 세션 — 목록 브로드캐스트가 아직 안 왔으면 보정 효과가 첫 탭으로 되돌리므로,
  // 목록에 나타날 때까지 기다렸다가 활성화한다 (생성 응답과 브로드캐스트의 순서 무관)
  const pendingRef = useRef<string | null>(null);

  useEffect(() => {
    const pending = pendingRef.current;
    if (pending && sessions.some((s) => s.id === pending)) {
      pendingRef.current = null;
      rememberActive(selKey, pending);
      setActiveId(pending);
    }
    // rememberActive 는 ref+localStorage 만 만지는 안정 함수라 의존성에 두지 않는다
  }, [sessions, selKey]);

  useEffect(() => {
    if (pendingRef.current) return;
    if (activeId && tabSessions.some((s) => s.id === activeId)) return;
    const remembered = lastActiveRef.current.get(selKey);
    setActiveId(
      tabSessions.find((s) => s.id === remembered)?.id ?? tabSessions[0]?.id ?? null
    );
  }, [tabSessions, activeId, selKey]);

  const selectTab = (id: string) => {
    rememberActive(selKey, id);
    setActiveId(id);
  };

  /** 세션 생성·복제 직후 — 목록에 나타나면 그 세션을 활성화한다 */
  const activateSession = (id: string) => {
    pendingRef.current = id;
    setActiveId(id);
  };

  /** ⌘T — 모달 없이 현재 워크트리에서 바로 셸 세션을 연다 (2026-08-06 사용자 요청) */
  const createShell = async () => {
    if (selection?.kind !== 'worktree') return;
    try {
      const info = await terminalApi()?.create({ cwd: selection.path });
      if (info) activateSession(info.id);
    } catch (err) {
      toast(`세션 생성 실패: ${(err as Error).message}`, 'fail');
    }
  };

  /** 프리셋 실행 — 같은 위치의 새 세션에서 명령 자동 실행 (Superset new-tab 동일) */
  const runPreset = async (session: TerminalSessionInfo, preset: TerminalPreset) => {
    try {
      const info = await terminalApi()?.create({
        cwd: session.cwd,
        // claude 프리셋 등은 에이전트로 태깅 — 입력대기 알림·상태 휴리스틱이 살아난다
        agentId: agentIdFromCommand(preset.command),
        command: preset.command,
        title: preset.name,
      });
      if (info) activateSession(info.id);
    } catch (err) {
      toast(`프리셋 실행 실패: ${(err as Error).message}`, 'fail');
    }
  };

  const activeSession = tabSessions.find((s) => s.id === activeId) ?? null;

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
  const toggleChanges = () => {
    const next = !changesOpen;
    localStorage.setItem('terminal:changesOpen', next ? '1' : '0');
    setChangesOpen(next);
  };

  const toggleExpand = (wsId: string) => {
    const next = expanded.includes(wsId)
      ? expanded.filter((id) => id !== wsId)
      : [...expanded, wsId];
    localStorage.setItem('terminal:wsExpanded', JSON.stringify(next));
    setExpanded(next);
  };

  const ensureExpanded = (wsId: string) => {
    if (expanded.includes(wsId)) return;
    const next = [...expanded, wsId];
    localStorage.setItem('terminal:wsExpanded', JSON.stringify(next));
    setExpanded(next);
  };

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
      if (e.ctrlKey && !e.metaKey && e.key === 'Tab') {
        if (tabSessions.length < 2) return;
        claim();
        const cur = tabSessions.findIndex((s) => s.id === activeId);
        const next =
          (cur + (e.shiftKey ? -1 : 1) + tabSessions.length) % tabSessions.length;
        selectTab(tabSessions[next].id);
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
        const target = tabSessions[Number(e.key) - 1];
        if (!target) return;
        claim();
        selectTab(target.id);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // closeSession·selectTab·createShell 은 매 렌더 새로 만들어지지만 그 안에서 쓰는
    // confirm·toast 가 안정적이라 참조 값(선택·탭 목록·활성 세션)만 의존성으로 둔다
  }, [tabSessions, activeId, activeSession, canCreate, selection]);

  // 확인 없이 즉시 종료 (2026-08-06 사용자 요청 — Superset 도 바로 닫는다).
  // tmux 백엔드라 실수로 닫아도 프로세스만 죽고 복구 대상이 없다.
  const closeSession = async (s: TerminalSessionInfo) => {
    try {
      await terminalApi()?.kill(s.id);
    } catch (err) {
      toast(`세션 종료 실패: ${(err as Error).message}`, 'fail');
    }
  };

  const removeWorktree = async (ws: TerminalWorkspace, wt: WorktreeInfo) => {
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
  };

  const removeWorkspace = async (ws: TerminalWorkspace) => {
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
  };

  // 이름·색 변경은 같은 save 채널 — 미지정 필드는 main 이 기존 값을 유지한다
  const saveWorkspace = async (input: {
    id: string;
    name: string;
    repoPath: string;
    color?: number;
  }) => {
    try {
      await window.oneApp.workspaces.save(input);
    } catch (err) {
      toast(`워크스페이스 저장 실패: ${(err as Error).message}`, 'fail');
    }
  };

  // 드래그 순서 변경 — 브로드캐스트를 기다리면 드롭 순간 원래 자리로 튀어 보이므로
  // 로컬 목록을 먼저 재배열한다(낙관적 갱신 — main 저장 결과가 곧 덮어 확정)
  const reorderWorkspaces = (ids: string[]) => {
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
  };

  const revealWorkspace = async (ws: TerminalWorkspace) => {
    const r = await window.oneApp.workspaces.reveal(ws.id);
    if (!r.ok) toast(`폴더를 열지 못했습니다: ${r.error ?? ''}`, 'fail');
  };

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
                onClick={() => setNewWsOpen(true)}
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
          onRemoveWorktree={(ws, wt) => void removeWorktree(ws, wt)}
          onRemoveWorkspace={(ws) => void removeWorkspace(ws)}
          onReorder={reorderWorkspaces}
          onRename={(ws, name) =>
            void saveWorkspace({ id: ws.id, name, repoPath: ws.repoPath })
          }
          onSetColor={(ws, color) =>
            void saveWorkspace({ id: ws.id, name: ws.name, repoPath: ws.repoPath, color })
          }
          onReveal={(ws) => void revealWorkspace(ws)}
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
          sessions={tabSessions}
          activeId={activeId}
          canCreate={canCreate}
          changesOpen={changesOpen}
          moRunning={moRunning}
          onSelect={selectTab}
          onClose={(s) => void closeSession(s)}
          onNew={() => setNewSessionOpen(true)}
          onToggleChanges={toggleChanges}
          onOpenMo={() => setMoOpen(true)}
        />

        {/* ⚠️ 세션마다 pane 을 만들고 **보이지 않는 것도 언마운트하지 않는다** — 예전엔
            key={activeId} 로 xterm 을 매번 파괴해서, 전환할 때마다 선택 영역·검색 상태가
            사라지고 attach 왕복 + TUI 전체 리렌더를 다시 겪었다. 숨은 pane 은 absolute
            inset:0 이라 활성 pane 과 같은 크기를 유지한다 — 탭바가 위에 생겼으므로
            기준 컨테이너는 __main 이 아니라 이 __panes 다(아니면 탭바 높이만큼 어긋난다). */}
        <div className="terminal__panes">
          {sessions.map((s) => (
            <TerminalView
              key={s.id}
              session={s}
              active={s.id === activeId}
              fontSize={fontSize}
              onFontSize={changeFontSize}
              presets={presetsForWorkspace(presets, workspaceIdOf(s.cwd))}
              onRunPreset={(p) => void runPreset(s, p)}
              onEditPresets={() => setPresetsOpen(true)}
            />
          ))}
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
          />
        </aside>
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
