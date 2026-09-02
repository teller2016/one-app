// 터미널 팝아웃 창 루트 — 앱 셸(사이드바·탑바) 없이 탭바 + 분할 pane 만 있는 창.
// 세션↔창 배정은 main(features/terminal/windows.ts)이 소유하고 여기는 미러만 한다.
// 화면 키(selKey)는 `win:<popoutId>` — 분할 트리·탭 순서·마지막 활성이 이 키로 갈려
// 메인 창의 화면 상태(localStorage 공유 오리진)와 충돌하지 않는다.
//
// 메인 창(TerminalSection)과 다른 점:
// - 섹션 keep-alive 개념 없음 — 창이 곧 화면이라 항상 active
// - 세션 생성 경로 없음 — pendingRef(활성화 대기) 함정 자체를 반입하지 않는다
// - 워크스페이스 선택 없음 — 배정 세션이 곧 탭 목록(cwd 무관 혼재 허용)
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { TerminalSessionInfo } from '../../../../shared/types';
import { ConfirmProvider } from '../../../components/ConfirmDialog';
import { ErrorBoundary } from '../../../components/ErrorBoundary';
import { EmptyState } from '../../../components/EmptyState';
import { Icon } from '../../../components/Icon';
import { useToast, ToastProvider } from '../../../components/Toast';
import { Tooltip } from '../../../components/Tooltip';
import { errMsg } from '../../../lib/errMsg';
import { LAYOUT_STORAGE_KEY } from '../lib/layout';
import { FONT_SIZE_DEFAULT, FONT_SIZE_MAX, FONT_SIZE_MIN } from './TerminalView';
import type { DropSide } from '../lib/layout';
import {
  buildTabView,
  orderTabSessions,
  persistTabOrder,
  savedTabOrders,
  useLastActive,
} from '../lib/tabs';
import { usePaneOrchestration } from '../lib/usePaneOrchestration';
import { useSplitGroups } from '../lib/useSplitGroups';
import { useTerminalShortcuts } from '../lib/useTerminalShortcuts';
import { SessionTabs } from './SessionTabs';
import { TerminalPanes } from './TerminalPanes';

const NOOP = () => {
  /* 팝아웃엔 없는 동작(새 세션·변경사항·MO·IDE) — SessionTabs 의 memo 를 위해 참조 고정 */
};

/**
 * 팝아웃 부팅 — main 의 배정(init)을 **마운트 전에** 받아 온다.
 * 그룹째 분리된 창은 최초 분할 트리를 localStorage(`win:<id>` 키)에 먼저 심어야
 * useSplitGroups 의 초기 로드(savedLayouts)가 읽는다 — 마운트 후 심으면 한 발 늦는다.
 */
export async function mountTerminalPopout(
  container: Element,
  windowId: string
): Promise<void> {
  const api = window.oneApp?.terminal?.windows;
  let initialIds: string[] = [];
  let initialAlwaysOnTop = false;
  try {
    const init = api ? await api.init(windowId) : { sessionIds: [] };
    initialIds = init.sessionIds;
    initialAlwaysOnTop = init.alwaysOnTop === true;
    if (init.layout) {
      try {
        const tree: unknown = JSON.parse(init.layout);
        const raw = JSON.parse(
          localStorage.getItem(LAYOUT_STORAGE_KEY) ?? '{}'
        ) as Record<string, unknown>;
        raw[`win:${windowId}`] = [tree];
        localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(raw));
      } catch {
        // 손상된 트리는 버린다 — 단일 pane 으로 뜨는 것이 빈 창보다 낫다
      }
    }
  } catch {
    // init 실패(창 레코드 소멸 등) — 빈 창으로 뜨고, main 이 곧 닫는다
  }
  createRoot(container).render(
    <TerminalPopoutApp
      windowId={windowId}
      initialIds={initialIds}
      initialAlwaysOnTop={initialAlwaysOnTop}
    />
  );
}

