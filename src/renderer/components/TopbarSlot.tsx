import { useLayoutEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** 앱 탑바 안의 섹션 전용 자리 — App.tsx 의 `.topbar__slot` 이 이 id 를 갖는다 */
export const TOPBAR_SLOT_ID = 'topbar-slot';

/**
 * 섹션 컨트롤(화면 전환 세그먼트·액션 버튼)을 앱 탑바 안에 그린다 — 목업(2026-09-30 리디자인)은
 * 경로 표시 옆에 섹션 세그먼트, 오른쪽 끝에 섹션 액션이 온다.
 *
 * `left` 는 경로 바로 옆, `right` 는 오른쪽 끝. 탑바가 없는 셸(폰 MO 셸 등)에서는 제자리에 그린다 —
 * 슬롯이 없다고 컨트롤이 사라지면 안 된다.
 * ⚠️ 슬롯은 부모(App)가 커밋된 뒤에야 DOM 에 있으므로 첫 렌더에선 찾지 않고 layout effect 로 찾는다.
 */
export function TopbarSlot({ left, right }: { left?: ReactNode; right?: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [checked, setChecked] = useState(false);
  useLayoutEffect(() => {
    setSlot(document.getElementById(TOPBAR_SLOT_ID));
    setChecked(true);
  }, []);

  const content = (
    <>
      {left && <div className="topbar__slot-left">{left}</div>}
      <div className="topbar__slot-gap" />
      {right && <div className="topbar__slot-right">{right}</div>}
    </>
  );
  if (!checked) return null;
  if (!slot) return <div className="topbar-inline">{content}</div>;
  return createPortal(content, slot);
}
