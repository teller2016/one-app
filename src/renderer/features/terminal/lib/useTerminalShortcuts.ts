// 세션 단축키 — ⌘T 새 세션 · ⌘1..9 탭 전환 · ⌃Tab 순환 · ⌘⇧W 종료 · ⌘B 변경사항 드로어.
// 메인 창(TerminalSection)과 팝아웃 창(TerminalPopoutApp)이 같은 키 규약을 쓰도록
// TerminalSection 에서 떼어냈다 — 팝아웃엔 없는 동작(⌘T·⌘B)은 콜백을 비워 잡지 않는다.
//
// ⚠️ capture 단계 + stopPropagation 으로 잡는다 — bubble 로 잡으면 xterm 의 textarea
// 핸들러가 먼저 처리해 같은 키가 셸에도 전달된다(⌃Tab 이 특히 그렇다).
// ⚠️ ⌘W(창 닫기)·⌘+/-(전체 UI 줌)는 Electron 기본 메뉴가 선점하므로 쓰지 않는다.
// ⚠️ 리스너는 `active` 가 바뀔 때만 다시 건다 — deps 에 tabs·activeSession 을 넣으면
// 세션 상태 브로드캐스트(초 단위)마다 걷었다 다시 달게 된다. 최신 클로저는 ref 로 넘긴다.
import { useEffect, useRef } from 'react';
import type { TerminalSessionInfo } from '../../../../shared/types';

export type TerminalShortcutConfig = {
  /** 순회(⌃Tab)·번호(⌘1..9)의 대상 — 평탄화된 **표시 순서**(tabView.tabs) */
  tabs: TerminalSessionInfo[];
  activeId: string | null;
  /** ⌘⇧W 의 대상 — 없으면(빈 화면) 잡지 않는다 */
  activeSession: TerminalSessionInfo | null;
  selectTab: (id: string) => void;
  closeSession: (s: TerminalSessionInfo) => unknown;
  /** ⌘T — createShell 이 없으면(팝아웃: 생성 경로 없음) 키를 잡지 않는다 */
  canCreate?: boolean;
  createShell?: () => unknown;
  /** ⌘B — 없으면(팝아웃: 드로어 없음) 키를 잡지 않는다 */
  toggleChanges?: () => void;
};

export function useTerminalShortcuts(
  active: boolean,
  config: TerminalShortcutConfig
): void {
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  });

  useEffect(() => {
    // keep-alive 로 숨은 동안은 바인딩 자체를 걷는다 — 안 걷으면 다른 섹션에서 누른
    // ⌘T·⌘⇧W 가 보이지 않는 터미널의 세션을 만들고 죽인다
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const cfg = configRef.current;
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
      const tabs = cfg.tabs;
      if (e.ctrlKey && !e.metaKey && e.key === 'Tab') {
        if (tabs.length < 2) return;
        claim();
        const cur = tabs.findIndex((s) => s.id === cfg.activeId);
        const next = (cur + (e.shiftKey ? -1 : 1) + tabs.length) % tabs.length;
        cfg.selectTab(tabs[next].id);
        return;
      }
      if (!e.metaKey || e.altKey || e.ctrlKey) return;
      if (e.shiftKey) {
        if (e.key.toLowerCase() === 'w' && cfg.activeSession) {
          claim();
          void cfg.closeSession(cfg.activeSession);
        }
        return;
      }
      if (e.key === 't') {
        if (!cfg.canCreate || !cfg.createShell) return;
        claim();
        void cfg.createShell(); // 모달 없이 바로 셸 — 에이전트 선택은 [+] 또는 프리셋 바
      } else if (e.key.toLowerCase() === 'b') {
        if (!cfg.toggleChanges) return;
        claim();
        cfg.toggleChanges(); // 변경사항 드로어 열고 닫기 — 탑바 git 버튼과 같은 동작
      } else if (e.key >= '1' && e.key <= '9') {
        const target = tabs[Number(e.key) - 1];
        if (!target) return;
        claim();
        cfg.selectTab(target.id);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active]);
}
