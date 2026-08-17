import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePopover } from '../lib/usePopover';
import { fromMinutes, pad2 as pad } from '../../shared/date';

/** 자유 입력을 "HH:MM" 으로 정규화 — 19 · 19:5 · 1930 · 19:30 허용, 실패 시 null */
const normalizeTime = (raw: string): string | null => {
  const t = raw.trim();
  let h: number;
  let m: number;
  let match: RegExpMatchArray | null;
  if ((match = t.match(/^(\d{1,2}):(\d{1,2})$/))) {
    h = +match[1];
    m = +match[2];
  } else if ((match = t.match(/^(\d{1,2})(\d{2})$/))) {
    h = +match[1];
    m = +match[2];
  } else if ((match = t.match(/^(\d{1,2})$/))) {
    h = +match[1];
    m = 0;
  } else {
    return null;
  }
  if (h > 23 || m > 59) return null;
  return `${pad(h)}:${pad(m)}`;
};

/**
 * 시간 선택 — 직접 타이핑 가능한 입력 + N분 단위 리스트 팝오버
 * (네이티브 input[type=time] 대체). value 는 "HH:MM". 스타일은 _base.scss 의 .picker 계열.
 * 팝오버는 body 로 portal + fixed 배치(usePopover) — 모달 본문 안에 갇혀 잘리지 않게.
 * small: 좁은 그리드(설정 리마인더 등)용 — 입력이 작아지고 컨테이너 폭을 따라간다.
 * step: 리스트 간격(분) — 기본 30. 리마인더처럼 세밀한 등록이 필요하면 5 등으로.
 */
export function TimePicker({
  value,
  onChange,
  disabled = false,
  small = false,
  step = 30,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  small?: boolean;
  step?: number;
}) {
  // step 분 간격 옵션 (00:00 ~ 자정 직전)
  const options = useMemo(() => {
    const interval = Math.max(1, Math.min(60, Math.trunc(step)));
    return Array.from({ length: Math.ceil((24 * 60) / interval) }, (_, i) =>
      fromMinutes(i * interval),
    );
  }, [step]);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // 앵커는 컨테이너가 아니라 입력 — .picker 는 부모 flex 에서 stretch 될 수 있다
  const popStyle = usePopover(open, inputRef, listRef, {
    matchWidth: true,
    fitHeight: true,
  });

  // 밖에서 값이 바뀌면 입력 텍스트 동기화
  useEffect(() => setText(value), [value]);

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

  // 열릴 때 현재 값(정확히 일치하지 않으면 가장 가까운 옵션)으로 스크롤
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (!list) return;
    let target = list.querySelector(
      '.picker__option--active',
    ) as HTMLElement | null;
    if (!target) {
      const m = value.match(/^(\d{1,2}):(\d{2})$/);
      if (m) {
        const interval = (24 * 60) / options.length;
        const idx = Math.min(
          options.length - 1,
          Math.round((+m[1] * 60 + +m[2]) / interval),
        );
        target = list.children[idx] as HTMLElement | null;
      }
    }
    target?.scrollIntoView({ block: 'center' });
  }, [open, value, options]);

  // 입력 확정 — 정규화 성공이면 반영, 실패면 원래 값으로 되돌림
  const commitText = () => {
    const normalized = normalizeTime(text);
    if (normalized) onChange(normalized);
    else setText(value);
  };

  return (
    <div
      className={'picker picker--time' + (small ? ' picker--time-sm' : '')}
      ref={rootRef}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          // 팝오버만 닫고 모달(document 리스너)까지 닫히지 않게 전파 차단
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <input
        ref={inputRef}
        className={'input' + (small ? ' input--sm' : '') + ' picker__time-input'}
        value={text}
        disabled={disabled}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={commitText}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commitText();
            setOpen(false);
          }
        }}
        placeholder="HH:MM"
        autoComplete="off"
      />
      {open &&
        createPortal(
          <div
            className={'picker__pop picker__list' + (small ? ' picker__pop--sm' : '')}
            style={popStyle}
            ref={listRef}
            role="listbox"
          >
            {options.map((opt) => (
              <button
                type="button"
                key={opt}
                role="option"
                aria-selected={opt === value}
                className={
                  'picker__option' +
                  (opt === value ? ' picker__option--active' : '')
                }
                // blur(commitText)보다 먼저 처리되도록 mousedown 에서 선택
                onMouseDown={(e) => {
                  e.preventDefault();
                  onChange(opt);
                  setOpen(false);
                }}
              >
                {opt}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
