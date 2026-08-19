// 섹션 '내부' 뒤로/앞으로 등록소.
//
// 앱의 히스토리 이동(탑바 버튼·⌘[ ⌘]·마우스 뒤로/앞으로·스와이프)은 원래 **섹션 사이**를
// 오간다. 그런데 섹션 안에 자체 이동이 있으면(결재: 목록 → 각 결재 폼 / 터미널: 세션·워크트리
// 전환) 뒤로가기가 섹션을 통째로 떠나 버려서 "메뉴가 아예 바뀐다"는 인상을 준다. 그래서
// 그런 섹션이 여기에 핸들러를 등록해 두고, 히스토리 이동은 **섹션 내부를 먼저 소비**한 뒤
// 남으면 섹션 이동으로 넘어간다.
//
// 핸들러는 "내가 처리했다"를 boolean 으로 알린다(true = 섹션 이동하지 말 것).
import { useEffect, useRef, useState } from 'react';

type SectionNav = () => boolean;

let backHandler: SectionNav | null = null;
let fwdHandler: SectionNav | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

/** 하위 화면이 열릴 때 등록, 닫힐 때 null. 섹션이 언마운트되면 반드시 해제할 것 */
export function setSectionBack(fn: SectionNav | null): void {
  backHandler = fn;
  notify();
}

/** 뒤로 간 자리를 되돌릴 수 있을 때 등록 (섹션 내부에 앞으로 히스토리가 있는 경우) */
export function setSectionForward(fn: SectionNav | null): void {
  fwdHandler = fn;
  notify();
}

// ⚠️ 해제는 **내가 건 핸들러일 때만** — 터미널처럼 keep-alive 로 숨는 섹션은 숨은 뒤에도
// effect cleanup 이 돌 수 있는데, 그때 이미 다른 섹션이 등록했다면 남의 것을 지워 버린다.
/** 내가 등록한 뒤로가기 핸들러 해제 */
export function clearSectionBack(fn: SectionNav): void {
  if (backHandler === fn) setSectionBack(null);
}

/** 내가 등록한 앞으로가기 핸들러 해제 */
export function clearSectionForward(fn: SectionNav): void {
  if (fwdHandler === fn) setSectionForward(null);
}

/** 뒤로가기 소비 시도 — 섹션 내부에서 처리했으면 true */
export function runSectionBack(): boolean {
  return backHandler ? backHandler() : false;
}

/** 앞으로가기 소비 시도 — 섹션 내부에서 처리했으면 true */
export function runSectionForward(): boolean {
  return fwdHandler ? fwdHandler() : false;
}

/** 등록 여부 구독 — 탑바 버튼의 활성 판정에 쓴다 */
function useHandlerPresence(read: () => boolean): boolean {
  const [has, setHas] = useState(read);
  const readRef = useRef(read);
  readRef.current = read;
  useEffect(() => {
    const listener = () => setHas(readRef.current());
    listeners.add(listener);
    listener(); // 등록 전에 이미 설정됐을 수 있다
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return has;
}

/** 탑바 뒤로 버튼의 활성 여부에 쓴다 (섹션 내부에 돌아갈 곳이 있는지) */
export function useHasSectionBack(): boolean {
  return useHandlerPresence(() => !!backHandler);
}

/** 탑바 앞으로 버튼의 활성 여부에 쓴다 (섹션 내부에 되돌아갈 곳이 있는지) */
export function useHasSectionForward(): boolean {
  return useHandlerPresence(() => !!fwdHandler);
}
