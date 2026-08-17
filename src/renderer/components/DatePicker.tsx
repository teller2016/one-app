import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { usePopover } from '../lib/usePopover';
import {
  WEEKDAY_KO as DOW,
  dayKey as toKey,
  parseDayKey as parseKey,
} from '../../shared/date';

/**
 * 날짜 선택 — 트리거 버튼 + 미니 캘린더 팝오버 (네이티브 input[type=date] 대체).
 * value 는 "YYYY-MM-DD". 스타일은 _base.scss 의 .picker/.cal 계열.
 * 팝오버는 body 로 portal + fixed 배치(usePopover) — 모달 본문 안에 갇혀 잘리지 않게.
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
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  // 앵커는 컨테이너가 아니라 트리거 버튼 — .picker 는 부모 flex 에서 stretch 될 수 있다
  const popStyle = usePopover(open, btnRef, popRef);
  const selected = parseKey(value);
  // 팝오버가 보여줄 달 — 열 때마다 선택된 날짜의 달로 리셋
  const [view, setView] = useState(() => selected ?? new Date());

  // 바깥 클릭으로 닫기 — 팝오버는 portal 로 root 밖이라 함께 판정해야 한다
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!rootRef.current?.contains(t) && !popRef.current?.contains(t))
        setOpen(false);
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
      // 팝오버만 닫고 모달(document 리스너)까지 닫히지 않게 전파 차단
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        ref={btnRef}
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

      {open &&
        createPortal(
          <div
            className="picker__pop cal"
            style={popStyle}
            ref={popRef}
            role="dialog"
            aria-label="날짜 선택"
          >
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
          </div>,
          document.body,
        )}
    </div>
  );
}
