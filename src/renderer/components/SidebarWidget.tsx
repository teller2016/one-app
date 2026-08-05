import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePopover } from '../lib/usePopover';
import { useSidebarCollapsed } from './Sidebar';

/**
 * 이 팝오버가 닫히면 안 되는 바깥 레이어 — 위젯이 띄운 모달·확인창·토스트·피커는
 * `body` 로 portal 되므로 좌표상 '팝오버 밖'이다. 그 클릭까지 외부 클릭으로 보면
 * 야근 결재 모달을 여는 순간 배경 팝오버가 닫히고, 확인창의 [확인] 클릭도 함께 닫는다.
 */
const OUTER_LAYERS = '.modal-overlay, .picker__pop, .toast';

/**
 * 사이드바 위젯 셸 — 축소 모드에서 위젯을 쓸 수 있게 만드는 래퍼.
 *
 * 접히면 사이드바에는 `[아이콘][상태점]` 타일만 남고, 그 타일을 누르면 위젯 본체가
 * 오른쪽 팝오버로 펼쳐진다(macOS 메뉴바 위젯). 접은 채로 연결·미러링·출퇴근·야근 결재까지
 * 모두 조작할 수 있다. 펼친 사이드바에서는 아무것도 하지 않고 본체를 제자리에 그린다.
 *
 * ⚠️ 본체(children)는 접힘 여부와 무관하게 **항상 같은 자리에 마운트**한다 —
 * 접었다 펼 때마다 재마운트되면 위젯의 초기 조회가 다시 돌고, 근태는 그것이
 * headless 브라우저 그룹웨어 조회다. 그래서 팝오버도 portal 이 아니라
 * 제자리 `fixed` 로 띄우고, 닫힘은 언마운트가 아니라 `hidden` 으로 처리한다.
 */
export function SidebarWidget({
  icon,
  dot,
  tooltip,
  children,
}: {
  /** 축소 타일에 쓸 위젯 아이콘 — 본체 `.sbw__icon` 과 같은 것을 넘긴다 */
  icon: ReactNode;
  /** 상태를 나르는 점·표식 (StatusDot 등) — 축소돼도 상태는 보여야 한다 */
  dot?: ReactNode;
  /** 축소 시 감춰지는 상태 텍스트를 대신할 툴팁 */
  tooltip: string;
  children: ReactNode;
}) {
  const collapsed = useSidebarCollapsed();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const popStyle = usePopover(collapsed && open, triggerRef, popRef, {
    side: 'right',
  });

  // 사이드바를 펼치면 본체가 제자리로 돌아오므로 팝오버는 접어 둔다
  useEffect(() => {
    if (!collapsed) setOpen(false);
  }, [collapsed]);

  useEffect(() => {
    if (!collapsed || !open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      if (popRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      if (t.closest(OUTER_LAYERS)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    // capture — 안쪽 요소가 이벤트를 멈춰도 바깥 클릭 판정은 놓치지 않게
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [collapsed, open]);

  return (
    <>
      {collapsed && (
        <button
          type="button"
          ref={triggerRef}
          className={'sbwx__mini' + (open ? ' sbwx__mini--open' : '')}
          title={tooltip}
          aria-label={tooltip}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="sbwx__mini-icon">{icon}</span>
          {dot}
        </button>
      )}
      <div
        ref={popRef}
        className={'sbwx__body' + (collapsed ? ' sbwx__body--pop' : '')}
        style={collapsed ? popStyle : undefined}
        hidden={collapsed && !open}
      >
        {children}
      </div>
    </>
  );
}
