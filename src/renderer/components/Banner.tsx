import type { ReactNode } from 'react';
import { Icon } from './Icon';

type BannerVariant = 'warning' | 'danger' | 'info';

/** 경고/오류/안내 배너 — soft 배경 + 시맨틱 색 + 아이콘 */
export function Banner({
  variant = 'warning',
  children,
}: {
  variant?: BannerVariant;
  children: ReactNode;
}) {
  return (
    <div className={`banner banner--${variant}`}>
      <span className="banner__icon">
        <Icon name={variant === 'info' ? 'info' : 'alert-triangle'} size={16} />
      </span>
      <div>{children}</div>
    </div>
  );
}
