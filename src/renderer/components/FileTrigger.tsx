import type { ButtonHTMLAttributes } from 'react';

/** 입력처럼 보이는 파일 선택 트리거 버튼 (.ovpn 선택 등) */
export function FileTrigger({
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = 'filetrigger' + (className ? ` ${className}` : '');
  return <button type="button" className={cls} {...rest} />;
}
