import type { ButtonHTMLAttributes } from 'react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** 색상 변형 — primary(파랑) · ghost(회색 테두리) · danger(빨강) */
  variant?: 'primary' | 'ghost' | 'danger';
};

/**
 * 공통 버튼 — 스타일은 _base.scss 의 .btn 계열을 사용한다.
 * 기능별 추가 스타일이 필요하면 className 으로 덧붙인다.
 */
export function Button({
  variant = 'ghost',
  className,
  type,
  ...rest
}: ButtonProps) {
  const cls = `btn btn--${variant}${className ? ` ${className}` : ''}`;
  return <button type={type ?? 'button'} className={cls} {...rest} />;
}
