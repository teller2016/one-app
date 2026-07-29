import type { InputHTMLAttributes, ReactNode } from 'react';

type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  /** 라벨 텍스트 — 클릭하면 함께 토글. 없으면 체크박스만 (aria-label 지정 권장) */
  label?: ReactNode;
  /** 위험 동작 확인용(운영 배포 등) — 체크 색이 danger 로 바뀐다 */
  danger?: boolean;
};

/** 공통 체크박스 — 라벨 래핑 포함. 스타일은 _base.scss 의 .checkbox */
export function Checkbox({
  label,
  danger = false,
  className,
  title,
  ...rest
}: CheckboxProps) {
  const cls =
    'checkbox' +
    (danger ? ' checkbox--danger' : '') +
    (className ? ` ${className}` : '');
  return (
    // title 은 라벨 전체에 걸어야 텍스트 위에서도 툴팁이 뜬다
    <label className={cls} title={title}>
      <input type="checkbox" {...rest} />
      {label != null && <span className="checkbox__label">{label}</span>}
    </label>
  );
}
