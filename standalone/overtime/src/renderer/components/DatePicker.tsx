import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';

const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const pad = (n: number) => String(n).padStart(2, '0');
const toKey = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = (v: string): Date | null => {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
};

/**
 * 날짜 선택 — 트리거 버튼 + 미니 캘린더 팝오버 (네이티브 input[type=date] 대체).
 * value 는 "YYYY-MM-DD". 스타일은 _base.scss 의 .picker/.cal 계열.
 */
export function DatePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = parseKey(value);
  // 팝오버가 보여줄 달 — 열 때마다 선택된 날짜의 달로 리셋
  const [view, setView] = useState(() => selected ?? new Date());

  // 바깥 클릭으로 닫기
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // 6주(42칸) 그리드 — 앞뒤 달 날짜 포함
  const cells = useMemo(() => {
    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [view]);

  const moveMonth = (delta: number) =>
    setView((v) => new Date(v.getFullYear(), v.getMonth() + delta, 1));

  const today = toKey(new Date());
  const label = selected
    ? `${toKey(selected)} (${DOW[selected.getDay()]})`
    : '날짜 선택';

  return (
    <div
      className="picker"
      ref={rootRef}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        className="picker__trigger"
        disabled={disabled}
        onClick={() => {
          setView(selected ?? new Date());
          setOpen((o) => !o);
        }}
      >
        <span className="picker__icon">
          <Icon name="calendar" size={13} />
        </span>
        {label}
        <span className="picker__chev">
          <Icon name="chevron-down" size={12} />
        </span>
      </button>

      {open && (
        <div className="picker__pop cal" role="dialog" aria-label="날짜 선택">
          <div className="cal__head">
            <button
              type="button"
              className="icon-btn"
              aria-label="이전 달"
              onClick={() => moveMonth(-1)}
            >
              <Icon name="chevron-left" size={14} />
            </button>
            <span className="cal__title">
              {view.getFullYear()}년 {view.getMonth() + 1}월
            </span>
            <button
              type="button"
              className="icon-btn"
              aria-label="다음 달"
              onClick={() => moveMonth(1)}
            >
              <Icon name="chevron-right" size={14} />
            </button>
          </div>
          <div className="cal__grid">
            {DOW.map((d) => (
              <span key={d} className="cal__dow">
                {d}
              </span>
            ))}
            {cells.map((d) => {
              const key = toKey(d);
              const cls =
                'cal__day' +
                (d.getMonth() !== view.getMonth() ? ' cal__day--muted' : '') +
                (key === today ? ' cal__day--today' : '') +
                (key === value ? ' cal__day--selected' : '');
              return (
                <button
                  type="button"
                  key={key}
                  className={cls}
                  onClick={() => {
                    onChange(key);
                    setOpen(false);
                  }}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
