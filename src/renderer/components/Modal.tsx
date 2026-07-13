import { useEffect, type ReactNode } from 'react';
import { Icon } from './Icon';

/**
 * 공통 모달 — 오버레이 + 패널(헤더·스크롤 본문). 스타일은 _base.scss 의 .modal 계열.
 * 열림 여부는 부모가 조건부 렌더로 제어한다: {open && <Modal ...>}
 * Escape 키·오버레이 클릭·닫기 버튼으로 onClose 가 호출된다.
 */
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** 넓은 콘텐츠(로그·표)용 확장 폭 */
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="modal-overlay"
      // mousedown 기준 — 본문에서 드래그(텍스트 선택)하다 오버레이에서 놓아도 닫히지 않게
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={'modal' + (wide ? ' modal--wide' : '')}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal__head">
          <h3 className="modal__title">{title}</h3>
          <button
            type="button"
            className="icon-btn"
            aria-label="닫기"
            onClick={onClose}
          >
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="modal__body">{children}</div>
      </div>
    </div>
  );
}
