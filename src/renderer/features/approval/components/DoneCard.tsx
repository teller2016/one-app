import type { ReactNode } from 'react';
import { Icon, type IconName } from '../../../components/Icon';

/** 결재 작업 완료 화면 — 아이콘 + 제목 + 안내 + 후속 버튼들 */
export function DoneCard({
  tone,
  icon,
  title,
  hint,
  children,
}: {
  tone: 'ok' | 'info' | 'warn';
  icon: IconName;
  title: string;
  hint: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={`approval-done approval-done--${tone}`}>
      <span className="approval-done__icon">
        <Icon name={icon} size={28} />
      </span>
      {title && <p className="approval-done__title">{title}</p>}
      <p className="approval-done__hint">{hint}</p>
      <div className="form-actions">{children}</div>
    </div>
  );
}
