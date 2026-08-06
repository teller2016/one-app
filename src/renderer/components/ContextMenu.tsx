// 공용 컨텍스트 메뉴 — 우클릭 지점(fixed 좌표)에 body portal 로 띄운다.
// 피커 팝오버와 같은 이유로 body portal (제자리 absolute 는 스크롤 컨테이너에 갇혀 잘린다).
// 바깥 pointerdown(capture)·Escape·창 블러에 닫히고, 뷰포트를 벗어나면 안쪽으로 클램프한다.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon';

export function ContextMenu({
  x,
  y,
  onClose,
  children,
  'aria-label': ariaLabel,
}: {
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
  'aria-label'?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // 뷰포트 클램프 — 페인트 전에 실제 메뉴 크기로 좌표를 보정한다
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)),
    });
  }, [x, y]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    // capture — xterm textarea 등이 이벤트를 먼저 소비해도 닫힘이 동작해야 한다
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className="ctx"
      role="menu"
      aria-label={ariaLabel}
      style={{ left: pos.left, top: pos.top }}
      // 메뉴 위에서 또 우클릭해도 브라우저 기본 메뉴가 뜨지 않게
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </div>,
    document.body
  );
}

export function ContextMenuItem({
  icon,
  label,
  danger = false,
  onSelect,
}: {
  icon?: IconName;
  label: string;
  danger?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={'ctx__item' + (danger ? ' ctx__item--danger' : '')}
      onClick={onSelect}
    >
      {icon && <Icon name={icon} size={14} />}
      <span>{label}</span>
    </button>
  );
}

export function ContextMenuSeparator() {
  return <div className="ctx__sep" role="separator" />;
}
