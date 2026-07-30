import type { ReactNode } from 'react';

/** 폼의 한 행 — 라벨 + 입력 요소. column 이면 라벨이 위로 간다. */
export function FormRow({
  label,
  column = false,
  children,
}: {
  label?: ReactNode;
  column?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={'form-row' + (column ? ' form-row--col' : '')}>
      {label != null && <label className="form-row__label">{label}</label>}
      {children}
    </div>
  );
}
