import { useEffect, useRef } from 'react';

/**
 * UI 로 닫으며 부른 `history.back()` 이 만들 popstate 를 **한 번 무시**하라는 표시.
 * 오버레이를 닫자마자 다른 오버레이(확인창·다른 시트)를 열면, 앞의 back() 이 비동기로 낸 popstate 가
 * 새 오버레이에 도착해 그것을 곧바로 닫았다 — 폰에서 [세션 종료] 확인창이 뜨자마자 사라졌다(2026-10-01 /test).
 */
const pendingBacks: number[] = []; // 각 back() 의 만료 시각 — popstate 가 끝내 안 오면(첫 항목 등) 다음 진짜 뒤로가기를 막지 않게
const PENDING_TTL_MS = 1000;
let suppress = false;
/**
 * UI 로 닫은 오버레이의 `history.back()` 은 **잠깐 미룬다** — 그 사이 다른 오버레이가 열리면(메뉴 → 확인창,
 * 새 세션 시트 → 작업 영역 시트) back 을 취소하고 **그 항목을 물려준다**. 바로 back() 하고 새 항목을 push 하면
 * 둘이 엇갈려 새 오버레이의 항목이 사라지고, 그것을 닫는 순간 앱 밖으로 나갔다(2026-10-01 /test).
 */
const HANDOFF_MS = 50;
let handoff: ReturnType<typeof setTimeout> | null = null;
if (typeof window !== 'undefined') {
  // 모듈 로드 때 먼저 등록되므로 각 오버레이의 리스너보다 앞서 돈다 — 이 이벤트 동안만 suppress
  window.addEventListener('popstate', () => {
    const now = Date.now();
    while (pendingBacks.length && pendingBacks[0] < now) pendingBacks.shift();
    if (!pendingBacks.length) return;
    pendingBacks.shift();
    suppress = true;
    setTimeout(() => (suppress = false), 0);
  });
}

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
 * ⚠️ 데스크톱에서는 아무 일도 하지 않는다 — `html.mo` 가 있을 때만 동작한다.
 *    데스크톱에서 항목을 쌓으면 마우스 X1/X2 의 기본 앞/뒤와 겹쳐 섹션 이동이 뒤엉킨다.
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
    // ⚠️ **폰에서만** 히스토리를 건드린다(`html.mo` — 앱 셸이 붙인다).
    // 데스크톱은 뒤로가기 버튼이 없어 이 기능이 필요 없는데, 여기서 항목을 쌓으면
    // 마우스 X1/X2 의 Electron 기본 앞/뒤 동작과 겹쳐 섹션 이동이 뒤엉킨다
    // (2026-08-08 사용자 지적: "앞으로 가기하면 뒤로 간다").
    // 데스크톱 모달은 Escape·오버레이 클릭으로 닫으면 된다.
    if (!document.documentElement.classList.contains('mo')) return;

    let popped = false;
    if (handoff) {
      // 방금 닫힌 오버레이의 항목을 그대로 쓴다 — back 도 push 도 하지 않는다
      clearTimeout(handoff);
      handoff = null;
    } else {
      history.pushState({ appOverlay: true }, '');
    }

    const onPop = () => {
      if (suppress) return; // 다른 오버레이를 UI 로 닫으며 부른 back() — 이 오버레이 몫이 아니다
      popped = true;
      closeRef.current();
    };
    window.addEventListener('popstate', onPop);

    return () => {
      window.removeEventListener('popstate', onPop);
      if (!popped) {
        // 둘이 연달아 닫히면 각자 한 칸씩 — 앞에서 미뤄 둔 것은 지금 되돌린다
        if (handoff) {
          clearTimeout(handoff);
          pendingBacks.push(Date.now() + PENDING_TTL_MS);
          history.back();
        }
        handoff = setTimeout(() => {
          handoff = null;
          pendingBacks.push(Date.now() + PENDING_TTL_MS);
          history.back();
        }, HANDOFF_MS);
      }
    };
  }, [active]);
}
