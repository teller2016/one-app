import type { ButtonHTMLAttributes } from 'react';

type RefreshButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** 갱신 중이면 아이콘이 회전한다 */
  spinning?: boolean;
  /** 테두리 있는 박스형 (카드 액션 영역용) */
  bordered?: boolean;
  /** 아이콘 크기(px) */
  size?: number;
};

/** 새로고침 아이콘 버튼 — 스타일은 _base.scss 의 .icon-btn 사용 */
export function RefreshButton({
  spinning = false,
  bordered = false,
  size = 13,
  className,
  ...rest
}: RefreshButtonProps) {
  const cls =
    'icon-btn' +
    (bordered ? ' icon-btn--bordered' : '') +
    (className ? ` ${className}` : '');
  return (
    <button type="button" className={cls} aria-label="새로고침" {...rest}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={spinning ? 'icon-btn__spin' : undefined}
      >
        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
        <path d="M21 3v6h-6" />
      </svg>
    </button>
  );
}
