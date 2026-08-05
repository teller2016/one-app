import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { usePopover } from '../lib/usePopover';

export type SelectOption = { value: string; label: ReactNode };

/**
 * 공통 셀렉트 — 네이티브 드롭다운 대신 TimePicker 계열의 커스텀 팝오버.
 * 트리거는 .input 실루엣(.select), 옵션 리스트는 공용 .picker__pop/.picker__option 재사용.
 * 옵션 리스트는 body 로 portal + fixed 배치(usePopover) — 모달 본문 안에 갇혀
 * 잘리거나 스크롤을 만들지 않게 한다.
 * 키보드: Enter/Space/↓ 열기 · ↑↓ 이동 · Enter 선택 · Escape 닫기(모달로 전파 안 함).
 */
export function Select({
  options,
  value,
  onChange,
  small = false,
  disabled = false,
  className,
  placeholder = '선택',
  'aria-label': ariaLabel,
}: {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  small?: boolean;
  disabled?: boolean;
  className?: string;
  /** value 가 옵션에 없을 때 트리거에 표시할 문구 */
  placeholder?: string;
  'aria-label'?: string;
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0); // 키보드 하이라이트 인덱스
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const popStyle = usePopover(open, btnRef, listRef, {
    matchWidth: true,
    fitHeight: true,
  });

  const selectedIdx = options.findIndex((o) => o.value === value);
  const selected = options[selectedIdx];

  // 바깥 클릭으로 닫기 — 팝오버는 portal 로 root 밖이라 함께 판정해야 한다
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!rootRef.current?.contains(t) && !listRef.current?.contains(t))
        setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // 열릴 때 현재 값으로 하이라이트 + 스크롤
  useEffect(() => {
    if (!open) return;
    setHi(Math.max(0, selectedIdx));
    const target = listRef.current?.children[
      Math.max(0, selectedIdx)
    ] as HTMLElement | null;
    target?.scrollIntoView({ block: 'center' });
    // 의존성은 open 만 — 열리는 순간의 선택값 기준 1회면 충분
  }, [open]);

  // 하이라이트 이동 시 보이게 스크롤
  useEffect(() => {
    if (!open) return;
    const target = listRef.current?.children[hi] as HTMLElement | null;
    target?.scrollIntoView({ block: 'nearest' });
  }, [hi, open]);

  const commit = (idx: number) => {
    const opt = options[idx];
    if (opt) onChange(opt.value);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (open) {
        // 팝오버만 닫고 모달(document 리스너)까지 닫히지 않게 전파 차단
        e.stopPropagation();
        setOpen(false);
      }
      return;
    }
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHi((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHi((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      commit(hi);
    }
  };

  return (
    <div
      className={
        'picker picker--select' + (className ? ` ${className}` : '')
      }
      ref={rootRef}
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        ref={btnRef}
        className={'select' + (small ? ' select--sm' : '')}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="select__value">
          {selected ? selected.label : placeholder}
        </span>
        <span className="select__chev">
          <Icon name="chevron-down" size={12} />
        </span>
      </button>
      {open &&
        createPortal(
          <div
            className={
              'picker__pop picker__list picker__pop--select' +
              (small ? ' picker__pop--sm' : '')
            }
            style={popStyle}
            ref={listRef}
            role="listbox"
          >
            {options.map((opt, i) => (
              <button
                type="button"
                key={opt.value}
                role="option"
                aria-selected={opt.value === value}
                className={
                  'picker__option' +
                  (opt.value === value ? ' picker__option--active' : '') +
                  (i === hi ? ' picker__option--hi' : '')
                }
                // 트리거 blur 보다 먼저 처리되도록 mousedown 에서 선택 (TimePicker 와 동일)
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(i);
                }}
                onMouseEnter={() => setHi(i)}
              >
                {opt.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
