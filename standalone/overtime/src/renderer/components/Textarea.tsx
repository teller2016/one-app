import type { TextareaHTMLAttributes } from 'react';

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

/** 공통 텍스트에어리어 — 스타일은 _base.scss 의 .input 계열 사용 */
export function Textarea({ className, ...rest }: TextareaProps) {
  return <textarea className={'input' + (className ? ` ${className}` : '')} {...rest} />;
}
