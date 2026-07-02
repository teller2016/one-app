import type { InputHTMLAttributes } from 'react';

/** 공통 텍스트 입력 — 스타일은 _base.scss 의 .input 사용 */
export function Input({
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  const cls = `input${className ? ` ${className}` : ''}`;
  return <input className={cls} autoComplete="off" {...rest} />;
}
