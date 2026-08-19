import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { usePopover } from '../lib/usePopover';

export type SelectOption = {
  value: string;
  label: ReactNode;
  /** 검색 대상 문자열 — 생략하면 value 로 검색한다 (label 이 ReactNode 라 필요) */
  search?: string;
};

/**
 * 공통 셀렉트 — 네이티브 드롭다운 대신 TimePicker 계열의 커스텀 팝오버.
 * 트리거는 .input 실루엣(.select), 옵션 리스트는 공용 .picker__pop/.picker__option 재사용.
 * 옵션 리스트는 body 로 portal + fixed 배치(usePopover) — 모달 본문 안에 갇혀
 * 잘리거나 스크롤을 만들지 않게 한다.
 * `searchable` 이면 팝오버 상단에 검색창이 붙어 열자마자 타이핑으로 좁힐 수 있다.
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
  searchable = false,
  searchPlaceholder = '검색',
  limit,
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
  /** 팝오버 상단에 검색창을 붙인다 (옵션이 많은 목록용) */
  searchable?: boolean;
  searchPlaceholder?: string;
  /** 한 번에 렌더할 최대 옵션 수 — 초과분은 개수만 알리고 검색으로 좁히게 한다 */
  limit?: number;
  'aria-label'?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hi, setHi] = useState(0); // 키보드 하이라이트 인덱스 (visible 기준)
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const popStyle = usePopover(open, btnRef, listRef, {
    matchWidth: true,
    fitHeight: true,
  });

  // 트리거 라벨은 필터와 무관하게 원본에서 찾는다 (검색 중에도 현재 값이 보이게)
  const selected = options.find((o) => o.value === value);

  const q = searchable ? query.trim().toLowerCase() : '';
  const matched = q
    ? options.filter((o) => (o.search ?? o.value).toLowerCase().includes(q))
    : options;
  const visible = limit != null ? matched.slice(0, limit) : matched;
  const hiddenCount = matched.length - visible.length;

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

  // 열릴 때 검색어를 비우고 현재 값으로 하이라이트 + 스크롤 (검색창이 있으면 포커스)
  useEffect(() => {
    if (!open) return;
    setQuery('');
    const idx = Math.max(
      0,
      options.findIndex((o) => o.value === value),
    );
    setHi(idx);
    listRef.current
      ?.querySelector(`[data-opt="${idx}"]`)
      ?.scrollIntoView({ block: 'center' });
    // ⚠️ 포커스는 다음 프레임에 준다 — 트리거 버튼의 기본 포커스가 이 effect 뒤에
    // 확정돼(실측) 여기서 바로 focus() 하면 곧바로 버튼에 되돌려진다.
    const raf = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(raf);
    // 의존성은 open 만 — 열리는 순간의 선택값 기준 1회면 충분
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 검색어가 바뀌면 첫 후보로 하이라이트를 옮긴다
  useEffect(() => {
    if (open) setHi(0);
  }, [query, open]);

  // 하이라이트 이동 시 보이게 스크롤
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector(`[data-opt="${hi}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [hi, open]);

  const commit = (idx: number) => {
    const opt = visible[idx];
    if (opt) onChange(opt.value);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // 검색창에 포커스가 있으면 문자 입력을 방해하지 않는다 (Space 는 선택 키가 아님)
    const inSearch = searchable && e.target === searchRef.current;
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
      setHi((i) => Math.min(visible.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHi((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' || (e.key === ' ' && !inSearch)) {
      e.preventDefault();
      commit(hi);
    }
  };

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
              (small ? ' picker__pop--sm' : '') +
              (searchable ? ' picker__pop--search' : '')
            }
            style={popStyle}
            ref={listRef}
            role="listbox"
          >
            {searchable && (
              <div className="picker__search">
                <Icon name="search" size={12} />
                <input
                  ref={searchRef}
                  type="text"
                  value={query}
                  placeholder={searchPlaceholder}
                  aria-label={searchPlaceholder}
                  autoComplete="off"
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            )}
            {visible.length === 0 ? (
              <p className="picker__empty">일치하는 항목이 없습니다</p>
            ) : (
              visible.map((opt, i) => (
                <button
                  type="button"
                  key={opt.value}
                  data-opt={i}
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
              ))
            )}
            {hiddenCount > 0 && (
              <p className="picker__empty">
                +{hiddenCount}개 더 — 검색으로 좁히세요
              </p>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
