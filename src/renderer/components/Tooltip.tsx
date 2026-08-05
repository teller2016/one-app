import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { usePopover } from '../lib/usePopover';

/** 마우스를 스칠 때마다 뜨지 않게 두는 지연 — 키보드 포커스는 즉시 띄운다 */
const SHOW_DELAY_MS = 250;

/**
 * 공용 툴팁 — 아이콘만 있는 버튼이 무슨 기능인지 hover 로 알려준다.
 *
 * 네이티브 `title` 은 지연이 1초 이상이고 OS 스타일이라 어두운 툴바에서 눈에 안 띈다.
 * 그래서 `usePopover`(트리거 기준 fixed 좌표 + 뷰포트 클램프 + flip)로 직접 그린다 —
 * `body` 로 portal 하므로 `overflow:hidden` 컨테이너(터미널 패널 등)에 잘리지 않는다.
 *
 * ⚠️ 툴팁 자신은 `pointer-events: none` 이다(SCSS) — 안 그러면 마우스가 툴팁 위로
 * 올라간 순간 트리거의 leave 가 떠서 깜빡이고, 아래 버튼 클릭도 가로챈다.
 */
export function Tooltip({
  label,
  children,
}: {
  /** 툴팁에 보일 설명 — 트리거의 `aria-label` 은 별도로 줄 것 */
  label: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const popStyle = usePopover(open, anchorRef, popRef);

  const clear = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };
  const show = () => {
    clear();
    timer.current = window.setTimeout(() => setOpen(true), SHOW_DELAY_MS);
  };
  const hide = () => {
    clear();
    setOpen(false);
  };

  // 언마운트 시 남은 타이머 정리 (버튼이 조건부로 사라지는 툴바가 있다)
  useEffect(() => clear, []);

  return (
    <span
      className="tip"
      ref={anchorRef}
      onPointerEnter={show}
      onPointerLeave={hide}
      // 클릭하면 볼 일이 끝났으므로 닫는다 (누른 자리에 계속 떠 있으면 방해된다)
      onPointerDown={hide}
      onFocusCapture={() => {
        clear();
        setOpen(true); // 키보드 이동은 즉시 — 지연이 있으면 탭 순회 중 설명을 놓친다
      }}
      onBlurCapture={hide}
    >
      {children}
      {open &&
        createPortal(
          <div ref={popRef} className="tip__pop" style={popStyle} role="tooltip">
            {label}
          </div>,
          document.body,
        )}
    </span>
  );
}
