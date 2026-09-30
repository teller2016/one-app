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
/**
 * 앱 탑바 슬롯이 있는 셸인지 — 없으면(One App Lite·폰 셸) 섹션이 자기 머리(제목·뒤로가기)를 그려야 한다.
 * 첫 렌더에선 null(아직 모름) — TopbarSlot 과 같은 이유로 layout effect 에서 판정한다.
 */
export function useHasTopbar(): boolean | null {
  const [has, setHas] = useState<boolean | null>(null);
  useLayoutEffect(() => {
    setHas(!!document.getElementById(TOPBAR_SLOT_ID));
  }, []);
  return has;
}

export function TopbarSlot({
  crumb,
  left,
  right,
}: {
  /** 경로의 셋째 칸 — 섹션 안 하위 화면(예: '프로젝트 편집', '휴가신청서'). 탑바가 없는 셸에선 그리지 않는다
   *  (그 셸은 섹션이 자기 제목을 그린다) */
  crumb?: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
}) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [checked, setChecked] = useState(false);
  useLayoutEffect(() => {
    setSlot(document.getElementById(TOPBAR_SLOT_ID));
    setChecked(true);
  }, []);

  const content = (
    <>
      {crumb && slot && (
        <span className="topbar__crumb-sub">
          <span className="topbar__sep" aria-hidden="true">
            /
          </span>
          {crumb}
        </span>
      )}
      {left && <div className="topbar__slot-left">{left}</div>}
      <div className="topbar__slot-gap" />
      {right && <div className="topbar__slot-right">{right}</div>}
    </>
  );
  if (!checked) return null;
  if (!slot) return <div className="topbar-inline">{content}</div>;
  return createPortal(content, slot);
}
