import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePopover } from '../lib/usePopover';
import { StatusBarItem, useInStatusBar } from './StatusBar';

/**
 * 이 팝오버가 닫히면 안 되는 바깥 레이어 — 위젯이 띄운 모달·확인창·토스트·피커는
 * `body` 로 portal 되므로 좌표상 '팝오버 밖'이다. 그 클릭까지 외부 클릭으로 보면
 * 야근 결재 모달을 여는 순간 배경 팝오버가 닫히고, 확인창의 [확인] 클릭도 함께 닫는다.
 */
const OUTER_LAYERS = '.modal-overlay, .picker__pop, .toasts';

/**
 * 상태바 위젯 셸 (VPN·폰 미러링·근태) — 상태바에는 한 줄 요약만 두고, 누르면 위젯 본체가
 * **위로 뜨는 팝오버**로 펼쳐진다(macOS 메뉴바 위젯). 상태바 밖(폰 셸의 근태 화면 등)에서는
 * 아무것도 하지 않고 본체를 제자리에 그린다.
 *
 * ⚠️ 본체(children)는 열림 여부와 무관하게 **항상 마운트**한다 — 열 때마다 재마운트되면
 * 위젯의 초기 조회가 다시 돌고, 근태는 그것이 headless 브라우저 그룹웨어 조회다.
 * 그래서 팝오버도 portal 이 아니라 제자리 `fixed` 로 띄우고, 닫힘은 `hidden` 으로 처리한다.
 */
export function StatusWidget({
  icon,
  dot,
  label,
  tooltip,
  closeSignal,
  children,
}: {
  /** 상태바 항목 아이콘 — 본체 `.sbw__icon` 과 같은 것을 넘긴다 */
  icon: ReactNode;
  /** 상태를 나르는 점·표식 (StatusDot 등) */
  dot?: ReactNode;
  /** 상태바 한 줄 요약 — 짧게 */
  label: ReactNode;
  /** 요약에 다 담기지 않는 전체 상태 문구 */
  tooltip: string;
  /**
   * 값이 바뀌면 팝오버를 닫는다 — 위젯이 할 일을 끝냈을 때(폰 제어·미러링 연결 성공 등) 올린다.
   * 동작 함수가 ⌘K 명령과 공용이라 본체 안 훅이 아니라 위젯 셸 prop 으로 받는다
   */
  closeSignal?: number;
  children: ReactNode;
}) {
  const inBar = useInStatusBar();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const popStyle = usePopover(inBar && open, triggerRef, popRef, { side: 'top' });

  useEffect(() => {
    if (closeSignal) setOpen(false);
  }, [closeSignal]);

  useEffect(() => {
    if (!inBar || !open) return;
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
  }, [inBar, open]);

  if (!inBar) return <>{children}</>;

  return (
    <>
      <StatusBarItem
        ref={triggerRef}
        icon={icon}
        dot={dot}
        label={label}
        title={tooltip}
        active={open}
        onClick={() => setOpen((v) => !v)}
      />
      <div ref={popRef} className="statusbar__pop" style={popStyle} hidden={!open}>
        {children}
      </div>
    </>
  );
}
