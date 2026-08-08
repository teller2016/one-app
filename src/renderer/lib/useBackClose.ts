import { useEffect, useRef } from 'react';

/**
 * 뒤로가기로 오버레이 닫기 — **폰(안드로이드) 뒤로가기 버튼이 페이지를 벗어나지 않고
 * 떠 있는 모달만 닫게** 한다. 아무 처리가 없으면 모달을 띄운 채 뒤로가기를 누르는 순간
 * 앱 셸에서 튕겨 나간다(2026-08-08 사용자 지적 — MO 터미널에서 먼저 겪고 공통화).
 *
 * 열릴 때 히스토리 항목을 하나 쌓고, 닫히는 경로에 따라 정리한다:
 * - 뒤로가기로 닫힘 → `popstate` 가 `onClose` 를 부른다(항목은 이미 소비됨)
 * - UI(Escape·오버레이 클릭·버튼)로 닫힘 → 언마운트 때 `history.back()` 으로 되돌린다
 *
 * ⚠️ UI 로 닫을 때 되돌리지 않으면 **유령 항목이 쌓여** 나중에 뒤로가기를 두 번 눌러야
 * 나가게 된다. 중첩 모달은 각자 항목을 쌓으므로 자연히 스택처럼 하나씩 닫힌다.
 *
 * 데스크톱은 마우스 뒤로가기를 `mouseup`(button 3)으로 직접 잡으므로(`App.tsx`)
 * 이 히스토리 항목과 충돌하지 않는다 — 섹션 이동 동작은 그대로다.
 */
export function useBackClose(
  onClose: () => void,
  /** 떠 있는 동안만 true — 조건부 렌더가 아니라 상태로 표시를 제어하는 곳(확인 다이얼로그)용 */
  active = true
): void {
  // onClose 는 렌더마다 새 함수일 수 있다 — effect 를 재실행시키면 항목이 계속 쌓이므로
  // ref 로 최신 값만 참조하고 effect 는 열림/닫힘에만 돈다
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    let popped = false;
    history.pushState({ appOverlay: true }, '');

    const onPop = () => {
      popped = true;
      closeRef.current();
    };
    window.addEventListener('popstate', onPop);

    return () => {
      window.removeEventListener('popstate', onPop);
      if (!popped) history.back();
    };
  }, [active]);
}
