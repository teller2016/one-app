// 섹션 '사이' 이동 + 터미널 세션 포커스 요청 브리지.
//
// 다른 섹션에서 시작한 일이 터미널에서 이어질 때 쓴다(Jira [작업] → femc 세션).
// App 이 라우팅을, TerminalSection 이 세션 선택을 각각 쥐고 있어 둘을 잇는 통로가 필요한데,
// 그 하나 때문에 전역 상태를 세우는 것은 과하다 — `sectionBack.ts` 와 같은 얇은 등록소다.
//
// ⚠️ 포커스 요청은 **먼저 도착하고 수신자는 나중에 마운트된다**(섹션 이동 → TerminalSection
// 마운트 순서). 그래서 요청을 담아 두고 구독 시점에 소비한다.
import { useEffect } from 'react';

/** 터미널에서 열어야 할 세션 — cwd 는 그 세션이 속한 워크트리를 고르는 데 쓴다 */
export type TerminalFocusRequest = { sessionId: string; cwd: string };

let navigator: ((sectionId: string) => void) | null = null;
let pending: TerminalFocusRequest | null = null;
const focusListeners = new Set<(req: TerminalFocusRequest) => void>();

/** App 이 마운트되며 등록한다 (언마운트 시 null) */
export function setSectionNavigator(fn: ((id: string) => void) | null): void {
  navigator = fn;
}

/** 섹션 전환 — 등록 전이면 조용히 무시된다(앱 셸이 없는 화면에서 호출될 수 있다) */
export function navigateSection(sectionId: string): void {
  navigator?.(sectionId);
}

/** 터미널 섹션으로 이동하며 그 세션을 열어 달라고 요청한다 */
export function openTerminalSession(req: TerminalFocusRequest): void {
  pending = req;
  navigateSection('terminal');
  for (const l of focusListeners) l(req);
}

// ── 화면 표시 중인 세션 판정 — 입력대기 토스트 억제용 ──
// TerminalSection 이 등록하고, App 의 토스트 브리지가 "이미 그 세션을 보고 있으면
// 이동 토스트를 생략"하는 데 쓴다. 미등록(터미널 미방문)이면 항상 false.
let visibleCheck: ((sessionId: string) => boolean) | null = null;

/** TerminalSection 이 마운트되며 등록한다 (언마운트 시 null) */
export function setSessionVisibilityCheck(
  fn: ((sessionId: string) => boolean) | null,
): void {
  visibleCheck = fn;
}

/** 그 세션이 지금 화면(활성 터미널 섹션의 보이는 pane)에 있는가 */
export function isSessionOnScreen(sessionId: string): boolean {
  return visibleCheck?.(sessionId) ?? false;
}

/**
 * 터미널 섹션이 포커스 요청을 받는다.
 * ⚠️ `handler` 는 `useCallback` 으로 안정화해서 넘길 것 — 렌더마다 새 함수를 주면
 * 구독이 매번 재등록되며 대기 중인 요청을 반복 소비한다.
 */
export function useTerminalFocusRequest(
  handler: (req: TerminalFocusRequest) => void,
): void {
  useEffect(() => {
    // 마운트 전에 들어온 요청 소비 (섹션 이동이 먼저 일어난다)
    if (pending) {
      const req = pending;
      pending = null;
      handler(req);
    }
    const listener = (req: TerminalFocusRequest) => {
      pending = null;
      handler(req);
    };
    focusListeners.add(listener);
    return () => {
      focusListeners.delete(listener);
    };
  }, [handler]);
}