export function TerminalPopoutApp({
  windowId,
  initialIds,
  initialAlwaysOnTop = false,
}: {
  windowId: string;
  initialIds: string[];
  initialAlwaysOnTop?: boolean;
}) {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <ErrorBoundary label="터미널 팝아웃">
          <PopoutBody
            windowId={windowId}
            initialIds={initialIds}
            initialAlwaysOnTop={initialAlwaysOnTop}
          />
        </ErrorBoundary>
      </ConfirmProvider>
    </ToastProvider>
  );
}

function PopoutBody({
  windowId,
  initialIds,
  initialAlwaysOnTop,
}: {
  windowId: string;
  initialIds: string[];
  initialAlwaysOnTop: boolean;
}) {
  const toast = useToast();
  const selKey = `win:${windowId}`;
  const ownsLayoutKey = useCallback((k: string) => k === selKey, [selKey]);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // ── 세션 미러 — main 이 payload 로 push (TerminalSection 과 동일 패턴) ──
  const [sessions, setSessions] = useState<TerminalSessionInfo[]>([]);
  const [sessionsReady, setSessionsReady] = useState(false);
  useEffect(() => {
    const api = window.oneApp?.terminal;
    if (!api) return;
    void api.list().then((list) => {
      setSessions(list);
      setSessionsReady(true);
    });
    return api.onSessions((list) => {
      if (list) setSessions(list);
      else void api.list().then(setSessions);
    });
  }, []);

  // ── 배정 미러 — 이 창(windowId)의 세션 id 들. 정본은 main 의 windows.ts ──
  const [myIds, setMyIds] = useState<string[]>(initialIds);
  useEffect(() => {
    const api = window.oneApp?.terminal?.windows;
    if (!api) return;
    return api.onChanged((wins) => {
      const mine = wins.find((w) => w.id === windowId);
      // 내 레코드가 사라졌다 = 창이 곧 닫힌다(main 이 close) — 상태는 그대로 둔다
      if (mine) setMyIds(mine.sessionIds);
    });
  }, [windowId]);

  // ── 탭 순서 — 메인 창과 같은 저장소(selKey 로 격리). 저장은 그 키만(persistTabOrder) ──
  const [tabOrders, setTabOrders] = useState<Record<string, string[]>>(savedTabOrders);
  const reorderTabs = useCallback(
    (ids: string[]) => {
      setTabOrders((cur) => ({ ...cur, [selKey]: ids }));
      persistTabOrder(selKey, ids);
    },
    [selKey]
  );

  // 이 창의 세션들 — ⚠️ pane DOM 순서 안정을 위해 sessions 원본 순서 유지(정렬은 탭만)
  const mySessions = useMemo(
    () => sessions.filter((s) => myIds.includes(s.id)),
    [sessions, myIds]
  );
  const tabSessions = useMemo(
    () => orderTabSessions(mySessions, tabOrders[selKey]),
    [mySessions, tabOrders, selKey]
  );

  const [activeId, setActiveId] = useState<string | null>(null);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const selKeyRef = useRef(selKey);
  selKeyRef.current = selKey;
  const { lastActiveRef, rememberActive } = useLastActive();

  // ── 크로스 윈도우 드래그 미러 — 다른 창(메인·다른 팝아웃)이 끄는 세션이면
  // 이 창도 드롭 존('가져오기')을 켠다 ──
  const [remoteDragId, setRemoteDragId] = useState<string | null>(null);
  useEffect(() => {
    const api = window.oneApp?.terminal?.windows;
    if (!api) return;
    return api.onDragState((state) => {
      setRemoteDragId(
        state && state.sourceWindowId !== windowId ? state.sessionId : null
      );
    });
  }, [windowId]);

  // 크로스 드롭의 '도착 후 배치' 대기 — 배정 브로드캐스트로 세션이 이 창 소속이 된
  // 뒤에 트리에 넣는다(그 전에 넣으면 sanitize 가 즉시 걷어낸다). panelId 가 null 이면
  // 탭바 드롭 — 배치 없이 활성화만 한다.
  const pendingDropRef = useRef<{
    sessionId: string;
    panelId: string | null;
    side: DropSide | null;
  } | null>(null);

  /** 다른 창의 세션이 이 창 pane 존에 드롭됐다 — 배정 이동 + 분할 배치 예약 */
  const onRemoteZoneDrop = useCallback(
    (id: string, panelId: string, side: DropSide) => {
      void window.oneApp?.terminal?.windows?.moveSession(id, windowId).then((res) => {
        if (res?.ok) pendingDropRef.current = { sessionId: id, panelId, side };
        else if (res) toast(res.error || '세션을 가져오지 못했습니다.', 'fail');
      });
    },
    [windowId, toast]
  );

  /** 다른 창의 탭을 탭바에 드롭 — 이 창으로 가져와 활성화 */
  const adoptSession = useCallback(
    (id: string) => {
      void window.oneApp?.terminal?.windows?.moveSession(id, windowId).then((res) => {
        if (res?.ok) pendingDropRef.current = { sessionId: id, panelId: null, side: null };
        else if (res) toast(res.error || '세션을 가져오지 못했습니다.', 'fail');
      });
    },
    [windowId, toast]
  );

  // ── 분할 그룹 — 메인 창과 같은 상태기계 (lib/useSplitGroups.ts) ──
  // ⚠️ sessions 가 아니라 **mySessions** 를 넘긴다 — 이 창의 sanitize 기준은
  // '세션 생존'이 아니라 '이 창 배정'이다(메인으로 되돌린 세션이 그룹에 남으면 안 된다).
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
    sessions: mySessions,
    sessionsReady,
    activeId,
    activeIdRef,
    setActiveId,
    rememberActive,
    windowId,
    remoteDragId,
    onRemoteZoneDrop,
    // 이 창은 자기 레이아웃 키 하나만 소유한다 — 저장 시 다른 창 키를 덮지 않는다
    ownsLayoutKey,
  });

  // 크로스 드롭 후속 처리 — 세션이 이 창 소속(mySessions)이 되면 예약을 소비한다
  useEffect(() => {
    const p = pendingDropRef.current;
    if (!p) return;
    if (!mySessions.some((s) => s.id === p.sessionId)) return;
    pendingDropRef.current = null;
    if (p.panelId && p.side) {
      applyDropAt(p.sessionId, p.panelId, p.side); // pane 자리에 분할 배치
    } else {
      rememberActive(selKeyRef.current, p.sessionId); // 탭바 드롭 — 활성화만
      setActiveId(p.sessionId);
    }
  }, [mySessions, applyDropAt, rememberActive]);

  const tabView = useMemo(() => buildTabView(tabSessions, groups), [tabSessions, groups]);

  /** 탭 클릭·⌘1..9·⌃Tab — 팝아웃엔 세션 히스토리가 없어 화면 전환만 한다 */
  const selectTab = useCallback(
    (id: string) => {
      rememberActive(selKeyRef.current, id);
      setActiveId(id);
    },
    [rememberActive]
  );
  /** pane 클릭 = 포커스 이동 (TerminalSection 의 focusPane 과 동일 의미) */
  const focusPane = useCallback(
    (id: string) => {
      if (activeIdRef.current === id) return;
      rememberActive(selKeyRef.current, id);
      setActiveId(id);
    },
    [rememberActive]
  );

  // ── 활성 세션 보정 — TerminalSection 의 축약판(생성 대기 pendingRef 없음).
  // ⚠️ useSplitGroups 의 sanitize effect 뒤에 돌아야 한다(훅 호출 순서로 보장) —
  // 그쪽이 rememberActive 로 남긴 폴백을 여기서 읽는다.
  useEffect(() => {
    if (!sessionsReady) return;
    if (activeId && tabSessions.some((s) => s.id === activeId)) return;
    const remembered = lastActiveRef.current.get(selKey);
    setActiveId(
      tabView.tabs.find((s) => s.id === remembered)?.id ?? tabView.tabs[0]?.id ?? null
    );
  }, [sessionsReady, tabSessions, tabView, activeId, selKey, lastActiveRef]);

  // ── pane 오케스트레이션·단축키 — 메인 창과 공유 훅 ──
  const {
    livePanes,
    fontSize,
    changeFontSize,
    registerPaneHandle,
    scrollActiveToBottom,
    reclaimFocus,
    scrolledUp,
    onScrolledChange,
  } = usePaneOrchestration({ activeId, activeGroupIds, activeIdRef, rootRef });
  // ⚠️ scrolledUp 은 Record 라 참조가 자주 바뀐다 — 헤더 memo 에는 활성 세션의 boolean 만 넣는다
  const activeScrolledUp = !!activeId && !!scrolledUp[activeId];

  // ── 항상 위 — 한 화면에서 다른 앱을 쓰며 세션을 지켜보는 용도. 정본은 main(배정 레코드) ──
  const [alwaysOnTop, setAlwaysOnTop] = useState(initialAlwaysOnTop);
  const toggleAlwaysOnTop = useCallback(() => {
    const next = !alwaysOnTop;
    setAlwaysOnTop(next); // 낙관 — 실패하면 아래서 되돌린다
    void window.oneApp?.terminal?.windows?.setAlwaysOnTop?.(windowId, next).then((res) => {
      if (!res?.ok) {
        setAlwaysOnTop(!next);
        toast(res?.error || '창 설정을 바꾸지 못했습니다.', 'fail');
      }
    });
  }, [alwaysOnTop, windowId, toast]);

  const closeSession = useCallback(
    async (s: TerminalSessionInfo) => {
      try {
        await window.oneApp?.terminal?.kill(s.id);
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
  // ── IDE 열기 — 설치 여부는 한 번만 묻고, 미설치면 이름이 null 이라 버튼·메뉴가 안 그려진다
  // (TerminalSection 과 같은 조회) ──
  const [editorName, setEditorName] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const api = window.oneApp?.workspaces;
    if (!api) return;
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
  /** 그 세션이 속한 **워크트리**를 IDE 로 — 탭 우클릭·헤더 버튼 공용. 팝아웃은 서로 다른
   *  워크트리의 세션이 섞일 수 있어 대상을 세션 단위로 잡는다(경로 해석·검증은 main) */
  const openEditorFor = useCallback(
    (id: string) => {
      void (async () => {
        try {
          const res = await window.oneApp?.terminal?.openEditor?.(id);
          if (res && !res.ok) toast(res.error || '열지 못했습니다.', 'fail');
        } catch (err) {
          toast(errMsg(err, '열지 못했습니다.'), 'fail');
        }
      })();
    },
    [toast]
  );

  /** 탭 우클릭 [Finder 에서 열기] — main 이 세션 id 로 cwd 를 해석한다 */
  const revealSessionCwd = useCallback(
    (id: string) => {
      void (async () => {
        const res = await window.oneApp?.terminal?.revealCwd(id);
        if (res && !res.ok) toast('위치를 열지 못했습니다.', 'fail');
      })();
    },
    [toast]
  );
  const activeSession = tabSessions.find((s) => s.id === activeId) ?? null;

  useTerminalShortcuts(true, {
    tabs: tabView.tabs,
    activeId,
    activeSession,
    selectTab,
    closeSession,
    // ⌘T(생성)·⌘B(변경사항)는 팝아웃에 없다 — 콜백을 비워 키를 잡지 않는다
  });

  // ── 화면 세션 보고 — main 이 입력대기 토스트 게이트·창 타이틀에 쓴다 ──
  // ⚠️ **창 포커스에서도 다시 보고한다** — 알림 게이트가 포커스를 보므로 이 창이 뒤에
  // 있는 동안에는 그 세션의 입력대기 토스트가 메인 창에 뜬다. 이동해 와도 화면 세션이
  // 그대로면 아래 deps 가 안 바뀌어 **그 sticky 토스트가 영영 남았다**(2026-09-01).
  useEffect(() => {
    const ids = activeGroupIds ?? (activeId ? [activeId] : []);
    const report = () =>
      window.oneApp?.terminal?.windows?.reportVisible(windowId, ids);
    report();
    window.addEventListener('focus', report);
    return () => window.removeEventListener('focus', report);
  }, [windowId, activeId, activeGroupIds]);

  // ── 레포 라벨 — "워크스페이스 · 워크트리" (main 의 sessionLocationLabel, cwd 캐시) ──
  const [locLabel, setLocLabel] = useState<string | null>(null);
  const labelSid = activeId ?? tabSessions[0]?.id ?? null;
  useEffect(() => {
    if (!labelSid) {
      setLocLabel(null);
      return;
    }
    let alive = true;
    void window.oneApp?.terminal?.locationLabel?.(labelSid).then((label) => {
      if (alive) setLocLabel(label);
    });
    return () => {
      alive = false;
    };
  }, [labelSid]);

  /** 세션 하나를 메인 창 탭으로 되돌린다 — 우측 [↩]·탭 우클릭 메뉴 공용
   *  (창 닫기 = 배정 전부 삭제 = 전부 되돌리기) */
  const returnSession = useCallback(
    (id: string): void => {
      void (async () => {
        try {
          const res = await window.oneApp?.terminal?.windows?.moveSession(id, 'main');
          if (res && !res.ok) {
            toast(res.error || '되돌리지 못했습니다.', 'fail');
            return;
          }
          // 메인 창이 다른 워크트리를 보고 있으면 되돌린 세션이 화면에 안 나타난다 —
          // 그 창을 앞으로 세우고 세션의 워크트리까지 열게 한다(main 경유)
          void window.oneApp?.terminal?.windows?.revealInMain?.(id);
        } catch (err) {
          toast(errMsg(err, '되돌리지 못했습니다.'), 'fail');
        }
      })();
    },
    [toast]
  );
  const returnActiveFromBar = useCallback((): void => {
    const id = activeIdRef.current;
    if (id) returnSession(id);
  }, [returnSession]);

  /** 이 창의 탭을 또 창 밖에 놓았다 — 그 좌표에 새 팝아웃 창 (그룹 멤버면 그룹째) */
  const detachToWindow = useCallback(
    (id: string, x?: number, y?: number) => {
      const api = window.oneApp?.terminal?.windows;
      if (!api) return;
      // 트리는 무변경 조회(peekGroup) — 이 창의 트리·배정 정리는 open 의 배정
      // 브로드캐스트 뒤 sanitize·onChanged 가 처리한다
      const group = peekGroup(id);
      const at = typeof x === 'number' && typeof y === 'number' ? { x, y } : {};
      void api.open(
        group
          ? { sessionIds: group.ids, layout: group.layout, ...at }
          : { sessionIds: [id], ...at }
      );
    },
    [peekGroup]
  );

  /** 헤더 [Finder] — 활성 세션 기준 */
  const revealActive = useCallback(() => {
    const id = activeIdRef.current;
    if (id) revealSessionCwd(id);
  }, [revealSessionCwd]);
  /** 헤더 [IDE] — 활성 세션 기준. 레포 라벨·Finder 와 같은 규칙이라 "라벨에 뜬 그 워크트리가
   *  열린다"로 읽힌다. 라벨이 없으면(등록 밖 세션) 열 대상이 없어 버튼을 비활성으로 */
  const openEditorActive = useCallback(() => {
    const id = activeIdRef.current;
    if (id) openEditorFor(id);
  }, [openEditorFor]);

  // 우측 액션 — 변경사항·MO 버튼 대신 레포 라벨 + 메인 툴바의 축약판(글자 크기·맨 아래로·
  // Finder) + 항상 위 + 되돌리기. 팝아웃은 탭바가 곧 타이틀바라 **툴바를 한 줄 더 두지
  // 않고** 이 슬롯에 넣는다(세로 공간 보존). 검색은 ⌘F 로 충분해 버튼을 뺐다.
  // 참조는 memo 로 고정 — SessionTabs 가 memo 다.
  const rightActions = useMemo(
    () => (
      <>
        {locLabel && (
          <span className="terminal__popout-loc" title={locLabel}>
            <Icon name="folder-git" size={14} />
            <span className="terminal__popout-loc-text">{locLabel}</span>
          </span>
        )}
        <span className="terminal__bar-actions">
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
          <Tooltip label={`글자 크기 ${fontSize}px — 눌러서 기본(${FONT_SIZE_DEFAULT}px)으로`}>
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
        </span>
        {activeScrolledUp && (
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
            onClick={revealActive}
          >
            <Icon name="folder" size={14} />
          </button>
        </Tooltip>
        {editorName && (
          <Tooltip
            label={
              locLabel
                ? `${locLabel} 를 ${editorName} 로 열기`
                : `등록된 워크트리 안의 세션이 아니라 ${editorName} 로 열 수 없습니다`
            }
          >
            <button
              type="button"
              className="icon-btn"
              aria-label={`${editorName} 로 열기`}
              disabled={!activeSession || !locLabel}
              onClick={openEditorActive}
            >
              <Icon name="code-xml" size={14} />
            </button>
          </Tooltip>
        )}
        <Tooltip
          label={
            alwaysOnTop
              ? '항상 위 켜짐 — 다른 앱 위에도 떠 있습니다. 눌러서 해제'
              : '항상 위 — 다른 앱을 쓰면서 이 창을 계속 보이게'
          }
        >
          <button
            type="button"
            className={`icon-btn${alwaysOnTop ? ' terminal__popout-pin--on' : ''}`}
            aria-label="항상 위"
            aria-pressed={alwaysOnTop}
            onClick={toggleAlwaysOnTop}
          >
            <Icon name="pin" size={14} />
          </button>
        </Tooltip>
        <Tooltip label="현재 세션을 메인 창으로 되돌리기 (창을 닫으면 전부 되돌아갑니다)">
          <button
            type="button"
            className="icon-btn"
            aria-label="메인 창으로 되돌리기"
            disabled={!activeSession}
            onClick={returnActiveFromBar}
          >
            <Icon name="corner-up-left" size={16} />
          </button>
        </Tooltip>
      </>
    ),
    [
      locLabel,
      activeSession,
      returnActiveFromBar,
      fontSize,
      changeFontSize,
      activeScrolledUp,
      scrollActiveToBottom,
      revealActive,
      editorName,
      openEditorActive,
      alwaysOnTop,
      toggleAlwaysOnTop,
    ]
  );

  return (
    <div
      ref={rootRef}
      className="terminal terminal--popout"
      onClick={reclaimFocus} // 포커스 안전망 — 버튼 클릭 후 ⌘C/⌘V 가 죽지 않게 (usePaneOrchestration)
    >
      <div className="terminal__main">
        <SessionTabs
          items={tabView.items}
          activeId={activeId}
          draggingId={dragSession}
          canCreate={false}
          changesOpen={false}
          moRunning={false}
          editorName={editorName}
          canOpenEditor={false}
          onSelect={selectTab}
          onClose={closeSessionFromTab}
          onNew={NOOP}
          onToggleChanges={NOOP}
          onOpenMo={NOOP}
          onOpenEditor={NOOP}
          onDragStartSession={onDragStartSession}
          onDragEndSession={onDragEndSession}
          onDetachSession={detachSession}
          onDetachToWindow={detachToWindow}
          onReturnSession={returnSession}
          onRevealCwd={revealSessionCwd}
          onOpenEditorFor={openEditorFor}
          dragSourceId={windowId}
          remoteDraggingId={remoteDragId}
          onAdoptSession={adoptSession}
          onReorder={reorderTabs}
          rightActions={rightActions}
        />
        {/* ⚠️ sessions 가 아니라 mySessions — 메인으로 되돌린 세션의 pane 이 숨은 채
            attach 를 붙들면 '한 세션 = 전 창 pane 1개' 불변식이 깨진다. 배정에서 빠지는
            즉시 언마운트돼 TerminalView cleanup 이 detach 를 호출한다. */}
        <TerminalPanes
          sessions={mySessions}
          livePanes={livePanes}
          active
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
              <EmptyState
                icon="terminal"
                message="세션이 없습니다"
                hint="세션이 모두 종료되거나 메인 창으로 돌아가면 이 창은 자동으로 닫힙니다."
              />
            </div>
          )}
        </TerminalPanes>
      </div>
    </div>
  );
}
