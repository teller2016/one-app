// pane 오케스트레이션 — 살아 있는 pane(LRU)·글자 크기·pane 핸들 레지스트리·포커스 안전망·
// 스크롤 상태를 한 훅으로. 메인 창(TerminalSection)과 팝아웃 창(TerminalPopoutApp)이
// 같은 규칙으로 pane 들을 다루도록 TerminalSection 에서 떼어냈다.
// ⚠️ 반환하는 콜백은 전부 참조가 고정돼야 한다 — pane(TerminalView)·탭바가 memo 다.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, MutableRefObject } from 'react';
import {
  FONT_SIZE_DEFAULT,
  FONT_SIZE_KEY,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
} from '../components/TerminalView';
import type { TerminalPaneHandle } from '../components/TerminalView';

/**
 * 동시에 살려 두는 xterm pane 수 상한 (최근 사용 순).
 *
 * 세션은 그대로 두고 **화면(pane)만** 재활용한다 — 버려진 pane 은 다시 고르는 순간
 * attach 로 복원되므로(tmux 가 전체 화면을 다시 그린다) 잃는 것은 xterm 쪽 스크롤백·
 * 선택 영역뿐이다. 상한이 필요한 이유는 WebGL 컨텍스트가 **브라우저 전역으로 개수 제한**이
 * 있어서, 넘기면 오래된 컨텍스트가 강제 유실되며 이미 열린 터미널이 깨지기 때문이다.
 * (제한은 렌더러 프로세스 단위 — 창이 다르면 예산도 따로 간다)
 */
const MAX_LIVE_PANES = 8;

// 터미널 글자 크기 — 세션 pane 이 여러 개 살아 있으므로 값은 여기 한 곳에서만 들고
// 모든 pane 에 내려준다 (화면 취향이라 localStorage 로 충분 — 보존 대상 아님)
function savedFontSize(): number {
  const n = Number(localStorage.getItem(FONT_SIZE_KEY));
  return Number.isFinite(n) && n >= FONT_SIZE_MIN && n <= FONT_SIZE_MAX
    ? n
    : FONT_SIZE_DEFAULT;
}

export function usePaneOrchestration({
  activeId,
  activeGroupIds,
  activeIdRef,
  rootRef,
  excludeIds,
}: {
  activeId: string | null;
  /** 보고 있는 분할 그룹의 세션 id 들 (단일 뷰면 null) — useSplitGroups 의 것 */
  activeGroupIds: string[] | null;
  /** 최신값 ref — 콜백 참조 고정용 (TerminalSection 의 activeIdRef 패턴 그대로) */
  activeIdRef: MutableRefObject<string | null>;
  /** 섹션/창 루트 — 포커스 안전망의 실제 DOM 포함 판정에 쓴다 */
  rootRef: MutableRefObject<HTMLDivElement | null>;
  /**
   * pane 을 만들지 않을 세션들 — 다른 창으로 분리된 세션은 그 창이 유일한 pane 을
   * 가져야 한다("한 세션 = 전 창 통틀어 pane 1개" 불변식). ⚠️ 참조가 안정적일 것(useMemo).
   */
  excludeIds?: ReadonlySet<string>;
}) {
  // ── 살아 있는 pane — **실제로 본 적 있는 세션만** xterm 을 만든다 ──
  // 예전엔 sessions 전부를 마운트해서 터미널 섹션에 들어가는 순간 세션 수만큼
  // xterm·WebGL 컨텍스트·attach(tmux 클라이언트 spawn)가 한꺼번에 생겼다.
  // 지금은 화면의 세션(분할이면 레이아웃 전체, 아니면 활성 하나)만 붙이고, 한 번 연
  // pane 은 상한(MAX_LIVE_PANES)까지 유지해 전환 즉시성과 스크롤백·검색 상태를 지킨다.
  const [livePanes, setLivePanes] = useState<string[]>([]); // 화면 세션들 + 최근 사용 순
  useEffect(() => {
    const screen = activeGroupIds ?? (activeId ? [activeId] : []);
    const shown = excludeIds ? screen.filter((id) => !excludeIds.has(id)) : screen;
    // 화면 세션이 없으면 기존 pane 들을 그대로 둔다 — 단 분리 세션 정리는 해야 하므로
    // excludeIds 가 있을 때는 아래 updater 가 그 몫(kept 필터)까지 처리한다
    if (shown.length === 0 && !excludeIds?.size) return;
    setLivePanes((cur) => {
      const kept = excludeIds ? cur.filter((id) => !excludeIds.has(id)) : cur;
      // LRU 축출은 **화면 밖 세션만** 잘라낸다 — 보이는 pane 을 버리면 그 자리가 빈다
      const rest = kept.filter((id) => !shown.includes(id));
      const next = [
        ...shown,
        ...rest.slice(0, Math.max(0, MAX_LIVE_PANES - shown.length)),
      ];
      return next.length === cur.length && next.every((id, i) => id === cur[i])
        ? cur
        : next;
    });
  }, [activeId, activeGroupIds, excludeIds]);

  const [fontSize, setFontSize] = useState(savedFontSize);
  const changeFontSize = useCallback((n: number) => {
    localStorage.setItem(FONT_SIZE_KEY, String(n));
    setFontSize(n);
  }, []);

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
  }, [activeIdRef]);
  const scrollActiveToBottom = useCallback(() => {
    if (activeIdRef.current)
      paneHandles.current.get(activeIdRef.current)?.scrollToBottom();
  }, [activeIdRef]);

  // ── 포커스 안전망 — 섹션 안을 클릭했으면 키보드 포커스를 pane 으로 되돌린다 ────────
  // ⌘C/⌘V 는 이 앱이 처리하지 않는다 — Electron 기본 메뉴의 role:copy/paste 라
  // **포커스된 편집 요소**에만 작동하고, xterm 은 클립보드 리스너를 자기 element·textarea
  // 에만 건다. 그래서 탭·툴바 버튼이 포커스를 쥐고 있으면 복사·붙여넣기가 조용히
  // 무반응이 된다(2026-08-13 '가끔 안 된다'의 정체 — 이미지 붙여넣기 위임도 함께 죽는다).
  // pane 의 포커스 복원 effect 는 `focused` 값이 **바뀔 때만** 도므로, 같은 탭을 다시
  // 누르는 것처럼 값이 그대로인 경로에서는 포커스가 영영 돌아오지 않았다.
  const reclaimFocus = useCallback(
    (e: ReactMouseEvent) => {
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
    },
    [activeIdRef, rootRef]
  );

  // 스크롤백을 위로 올린 pane — 상단 바 [맨 아래로] 노출 판정.
  // tmux 세션은 xterm 이 아니라 tmux copy-mode 가 스크롤 상태의 주인이라, pane 이
  // 휠 위임 응답(scrolledUp)으로 올려 준다(TerminalView 의 '휠 스크롤' 절).
  const [scrolledUp, setScrolledUp] = useState<Record<string, boolean>>({});
  const onScrolledChange = useCallback((id: string, v: boolean) => {
    setScrolledUp((cur) => (!!cur[id] === v ? cur : { ...cur, [id]: v }));
  }, []);

  return {
    livePanes,
    fontSize,
    changeFontSize,
    registerPaneHandle,
    openActiveSearch,
    scrollActiveToBottom,
    reclaimFocus,
    scrolledUp,
    onScrolledChange,
  };
}
