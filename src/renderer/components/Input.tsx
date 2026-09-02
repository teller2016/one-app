import type { InputHTMLAttributes } from 'react';

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  /** 소형 변형 (위젯·설정 시각/분 입력) */
  small?: boolean;
  /**
   * 인라인 편집 변형 — 테두리·배경·포커스 링 없이 **글자만**.
   * 감싸는 요소가 이미 박스를 그리는 자리(세션 탭 이름 변경)용이다.
   * 자체 박스를 그리면 이중 테두리가 되어 그 자리에 캡슐이 떠 보인다.
   */
  bare?: boolean;
};

/** 공통 텍스트 입력 — 스타일은 _base.scss 의 .input 사용 */
export function Input({
  className,
  small = false,
  bare = false,
  ...rest
}: InputProps) {
  const cls =
    'input' +
    (small ? ' input--sm' : '') +
    (bare ? ' input--bare' : '') +
    (className ? ` ${className}` : '');
  return <input className={cls} autoComplete="off" {...rest} />;
}
