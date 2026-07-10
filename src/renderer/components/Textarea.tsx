import type { TextareaHTMLAttributes } from 'react';

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  /** 코드성 입력 (모노스페이스 + 가라앉은 배경) */
  code?: boolean;
};

/** 공통 텍스트에어리어 — 스타일은 _base.scss 의 .input 계열 사용 */
export function Textarea({ className, code = false, ...rest }: TextareaProps) {
  const cls =
    'input' + (code ? ' input--code' : '') + (className ? ` ${className}` : '');
  return <textarea className={cls} {...rest} />;
}
