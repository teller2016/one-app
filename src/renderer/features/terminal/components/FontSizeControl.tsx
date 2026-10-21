import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../../components/Icon';
import { Tooltip } from '../../../components/Tooltip';
import { usePopover } from '../../../lib/usePopover';
import { FONT_SIZE_MAX, FONT_SIZE_MIN } from './TerminalView';

/**
 * 툴바 글자 크기 컨트롤 — 툴바에는 현재 크기 숫자 버튼 하나만 두고, 누르면 [− 값 +] 팝오버가
 * 뜬다. 예전엔 −·숫자·+ 세 버튼(80px)이 상주했는데 자주 바꾸는 설정이 아니라 탭과 다툴 폭만
 * 먹었다(2026-10-21 사용자 "단순화·사이즈 줄이게" → 24px, '기본으로'도 필요 없다고 해서 뺐다).
 * 메인 툴바·팝아웃 공용.
 */
export function FontSizeControl({
  fontSize,
  onChange,
  onEscape,
}: {
  fontSize: number;
  onChange: (n: number) => void;
  /** Esc 로 닫은 뒤 포커스를 돌려줄 곳(터미널 pane) — 안 주면 트리거에 남아 타이핑이 허공으로 간다.
   *  바깥 클릭으로 닫히면 그 클릭이 포커스를 정하므로 부르지 않는다. 참조는 고정해 넘길 것 */
  onEscape?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const popStyle = usePopover(open, btnRef, popRef);

  // 바깥 pointerdown·Escape·창 블러에 닫는다 (ContextMenu 와 같은 규칙).
  // capture — xterm textarea 가 이벤트를 먼저 소비해도 터미널을 누르면 닫혀야 한다.
  // 트리거는 제외 — 트리거 클릭은 onClick 토글이 맡는다(여기서 닫으면 곧바로 다시 열린다)
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      close();
    };
    // Esc 는 팝오버만 닫고 삼킨다 — 다른 Esc 처리(드로어 닫기 등)까지 한 번에 돌지 않게
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      close();
      onEscape?.();
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', close);
    };
  }, [open, onEscape]);

  return (
    <>
      <Tooltip label={`글자 크기 ${fontSize}px`}>
        <button
          ref={btnRef}
          type="button"
          className={'icon-btn' + (open ? ' terminal__size-btn--on' : '')}
          aria-label={`글자 크기 ${fontSize}px`}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="terminal__bar-size">{fontSize}</span>
        </button>
      </Tooltip>
      {open &&
        createPortal(
          <div
            ref={popRef}
            className="picker__pop terminal__size-pop"
            style={popStyle}
            role="dialog"
            aria-label="글자 크기"
          >
            <button
              type="button"
              className="icon-btn"
              aria-label="글자 작게"
              disabled={fontSize <= FONT_SIZE_MIN}
              onClick={() => onChange(Math.max(FONT_SIZE_MIN, fontSize - 1))}
            >
              <Icon name="minus" size={14} />
            </button>
            <span className="terminal__size-val">{fontSize}px</span>
            <button
              type="button"
              className="icon-btn"
              aria-label="글자 크게"
              disabled={fontSize >= FONT_SIZE_MAX}
              onClick={() => onChange(Math.min(FONT_SIZE_MAX, fontSize + 1))}
            >
              <Icon name="plus" size={14} />
            </button>
          </div>,
          document.body
        )}
    </>
  );
}
