import type { ButtonHTMLAttributes } from 'react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** 색상 변형 — primary(액센트) · ghost(표면+테두리) · danger(위험) */
  variant?: 'primary' | 'ghost' | 'danger';
  /** 크기 — md(기본 32) · sm(28 — 위젯·카드 액션) · xs(24 — 툴바 칩·탭바 [+]) */
  size?: 'md' | 'sm' | 'xs';
  /** 로딩 중 — 스피너 표시 + 자동 disabled */
  loading?: boolean;
};

/**
 * 공통 버튼 — 스타일은 _base.scss 의 .btn 계열을 사용한다.
 * 기능별 추가 스타일이 필요하면 className 으로 덧붙인다.
 */
export function Button({
  variant = 'ghost',
  size = 'md',
  loading = false,
  className,
  type,
  disabled,
  children,
  ...rest
}: ButtonProps) {
  const cls =
    `btn btn--${variant}` +
    (size === 'sm' ? ' btn--sm' : size === 'xs' ? ' btn--xs' : '') +
    (className ? ` ${className}` : '');
  return (
    <button
      type={type ?? 'button'}
      className={cls}
      disabled={disabled || loading}
      {...rest}
    >
      {loading && <span className="btn__spin" aria-hidden="true" />}
      {children}
    </button>
  );
}
