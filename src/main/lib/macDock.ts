// macOS 독 자리 계산 — 독 오른쪽 터미널 패널(features/terminal/dock.ts)과 독 왼쪽 폰 제어 창
// (features/mirror/scrcpy.ts)이 함께 쓴다.
// ⚠️ `screen` 은 app ready 전에 부르면 throw 다 — 이 함수들은 ready 뒤(IPC·창 생성)에서만 부를 것.
import { screen } from 'electron';
import type { Display, Rectangle } from 'electron';

/** 독 ↔ 창, 창 ↔ 화면 끝 간격 */
export const DOCK_GAP = 8;
/** 독 띠 안의 위아래 여백 — 띠(아이콘 27 기준 47pt)에 앉히면 창 높이는 41 이 된다 */
export const DOCK_INSET_Y = 3;
/** 이보다 얇은 아래 여백은 독이 아니다 — 자동 숨김 독도 visibleFrame 을 몇 pt 깎는다 */
const DOCK_MIN_STRIP = 24;

export type DockSpot =
  | { kind: 'bottom'; display: Display; strip: Rectangle }
  | { kind: 'floating'; display: Display };

/** 독이 아래에 있는 화면과 그 띠 — 독은 그 화면의 workArea 아래쪽을 깎는다. 없으면(자동 숨김·좌우) floating */
export function findDockSpot(): DockSpot {
  for (const display of screen.getAllDisplays()) {
    const b = display.bounds;
    const w = display.workArea;
    const bottom = b.y + b.height - (w.y + w.height);
    if (bottom >= DOCK_MIN_STRIP)
      return {
        kind: 'bottom',
        display,
        strip: { x: b.x, y: w.y + w.height, width: b.width, height: bottom },
      };
  }
  return { kind: 'floating', display: screen.getPrimaryDisplay() };
}

/**
 * 독 왼쪽 빈자리(띠의 왼쪽 끝) — 폰 제어 칩 자리. 폭을 안 주면 띠 높이와 같은 정사각. 독이 아래에 없으면 null.
 * 독 너비는 보지 않는다(실측은 접근성 권한이 필요하다) — 독이 화면 가득 길면 독 아이콘이 이 창 위에 그려질 뿐이다.
 */
export function dockLeftSlot(width?: number): Rectangle | null {
  const spot = findDockSpot();
  if (spot.kind !== 'bottom') return null;
  const { strip } = spot;
  const height = strip.height - DOCK_INSET_Y * 2;
  return { x: strip.x + DOCK_GAP, y: strip.y + DOCK_INSET_Y, width: width ?? height, height };
}
