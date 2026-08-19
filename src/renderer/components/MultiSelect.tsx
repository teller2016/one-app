import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { usePopover } from '../lib/usePopover';

export type MultiSelectOption = {
  value: string;
  label: ReactNode;
};

/**
 * 공통 다중선택 셀렉트 — Select 와 같은 실루엣(트리거 .select + 팝오버 .picker__pop)에
 * 체크 토글 옵션 목록을 담는다. 토글해도 팝오버는 열린 채 유지(다중선택 관례).
 * `allLabel` 을 주면 맨 위에 배타 옵션(전체)이 붙고, values === undefined 를 전체로
 * 해석한다 — 전체를 고르면 undefined 로 콜백하고 닫는다(단일 선택 관례).
 * 트리거 요약: 전체 라벨 → 1개면 그 라벨 → N개면 countLabel(N) → 0개면 emptyLabel.
 * 키보드: Enter/Space/↓ 열기 · ↑↓ 이동 · Enter/Space 토글 · Escape 닫기(모달로 전파 안 함).
 */
export function MultiSelect({
  options,
  values,
  onChange,
  allLabel,
  countLabel = (n) => `${n}개 선택`,
  emptyLabel = '선택 안 함',
  small = false,
  disabled = false,
  className,
  'aria-label': ariaLabel,
}: {
  options: MultiSelectOption[];
  /** 선택된 value 목록 — undefined 는 '전체'(allLabel 모드에서만 의미) */
  values: string[] | undefined;
  onChange: (values: string[] | undefined) => void;
  /** 배타 '전체' 옵션 라벨 — 있으면 values === undefined 를 전체로 취급 */
  allLabel?: ReactNode;
  /** 트리거 요약 문구 — 2개 이상 선택 시 */
  countLabel?: (n: number) => string;
  /** 아무것도 선택하지 않았을 때 트리거 문구 */
  emptyLabel?: string;
  small?: boolean;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}) {
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0); // 키보드 하이라이트 인덱스 (전체 옵션 포함)
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const popStyle = usePopover(open, btnRef, listRef, {
    matchWidth: true,
    fitHeight: true,
  });

  const isAll = allLabel != null && values === undefined;
  const selected = values ?? [];
  // 행 인덱스 체계 — 0 = 전체 옵션(있으면), 이후 옵션 순서
  const rowCount = (allLabel != null ? 1 : 0) + options.length;
  const optIndex = (i: number) => (allLabel != null ? i - 1 : i);

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

  // 열릴 때 하이라이트를 첫 선택(없으면 맨 위)으로
  useEffect(() => {
    if (!open) return;
    const first = options.findIndex((o) => selected.includes(o.value));
    setHi(isAll || first < 0 ? 0 : first + (allLabel != null ? 1 : 0));
    // 의존성은 open 만 — 열리는 순간의 선택값 기준 1회면 충분
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 하이라이트 이동 시 보이게 스크롤
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector(`[data-opt="${hi}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [hi, open]);

  const toggleRow = (i: number) => {
    if (allLabel != null && i === 0) {
      onChange(undefined); // 전체는 배타 선택 — 고르면 끝이므로 닫는다
      setOpen(false);
      return;
    }
    const opt = options[optIndex(i)];
    if (!opt) return;
    onChange(
      selected.includes(opt.value)
        ? selected.filter((v) => v !== opt.value)
        : [...selected, opt.value]
    );
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
      setHi((i) => Math.min(rowCount - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHi((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleRow(hi);
    } else if (e.key === 'Tab') {
      setOpen(false); // 포커스가 떠나면 닫는다 (토글형이라 blur 로는 안 닫힘)
    }
  };

  // 트리거 요약 — 전체 → 1개는 그 라벨(모르는 값이면 개수) → N개 → 없음
  const one = options.find((o) => o.value === selected[0]);
  const summary = isAll
    ? allLabel
    : selected.length === 0
      ? emptyLabel
      : selected.length === 1 && one
        ? one.label
        : countLabel(selected.length);

  const rowClass = (checked: boolean, i: number) =>
    'picker__option picker__option--multi' +
    (checked ? ' picker__option--checked' : '') +
    (i === hi ? ' picker__option--hi' : '');

  return (
    <div
      className={'picker picker--select' + (className ? ` ${className}` : '')}
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
        <span className="select__value">{summary}</span>
        <span className="select__chev">
          <Icon name="chevron-down" size={12} />
        </span>
      </button>
      {open &&
        createPortal(
          <div
            className={
              'picker__pop picker__list picker__pop--select picker__pop--multi' +
              (small ? ' picker__pop--sm' : '')
            }
            style={popStyle}
            ref={listRef}
            role="listbox"
            aria-multiselectable="true"
          >
            {allLabel != null && (
              <>
                <button
                  type="button"
                  data-opt={0}
                  role="option"
                  aria-selected={isAll}
                  className={rowClass(isAll, 0)}
                  // 트리거 blur 보다 먼저 처리되도록 mousedown 에서 토글 (Select 와 동일)
                  onMouseDown={(e) => {
                    e.preventDefault();
                    toggleRow(0);
                  }}
                  onMouseEnter={() => setHi(0)}
                >
                  <span className="picker__option-check" aria-hidden="true">
                    {isAll && <Icon name="check" size={12} />}
                  </span>
                  <span className="picker__option-label">{allLabel}</span>
                </button>
                <div className="picker__sep" role="separator" />
              </>
            )}
            {options.length === 0 ? (
              <p className="picker__empty">선택할 항목이 없습니다</p>
            ) : (
              options.map((opt, oi) => {
                const i = oi + (allLabel != null ? 1 : 0);
                const checked = selected.includes(opt.value);
                return (
                  <button
                    type="button"
                    key={opt.value}
                    data-opt={i}
                    role="option"
                    aria-selected={checked}
                    className={rowClass(checked, i)}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      toggleRow(i);
                    }}
                    onMouseEnter={() => setHi(i)}
                  >
                    <span className="picker__option-check" aria-hidden="true">
                      {checked && <Icon name="check" size={12} />}
                    </span>
                    <span className="picker__option-label">{opt.label}</span>
                  </button>
                );
              })
            )}
          </div>,
          document.body
        )}
    </div>
  );
}
