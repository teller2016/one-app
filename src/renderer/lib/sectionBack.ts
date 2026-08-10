// 섹션 '내부' 뒤로가기 등록소.
//
// 앱의 뒤로가기(탑바 버튼·⌘[·마우스 뒤로·스와이프)는 원래 **섹션 사이**를 오간다.
// 그런데 섹션 안에 하위 화면이 있으면(결재: 목록 → 각 결재 폼) 뒤로가기가 섹션을 통째로
// 떠나 버려서 "메뉴가 아예 바뀐다"는 인상을 준다. 그래서 하위 화면을 가진 섹션이 여기에
// 핸들러를 등록해 두고, 뒤로가기는 **섹션 내부를 먼저 소비**한 뒤 남으면 섹션 이동으로 넘어간다.
//
// 핸들러는 "내가 처리했다"를 boolean 으로 알린다(true = 섹션 이동하지 말 것).
import { useEffect, useState } from 'react';

let handler: (() => boolean) | null = null;
const listeners = new Set<() => void>();

/** 하위 화면이 열릴 때 등록, 닫힐 때 null. 섹션이 언마운트되면 반드시 해제할 것 */
export function setSectionBack(fn: (() => boolean) | null): void {
  handler = fn;
  for (const l of listeners) l();
}

/** 뒤로가기 소비 시도 — 섹션 내부에서 처리했으면 true */
export function runSectionBack(): boolean {
  return handler ? handler() : false;
}

/** 탑바 뒤로 버튼의 활성 여부에 쓴다 (섹션 내부에 돌아갈 곳이 있는지) */
export function useHasSectionBack(): boolean {
  const [has, setHas] = useState(() => !!handler);
  useEffect(() => {
    const listener = () => setHas(!!handler);
    listeners.add(listener);
    listener(); // 등록 전에 이미 설정됐을 수 있다
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return has;
}
