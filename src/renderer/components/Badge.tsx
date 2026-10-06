import type { ReactNode } from 'react';
import { StatusDot } from './StatusDot';

type BadgeVariant = 'busy' | 'ok' | 'fail' | 'idle' | 'fresh' | 'pill' | 'accent';

/**
 * 상태 뱃지 — soft 배경 + 시맨틱 글자 + 상태 점.
 * pill 변형은 점 없는 정보형(기간·인원수 등), accent 는 점 없는 액센트 틴트(프로젝트 이름 등 — 목업 .b-accent).
 */
export function Badge({
  variant,
  children,
  title,
  dot = true,
}: {
  variant: BadgeVariant;
  children: ReactNode;
  title?: string;
  /** false 면 상태 점을 빼고 색 면·글자만 (목록 행의 상태 드롭다운 칩 등) */
  dot?: boolean;
}) {
  return (
    <span className={`badge badge--${variant}`} title={title}>
      {dot && variant !== 'pill' && variant !== 'accent' && <StatusDot status={variant} />}
      <span className="badge__label">{children}</span>
    </span>
  );
}
