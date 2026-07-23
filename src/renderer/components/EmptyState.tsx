import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/** 목록·결과가 비었을 때의 공통 표시 — [아이콘] + 메시지 + 힌트 (_base.scss .empty-state) */
export function EmptyState({
  icon,
  message,
  hint,
}: {
  icon?: IconName;
  message: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon && (
        <span className="empty-state__icon">
          <Icon name={icon} size={20} />
        </span>
      )}
      <p>{message}</p>
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}
