// 독 패널 창 루트 — macOS 독 오른쪽 빈자리에 붙는 작은 터미널(main `features/terminal/dock.ts`).
// 팝아웃(TerminalPopoutApp)의 경량판: 탭바·분할·드래그 없이 **세션 하나만** 그린다.
//
// - 어느 세션을 그리나: main 배정(windows.ts 의 `dock` 항목)의 **마지막** — 가져온 세션(손님)이
//   있으면 그것, 없으면 전용 셸. 정본은 main 이고 여기는 미러만 한다.
// - 접힘/펼침: 포커스만으로는 펼치지 않는다(사용자 결정 — 접힌 채로도 입력한다). ⌘↑ 펼치기 · ⌘↓ 접기,
//   바깥 클릭(포커스 잃음)도 접는다. 창 크기는 main 이 바꾸고 `terminal:dock` 으로 알린다 — 여기는 머리줄·
//   높이 손잡이만 켜고 끈다. 글자는 접힘·펼침이 같다(펼치면 줄 수만 는다).
// - ⚠️ Esc 를 가로채지 않는다 — claude 의 작업 중단 키다.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  TerminalDockState,
  TerminalSessionInfo,
  TerminalWindowInfo,
} from '../../../../shared/types';
import { TERMINAL_DOCK_ID } from '../../../../shared/types';
import { ErrorBoundary } from '../../../components/ErrorBoundary';
import { Icon } from '../../../components/Icon';
import { TextLink } from '../../../components/TextLink';
import { ToastProvider, useToast } from '../../../components/Toast';
import { Tooltip } from '../../../components/Tooltip';
import { errMsg } from '../../../lib/errMsg';
import { useMarkSeen } from '../lib/sessionState';
import { FontSizeControl } from './FontSizeControl';
import { FONT_SIZE_MAX, FONT_SIZE_MIN, TerminalView } from './TerminalView';
import type { TerminalPaneHandle } from './TerminalView';

// 글자 크기 — 접힘·펼침 공용 한 값(사용자 요청: 펼칠 때 글자가 바뀌면 화면이 출렁인다. 높이만 는다).
// 기본 10 = 독 높이(아이콘 27 기준 47pt)에 두 줄이 들어가는 크기 — 11 이상이면 접힌 상태는 한 줄이다.
// 메인 터미널(terminal:fontSize)과 따로 기억한다(화면 취향이라 localStorage 로 충분).
// ⚠️ 키를 옛 `terminal:dock:fontSize`(펼친 상태 전용, 기본 12)로 되돌리지 말 것 — 그 값이 접힌 상태까지 키운다
const FONT_KEY = 'terminal:dock:font';
const FONT_DEFAULT = 10;

function savedFont(): number {
  try {
    const n = Number(localStorage.getItem(FONT_KEY));
    if (Number.isFinite(n) && n >= FONT_SIZE_MIN && n <= FONT_SIZE_MAX) return n;
  } catch {
    // 저장소 접근 실패 — 기본값
  }
  return FONT_DEFAULT;
}

/**
 * 손잡이 드래그 — 창이 손잡이를 따라 움직이므로 창 기준 좌표가 아니라 **화면 좌표**를 보낸다.
 * 끄는 동안은 프레임당 한 번(commit=false), 놓을 때 한 번 더(commit=true — main 이 그때 저장한다).
 */
function useScreenDrag(send: (pt: { x: number; y: number }, commit: boolean) => void) {
  const dragRef = useRef<{ raf: number | null; x: number; y: number } | null>(null);
  const sendRef = useRef(send);
  sendRef.current = send;
  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { raf: null, x: e.screenX, y: e.screenY };
  }, []);
  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    d.x = e.screenX;
    d.y = e.screenY;
    if (d.raf !== null) return; // 창 이동이 pointermove 빈도를 따라가지 않게
    d.raf = requestAnimationFrame(() => {
      d.raf = null;
      sendRef.current({ x: d.x, y: d.y }, false);
    });
  }, []);
  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.raf !== null) cancelAnimationFrame(d.raf);
    dragRef.current = null;
    sendRef.current({ x: e.screenX, y: e.screenY }, true);
  }, []);
  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp };
}

const sendLeft = (pt: { x: number }, commit: boolean) =>
  window.oneApp?.terminal?.dock?.setLeft(pt.x, commit);
