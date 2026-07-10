import type { InputHTMLAttributes } from 'react';

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  /** 소형 변형 (위젯·설정 시각/분 입력) */
  small?: boolean;
};

/** 공통 텍스트 입력 — 스타일은 _base.scss 의 .input 사용 */
export function Input({ className, small = false, ...rest }: InputProps) {
  const cls =
    'input' + (small ? ' input--sm' : '') + (className ? ` ${className}` : '');
  return <input className={cls} autoComplete="off" {...rest} />;
}
