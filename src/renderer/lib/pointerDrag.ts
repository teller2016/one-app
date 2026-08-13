// 그립(경계 손잡이) 드래그 공통 처리.
//
// 포인터로 경계를 끄는 UI 가 넷이고(앱 사이드바 · 터미널 세션 패널 · 터미널 분할 경계 ·
// 변경사항 드로어) 전부 같은 규칙을 쓴다: 포인터 캡처 → body 커서·선택 잠금 →
// window 리스너 등록 → 놓는 순간 1회 저장 → 리스너·커서 원복.
//
// 각자 구현하던 때는 조용히 갈라졌다 — 앱 사이드바에는 포인터 캡처가 없었고, 반올림은
// 네 곳 중 두 곳에만 있었다(2026-08-13 정리에서 확인).
import type { PointerEvent as ReactPointerEvent } from 'react';

export type PointerDragOptions = {
  /** 드래그 중 커서 — 세로 경계는 `col-resize`, 가로 경계는 `row-resize` */
  cursor: 'col-resize' | 'row-resize';
  /** 포인터가 움직일 때마다 — 여기서 폭·비율 상태를 갱신한다 */
  onMove: (ev: PointerEvent) => void;
  /** 놓는 순간 1회 — localStorage 저장은 여기서(프레임마다 쓰지 않는다) */
  onEnd?: () => void;
};

/**
 * 그립 `onPointerDown` 에서 부른다. `e.preventDefault()` 는 호출부가 먼저 한다 —
 * 시작 조건을 따져 보고 그만두는 그립(분할 경계)이 있어서다.
 *
 * ⚠️ 저장하는 값은 호출부에서 **`Math.round`** 로 반올림할 것 — devicePixelRatio 탓에
 * 포인터 좌표가 소수로 와서 `334.5` 같은 값이 localStorage 에 남는다.
 */
export function beginPointerDrag(
  e: ReactPointerEvent<HTMLElement>,
  { cursor, onMove, onEnd }: PointerDragOptions
): void {
  // ⚠️ 포인터 캡처가 없으면 창 밖에서 버튼을 놓았을 때 pointerup 을 못 받아
  // body 의 커서와 window 리스너가 그대로 남는다.
  // ⚠️ 다만 **던져도 드래그는 계속돼야 한다** — 이미 놓인 포인터 id 면 브라우저가
  // NotFoundError 를 던지는데, 그게 위로 새면 호출부가 드래그 시작 직전에 세워 둔
  // 플래그(예: 분할 그립의 layoutDraggingRef)가 되돌려지지 않은 채 갇힌다. 실제 이동
  // 처리는 아래 window 리스너가 하므로 캡처는 최선 노력이면 충분하다.
  try {
    e.currentTarget.setPointerCapture(e.pointerId);
  } catch {
    // 캡처 불가 — 창 밖에서 놓으면 놓친다는 점만 감수하고 그대로 진행
  }
  document.body.style.cursor = cursor;
  document.body.style.userSelect = 'none';
  const move = (ev: PointerEvent) => onMove(ev);
  const up = () => {
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    onEnd?.();
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