const sendTop = (pt: { y: number }, commit: boolean) =>
  window.oneApp?.terminal?.dock?.setTop(pt.y, commit);

const NOOP_FOCUS_PANE = () => {
  /* pane 이 하나뿐 — 포커스 이동할 곳이 없다 (TerminalView memo 를 위해 참조 고정) */
};
const NOOP_SCROLLED = () => {
  /* [맨 아래로] 버튼이 없다 — tmux 세션은 휠이 copy-mode 로 위임된다 */
};

export function mountDockTerminal(container: Element): void {
  createRoot(container).render(
    <ToastProvider>
      <ErrorBoundary label="독 터미널">
        <DockBody />
      </ErrorBoundary>
    </ToastProvider>
  );
}

function DockBody() {
  const toast = useToast();

  // ── 세션 미러 — 제목·작업 중 표시용 (TerminalPopoutApp 과 같은 패턴) ──
  const [sessions, setSessions] = useState<TerminalSessionInfo[]>([]);
  useEffect(() => {
    const api = window.oneApp?.terminal;
    if (!api) return;
    void api.list().then(setSessions);
    return api.onSessions((list) => {
      if (list) setSessions(list);
      else void api.list().then(setSessions);
    });
  }, []);

  // ── 배정 미러 — 독 항목의 세션들(정본은 main windows.ts) ──
  const [dockWin, setDockWin] = useState<TerminalWindowInfo | null>(null);
  useEffect(() => {
    const api = window.oneApp?.terminal?.windows;
    if (!api) return;
    const pick = (wins: TerminalWindowInfo[]) =>
      setDockWin(wins.find((w) => w.id === TERMINAL_DOCK_ID) ?? null);
    void api.list().then(pick);
    return api.onChanged(pick);
  }, []);

  // ── 창 상태 미러 — 펼침·독 맞추기 방식 ──
  const [dock, setDock] = useState<TerminalDockState | null>(null);
  useEffect(() => {
    const api = window.oneApp?.terminal?.dock;
    if (!api) return;
    void api.state().then(setDock);
    return api.onState(setDock);
  }, []);
  const expanded = !!dock?.expanded;

  // ⌘↑ 펼치기 · ⌘↓ 접기 — xterm 은 ⌘+화살표를 셸로 보내지 않고 버리므로(TerminalView ⌘←/→ 주석)
  // 가로채도 잃는 입력이 없다. capture 라 xterm 의 textarea 보다 먼저 받는다
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.isComposing) return;
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      e.stopPropagation();
      window.oneApp?.terminal?.dock?.expand(e.key === 'ArrowUp');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const ids = useMemo(() => dockWin?.sessionIds ?? [], [dockWin]);
  const currentId = ids.length > 0 ? ids[ids.length - 1] : null;
  const current = sessions.find((s) => s.id === currentId) ?? null;
  const isGuest = !!currentId && currentId !== dockWin?.dockShellId;

  // ── pane 핸들 — 펼칠 때 키보드 포커스를 xterm 으로 ──
  const handles = useRef(new Map<string, TerminalPaneHandle>());
  const registerHandle = useCallback((id: string, h: TerminalPaneHandle | null) => {
    if (h) handles.current.set(id, h);
    else handles.current.delete(id);
  }, []);
  const focusPane = useCallback(() => {
    if (currentId) handles.current.get(currentId)?.focus();
  }, [currentId]);
  useEffect(() => {
    if (!expanded) return;
    // 창 포커스가 확정된 뒤에 — 같은 틱에 부르면 클릭이 만드는 포커스 이동에 다시 빼앗긴다
    const raf = requestAnimationFrame(focusPane);
    return () => cancelAnimationFrame(raf);
  }, [expanded, focusPane]);

  // ── 글자 크기 — 접힘·펼침 공용 ──
  const [fontSize, setFontSize] = useState(savedFont);
  const changeFont = useCallback((n: number) => {
    setFontSize(n);
    try {
      localStorage.setItem(FONT_KEY, String(n));
    } catch {
      // 저장 실패 — 이번 실행 동안만 유지
    }
  }, []);

  // ── 화면 세션 보고 — 입력대기 토스트 게이트(main isVisibleInPopout: 창 포커스 = 펼침) ──
  useEffect(() => {
    const ids = currentId ? [currentId] : [];
    const report = () => window.oneApp?.terminal?.windows?.reportVisible(TERMINAL_DOCK_ID, ids);
    report();
    window.addEventListener('focus', report);
    return () => window.removeEventListener('focus', report);
  }, [currentId]);
  // 패널에 포커스가 있으면 '확인함' — 접힌 채로도 입력하므로 펼침이 아니라 포커스가 기준이다
  // (포커스 판정은 훅 안의 useWindowActive. main 의 입력대기 토스트 게이트도 창 포커스다)
  const shownIds = useMemo(() => (currentId ? [currentId] : []), [currentId]);
  useMarkSeen(sessions, shownIds, true);

  // ── 머리줄 동작 ──
  const returnToMain = useCallback(() => {
    if (!currentId) return;
    void (async () => {
      try {
        const res = await window.oneApp?.terminal?.windows?.moveSession(currentId, 'main');
        if (res && !res.ok) toast(res.error || '되돌리지 못했습니다.', 'fail');
      } catch (err) {
        toast(errMsg(err, '되돌리지 못했습니다.'), 'fail');
      }
    })();
  }, [currentId, toast]);
  const hide = useCallback(() => {
    void window.oneApp?.terminal?.dock?.toggle(false);
  }, []);
  const requestAuto = useCallback(() => {
    void (async () => {
      const res = await window.oneApp?.terminal?.dock?.requestAuto();
      if (res && !res.trusted)
        toast('시스템 설정 → 개인정보 보호 및 보안 → 손쉬운 사용에서 One App 을 켜 주세요.', 'info');
    })();
  }, [toast]);

  // ── 손잡이 — 왼쪽 = 수동 경계(독 너비를 실측할 수 없을 때만) · 위쪽 = 펼친 높이(펼쳤을 때만) ──
  const leftGrip = useScreenDrag(sendLeft);
  const topGrip = useScreenDrag(sendTop);

  const busy = !!current && (current.working || current.status === 'busy');

  return (
    <div className={`dock-term${expanded ? ' dock-term--expanded' : ''}`}>
      {dock?.fit === 'manual' && (
        <div
          className="dock-term__grip"
          role="separator"
          aria-orientation="vertical"
          aria-label="독 터미널 왼쪽 경계 조절"
          {...leftGrip}
        />
      )}
      {expanded && (
        <div
          className="dock-term__grip dock-term__grip--top"
          role="separator"
          aria-orientation="horizontal"
          aria-label="펼친 높이 조절"
          {...topGrip}
        />
      )}
      {expanded && (
        <div className="dock-term__head">
          <Icon name="terminal" size={12} />
          <span className="dock-term__title">
            {isGuest && current ? current.title : '독 터미널'}
          </span>
          {isGuest && <span className="dock-term__meta">메인 창에서 가져옴</span>}
          <span className="dock-term__space" />
          <span className="dock-term__meta">⌘↓ 접기</span>
          {dock?.fit === 'manual' && dock.axTrusted === false && (
            <Tooltip label="접근성 권한을 주면 독 길이가 바뀔 때 패널이 따라 움직입니다">
              <TextLink small onClick={requestAuto}>
                독 너비 자동
              </TextLink>
            </Tooltip>
          )}
          <FontSizeControl fontSize={fontSize} onChange={changeFont} onEscape={focusPane} />
          {isGuest && (
            <Tooltip label="메인 창으로 되돌리기">
              <button
                type="button"
                className="icon-btn"
                aria-label="메인 창으로 되돌리기"
                onClick={returnToMain}
              >
                <Icon name="corner-up-left" size={14} />
              </button>
            </Tooltip>
          )}
          <Tooltip label="숨기기 (세션은 그대로 남습니다)">
            <button type="button" className="icon-btn" aria-label="독 터미널 숨기기" onClick={hide}>
              <Icon name="x" size={14} />
            </button>
          </Tooltip>
        </div>
      )}
      <div className="dock-term__body">
        {currentId && (
          <TerminalView
            key={currentId}
            sessionId={currentId}
            visible
            focused
            onFocusPane={NOOP_FOCUS_PANE}
            fontSize={fontSize}
            onRegisterHandle={registerHandle}
            onScrolledChange={NOOP_SCROLLED}
            busy={busy}
          />
        )}
      </div>
    </div>
  );
}
