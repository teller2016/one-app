import type { InputHTMLAttributes, ReactNode } from 'react';

type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  /** 라벨 텍스트 — 클릭하면 함께 토글 */
  label?: ReactNode;
};

/** 공통 체크박스 — 라벨 래핑 포함. 스타일은 _base.scss 의 .checkbox */
export function Checkbox({ label, className, title, ...rest }: CheckboxProps) {
  return (
    // title 은 라벨 전체에 걸어야 텍스트 위에서도 툴팁이 뜬다
    <label className={'checkbox' + (className ? ` ${className}` : '')} title={title}>
      <input type="checkbox" {...rest} />
      {label != null && <span className="checkbox__label">{label}</span>}
    </label>
  );
}
