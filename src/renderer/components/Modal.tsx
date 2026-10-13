import {
  useEffect,
  useId,
  useRef,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useBackClose } from '../lib/useBackClose';
import { Icon } from './Icon';

/**
 * 공통 모달 — 오버레이 + 패널(헤더·스크롤 본문). 스타일은 _base.scss 의 .modal 계열.
 * 열림 여부는 부모가 조건부 렌더로 제어한다: {open && <Modal ...>}
 * Escape 키·오버레이 클릭·닫기 버튼, 그리고 **폰의 뒤로가기**로 onClose 가 호출된다.
 *
 * - `closable={false}` 면 위 경로로 닫히지 않는다 — 진행 중인 작업(작업 시작·PR 생성)을
 *   닫기로 '취소'한 줄 알았는데 뒤에서 계속 진행되던 문제를 막는다.
 * - 겹쳐 뜨면 **맨 위 모달만** Escape 를 받고, 아래(다른 모달·상세 패널·상태바 팝오버)로
 *   전파하지 않는다.
 * - 포커스: 열릴 때 다이얼로그로 옮기고(안에 이미 포커스가 있으면 — autoFocus — 그대로),
 *   Tab 은 안에서 돌며, 닫히면 연 요소로 돌려준다.
 */

/** 떠 있는 모달 스택 — 마지막이 맨 위. Escape 는 맨 위만 처리한다 */
const modalStack: symbol[] = [];

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), ' +
  'select:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  tabs,
  actions,
  wide = false,
  width,
  closable = true,
}: {
  title: ReactNode;
  /** 제목 아래 한 줄 보조 문구 (목업 — 티켓 제목 등) */
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** 하단 액션 바 — 가라앉은 면 + 윗선, 버튼은 오른쪽 정렬 (목업 .modal-foot) */
  footer?: ReactNode;
  /**
   * 제목 아래 탭 줄(목업 MailModal — 밑줄 탭). 주면 머리가 바닥선을 갖고 탭이 그 선에 붙는다.
   * 탭 버튼 자체는 호출부가 그린다(밑줄 탭은 아직 이 모달 하나뿐이다).
   */
  tabs?: ReactNode;
  /** 머리 오른쪽, 닫기 버튼 앞의 아이콘 버튼들(새로고침 등) */
  actions?: ReactNode;
  /** 넓은 콘텐츠(로그·표)용 확장 폭 */
  wide?: boolean;
  /** 목업 폭(px) — 최대 폭을 이 값으로 (wide 보다 우선). 좁은 창에선 그대로 줄어든다 */
  width?: number;
  /** false 면 Escape·오버레이 클릭·닫기 버튼·뒤로가기로 닫히지 않는다(진행 중 작업 보호) */
  closable?: boolean;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // 최신 값만 참조 — 리스너를 렌더마다 다시 걸지 않는다
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const closableRef = useRef(closable);
  closableRef.current = closable;
  const requestClose = () => {
    if (closableRef.current) closeRef.current();
  };

  useEffect(() => {
    const me = Symbol('modal');
    modalStack.push(me);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || modalStack[modalStack.length - 1] !== me) return;
      // document 단계에서 멈춘다 — window 에 건 아래 레이어(Jira 상세 패널·상태바 위젯)의
      // Escape 닫힘까지 함께 돌던 문제. 확인창(window capture)·피커(요소 단계)는 이보다 먼저 받는다.
      e.stopPropagation();
      if (closableRef.current) closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const i = modalStack.indexOf(me);
      if (i >= 0) modalStack.splice(i, 1);
    };
  }, []);

  // 포커스 — 열 때 다이얼로그로, 닫을 때 연 요소로
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dlg = dialogRef.current;
    // 한 프레임 뒤 — 내부 autoFocus·여는 클릭의 기본 포커스가 확정된 뒤에 판단한다
    const raf = requestAnimationFrame(() => {
      if (dlg && !dlg.contains(document.activeElement)) dlg.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(raf);
      // 포커스가 이 모달 안(곧 사라짐)이나 body 에 있을 때만 돌려준다 — 닫으며 다른 곳으로
      // 이동했으면(섹션 이동·다른 모달) 뺏지 않는다
      const active = document.activeElement;
      const lost = !active || active === document.body || dlg?.contains(active);
      if (lost && opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  // Tab 을 모달 안에서 돌린다 — 뒤의 사이드바·목록으로 빠져 Enter 로 가려진 버튼이 눌리던 문제
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const dlg = dialogRef.current;
    if (!dlg) return;
    const items = Array.from(dlg.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    );
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === dlg)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  // 폰 뒤로가기로도 닫힌다 — 안 하면 모달을 띄운 채 뒤로가기를 누르는 순간 앱을 벗어난다
  // (closable=false 동안의 뒤로가기는 무시한다 — 항목은 소비되지만 진행 중 작업이 우선)
  useBackClose(requestClose);

  // body 끝으로 포털 — 사이드바·탑바(-webkit-app-region: drag)보다 문서 순서상
  // 뒤에 있어야 오버레이의 no-drag 가 창 드래그 영역을 걷어내 dim 클릭이 전달된다
  return createPortal(
    <div
      className="modal-overlay"
      // mousedown 기준 — 본문에서 드래그(텍스트 선택)하다 오버레이에서 놓아도 닫히지 않게
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        className={'modal' + (wide ? ' modal--wide' : '') + (tabs ? ' modal--tabbed' : '')}
        style={width ? ({ '--modal-w': `${width}px` } as CSSProperties) : undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={dialogRef}
        onKeyDown={onKeyDown}
      >
        <div className="modal__head">
          <div className="modal__titles">
            <h3 className="modal__title" id={titleId}>
              {title}
            </h3>
            {subtitle && <p className="modal__sub">{subtitle}</p>}
            {tabs}
          </div>
          <div className="modal__actions">
            {actions}
            <button
              type="button"
              className="icon-btn"
              aria-label="닫기"
              disabled={!closable}
              onClick={requestClose}
            >
              <Icon name="x" size={16} />
            </button>
          </div>
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
