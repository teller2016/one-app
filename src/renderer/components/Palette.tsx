import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';

/**
 * 검색 + 키보드 목록 팝업의 공용 셸 — ⌘P 명령 팔레트(`app/CommandPalette`)와 ⌘⇧P Claude 세션 전환
 * (`features/terminal` `SessionSwitcher`)이 함께 쓴다. 무엇을 보여 주고 실행하는지는 부르는 쪽이 정하고,
 * 여기는 오버레이·검색창·목록·↑↓↵Esc·포커스만 맡는다(아래 ⚠️ 들은 2026-09-30 /test 실측이라 복사하지 말고 이걸 쓸 것).
 *
 * 선택은 **항목 key** 로 기억한다 — 열린 동안 목록이 새로 고쳐져 순서가 바뀌어도(세션 상태 변화) 고른 줄이 따라간다.
 * 부모가 조건부 렌더로 연다(열릴 때마다 선택이 첫 줄로 돌아간다).
 */
export function Palette<T>({
  label,
  placeholder,
  query,
  onQueryChange,
  items,
  itemKey,
  itemGroup,
  renderItem,
  itemClassName,
  onRun,
  onClose,
  empty,
  runLabel = '실행',
}: {
  /** 대화상자 접근성 이름 */
  label: string;
  placeholder: string;
  query: string;
  onQueryChange: (q: string) => void;
  /** 보일 순서 그대로 — 거르기·정렬은 부르는 쪽이 한다 */
  items: T[];
  itemKey: (item: T) => string;
  /** 값이 바뀌는 줄 위에 그룹 제목을 단다 */
  itemGroup?: (item: T) => string;
  /** 줄 안쪽 내용 — 줄 버튼(선택 표시·클릭·hover)은 셸이 그린다 */
  renderItem: (item: T) => ReactNode;
  /** 줄 모양 변형 (예: 두 줄 행) */
  itemClassName?: string;
  onRun: (item: T) => void;
  onClose: () => void;
  /** 보일 줄이 없을 때 문구 */
  empty: ReactNode;
  /** 하단 안내의 ↵ 설명 */
  runLabel?: string;
}) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const found =
    activeKey === null ? -1 : items.findIndex((it) => itemKey(it) === activeKey);
  const active = found >= 0 ? found : 0;
  const select = (i: number) => {
    const it = items[i];
    if (it) setActiveKey(itemKey(it));
  };

  // 닫을 때 원래 포커스로 돌려준다(터미널 pane 에서 열었으면 바로 이어 입력) — 단, 항목을
  // 실행해 닫았으면 돌려주지 않는다: 이동했거나 명령이 띄운 모달이 포커스를 가져간다
  const restoreRef = useRef(true);
  useEffect(() => {
    const prev = document.activeElement;
    return () => {
      if (restoreRef.current && prev instanceof HTMLElement && prev.isConnected)
        prev.focus();
    };
  }, []);

  // 포커스는 한 프레임 뒤에 — 여는 단축키의 keydown 이 끝나기 전에 옮기면 되돌아갈 수 있다
  useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  // 선택 항목이 보이게 스크롤
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-idx="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
    // 첫 항목이면 맨 위까지 — 항목 기준 nearest 로는 위의 그룹 제목이 가려진 채 남는다
    if (active === 0 && listRef.current) listRef.current.scrollTop = 0;
  }, [active]);

  const run = (it: T | undefined) => {
    if (it === undefined) return;
    restoreRef.current = false;
    onClose(); // 먼저 닫는다 — 실행이 띄우는 확인창·모달이 팝업 뒤에 깔리지 않게
    onRun(it);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return; // 한글 조합 중 Enter·방향키는 IME 몫
    const n = items.length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (n) select((active + 1) % n);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (n) select((active - 1 + n) % n);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(items[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  const optionId = (it: T) => `palette-${itemKey(it)}`;
  let lastGroup: string | null = null;
  return createPortal(
    <div
      className="palette-overlay"
      onPointerDown={(e) => {
        // ⚠️ preventDefault — 뒤따르는 mousedown 을 억제한다. 안 그러면 팔레트가 빠진 자리(body)로
        // mousedown 이 가서, 방금 돌려준 포커스(터미널 pane)를 다시 뺏는다(2026-09-30 /test)
        if (e.target !== e.currentTarget) return;
        e.preventDefault();
        onClose();
      }}
    >
      {/* 키 처리는 팔레트 전체에서 받는다(입력창 이벤트가 버블링) — 그리고 입력창이 아닌 곳을
          눌러도 포커스가 입력창을 떠나지 않게 막는다. 안 그러면 푸터·그룹 제목 클릭 한 번에
          포커스가 body 로 빠져 ↑↓·↵·Esc 가 전부 먹통이 된다(2026-09-30 /test) */}
      <div
        className="palette"
        role="dialog"
        aria-label={label}
        onKeyDown={onKeyDown}
        onMouseDown={(e) => {
          if (e.target !== inputRef.current) e.preventDefault();
        }}
      >
        <div className="palette__search">
          <Icon name="search" size={16} />
          <input
            ref={inputRef}
            className="palette__input"
            placeholder={placeholder}
            value={query}
            onChange={(e) => {
              onQueryChange(e.target.value);
              setActiveKey(null); // 검색이 바뀌면 첫 줄부터
            }}
            aria-label={placeholder}
            aria-activedescendant={
              items[active] !== undefined ? optionId(items[active]) : undefined
            }
          />
        </div>
        <div className="palette__list" ref={listRef} role="listbox">
          {items.length === 0 && <p className="palette__empty">{empty}</p>}
          {items.map((it, i) => {
            const group = itemGroup?.(it) ?? null;
            const head = group !== null && group !== lastGroup;
            lastGroup = group;
            return (
              <div key={itemKey(it)}>
                {head && <div className="palette__group">{group}</div>}
                <button
                  type="button"
                  id={optionId(it)}
                  data-idx={i}
                  role="option"
                  aria-selected={i === active}
                  className={
                    'palette__item' +
                    (itemClassName ? ` ${itemClassName}` : '') +
                    (i === active ? ' palette__item--on' : '')
                  }
                  onPointerMove={() => i !== active && select(i)}
                  onClick={() => run(it)}
                >
                  {renderItem(it)}
                </button>
              </div>
            );
          })}
        </div>
        <div className="palette__foot">
          <span>
            <kbd className="palette__kbd">↑</kbd>
            <kbd className="palette__kbd">↓</kbd> 이동
          </span>
          <span>
            <kbd className="palette__kbd">↵</kbd> {runLabel}
          </span>
          <span>
            <kbd className="palette__kbd">Esc</kbd> 닫기
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
