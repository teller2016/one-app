import type { ReactNode } from 'react';
import { StatusDot } from './StatusDot';

type BadgeVariant = 'busy' | 'ok' | 'fail' | 'idle' | 'pill';

/**
 * 상태 뱃지 — soft 배경 + 시맨틱 글자 + 상태 점.
 * pill 변형은 점 없는 정보형(기간·인원수 등).
 */
export function Badge({
  variant,
  children,
  title,
}: {
  variant: BadgeVariant;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className={`badge badge--${variant}`} title={title}>
      {variant !== 'pill' && <StatusDot status={variant} />}
      <span className="badge__label">{children}</span>
    </span>
  );
}
