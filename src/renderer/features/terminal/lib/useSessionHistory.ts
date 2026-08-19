// 터미널 섹션 '내부' 방문 히스토리 — 세션·워크트리 전환을 뒤로/앞으로로 오간다.
//
// 앱의 히스토리 이동(⌘[ ⌘] · 마우스 뒤로/앞으로 · 스와이프 · 탑바 버튼)은 원래 **섹션 사이**를
// 오간다. 그런데 터미널에서 여러 세션을 오가며 작업할 땐 다른 메뉴가 아니라 **직전에 보던
// 세션**으로 돌아가고 싶다(2026-08-19 사용자 요청). 그래서 `lib/sectionBack` 등록소에
// 핸들러를 걸어 섹션 이동보다 **먼저** 소비한다 — 결재 섹션(목록 ↔ 폼)과 같은 방식이다.
//
// ⚠️ **섹션을 떠나면 스택을 비운다.** 안 비우면 앱을 쓰는 내내 쌓여서, 터미널 밖으로 나가려면
//    그동안 오간 세션 수만큼 뒤로가기를 눌러야 한다. 비워 두면 터미널에 머무는 동안은 세션
//    히스토리를, 갓 들어왔을 땐 곧장 이전 섹션으로 나가는 동작을 둘 다 얻는다.
// ⚠️ 기록은 **사용자가 의도한 전환만** — 탭 클릭·⌘1~9·⌃Tab·LNB 워크트리 선택.
//    죽은 세션 보정·새 세션 자동 활성화·Jira [작업] 진입·분할 pane 포커스 이동은 기록하지
//    않는다(화면이 안 바뀌거나 사용자가 '이동'으로 인식하지 않는 전환이라 노이즈가 된다).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TerminalSessionInfo } from '../../../../shared/types';
import {
  clearSectionBack,
  clearSectionForward,
  setSectionBack,
  setSectionForward,
} from '../../../lib/sectionBack';
import { sameSelection, selectionKey } from './workspace';
import type { WorkspaceSelection } from './workspace';

/** 스택 상한 — 섹션을 떠날 때 어차피 비워지므로 폭주 방지용 안전장치다 */
const MAX_HISTORY = 30;

/** 방문 한 건 — 세션만으론 부족하다(다른 워크트리 세션이면 선택도 같이 돌려놔야 보인다) */
type Visit = { selection: WorkspaceSelection | null; sessionId: string | null };

type Args = {
  /** keep-alive 로 숨은 동안(false)은 등록을 걷고 스택을 비운다 */
  active: boolean;
  selection: WorkspaceSelection | null;
  activeId: string | null;
  sessions: TerminalSessionInfo[];
  /** 워크트리 선택 이동 — TerminalSection 의 selectAndSave(영속화 포함) */
  selectWorkspace: (sel: WorkspaceSelection | null) => void;
  setActiveId: (id: string) => void;
  rememberActive: (key: string, id: string) => void;
};

export function useSessionHistory({
  active,
  selection,
  activeId,
  sessions,
  selectWorkspace,
  setActiveId,
  rememberActive,
}: Args): { recordVisit: () => void } {
  // 최신값 ref — 콜백 참조를 고정해야 sectionBack 등록/해제가 identity 로 짝이 맞는다
  const stateRef = useRef({ selection, activeId, sessions });
  stateRef.current = { selection, activeId, sessions };

  const backRef = useRef<Visit[]>([]);
  const fwdRef = useRef<Visit[]>([]);
  // 깊이는 state 로도 들고 있어야 한다 — 스택이 비고 차는 것을 등록/해제로 반영해야
  // 탑바 뒤로/앞으로 버튼의 활성 상태가 따라온다
  const [depth, setDepth] = useState({ back: 0, fwd: 0 });
  const syncDepth = useCallback(() => {
    setDepth((cur) =>
      cur.back === backRef.current.length && cur.fwd === fwdRef.current.length
        ? cur
        : { back: backRef.current.length, fwd: fwdRef.current.length }
    );
  }, []);

  /** 지금 보고 있는 화면 */
  const here = useCallback(
    (): Visit => ({
      selection: stateRef.current.selection,
      sessionId: stateRef.current.activeId,
    }),
    []
  );

  /** 사용자가 의도한 전환 **직전에** 부른다 — 지금 화면을 뒤로 스택에 남긴다 */
  const recordVisit = useCallback(() => {
    const cur = here();
    if (!cur.sessionId && !cur.selection) return; // 아직 아무것도 안 보고 있다
    backRef.current.push(cur);
    if (backRef.current.length > MAX_HISTORY) backRef.current.shift();
    fwdRef.current = []; // 새 분기로 이동하면 앞으로 히스토리는 무효
    syncDepth();
  }, [here, syncDepth]);

  const restore = useCallback(
    (v: Visit) => {
      if (!sameSelection(v.selection, stateRef.current.selection))
        selectWorkspace(v.selection);
      if (!v.sessionId) return;
      // 선택을 옮기면 TerminalSection 의 '활성 세션 보정' effect 가 그 화면에서 마지막에
      // 보던 탭을 고른다 — 같은 값을 미리 심어 둬야 복원한 세션이 곧바로 덮어써지지 않는다
      rememberActive(selectionKey(v.selection), v.sessionId);
      setActiveId(v.sessionId);
    },
    [rememberActive, selectWorkspace, setActiveId]
  );

  /** 한 칸 이동 — from 에서 꺼내 to 에 지금 화면을 남긴다. 처리했으면 true */
  const step = useCallback(
    (from: Visit[], to: Visit[]): boolean => {
      // 그새 종료된 세션은 건너뛴다 (워크트리만 담긴 항목은 세션 없이도 유효)
      let target: Visit | null = null;
      while (from.length > 0) {
        const v = from.pop() as Visit;
        if (!v.sessionId || stateRef.current.sessions.some((s) => s.id === v.sessionId)) {
          target = v;
          break;
        }
      }
      if (!target) {
        syncDepth(); // 전부 죽어 비었을 수 있다 — 버튼 상태를 맞춘다
        return false; // 섹션 이동으로 넘긴다
      }
      to.push(here());
      restore(target);
      syncDepth();
      return true;
    },
    [here, restore, syncDepth]
  );

  const goBack = useCallback(() => step(backRef.current, fwdRef.current), [step]);
  const goForward = useCallback(() => step(fwdRef.current, backRef.current), [step]);

  useEffect(() => {
    if (!active) {
      // 섹션을 떠났다 — 비워 두면 다음에 들어와 누르는 뒤로가기는 곧장 이전 섹션으로 나간다
      if (backRef.current.length > 0 || fwdRef.current.length > 0) {
        backRef.current = [];
        fwdRef.current = [];
        syncDepth();
      }
      return;
    }
    // 스택이 빈 방향은 등록하지 않는다 — 그래야 App 의 섹션 이동으로 넘어간다
    if (depth.back > 0) setSectionBack(goBack);
    if (depth.fwd > 0) setSectionForward(goForward);
    return () => {
      clearSectionBack(goBack);
      clearSectionForward(goForward);
    };
  }, [active, depth, goBack, goForward, syncDepth]);

  return { recordVisit };
}
