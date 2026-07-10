import type { ButtonHTMLAttributes } from 'react';
import { Icon } from './Icon';

type TextLinkProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** 소형 (URL 등 보조 위치) */
  small?: boolean;
  /** 외부 링크 화살표 아이콘 표시 */
  external?: boolean;
};

/** 링크형 버튼 — 젠킨스 URL·잡 이름 등 클릭 가능한 텍스트 */
export function TextLink({
  small = false,
  external = false,
  className,
  children,
  ...rest
}: TextLinkProps) {
  const cls =
    'textlink' +
    (small ? ' textlink--sm' : '') +
    (className ? ` ${className}` : '');
  return (
    <button type="button" className={cls} {...rest}>
      {children}
      {external && <Icon name="arrow-up-right" size={12} />}
    </button>
  );
}
