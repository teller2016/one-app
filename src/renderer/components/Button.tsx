import type { ButtonHTMLAttributes } from 'react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** 색상 변형 — primary(액센트) · ghost(표면+테두리) · danger(위험) */
  variant?: 'primary' | 'ghost' | 'danger';
  /** 크기 — md(기본) · sm(위젯·카드 액션용) */
  size?: 'md' | 'sm';
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
    (size === 'sm' ? ' btn--sm' : '') +
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
