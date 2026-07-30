import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/** 완료·안내 결과 카드 (상신 완료 · 미리보기 안내 · 지출결의서 작성 완료 공용) */
export function DoneCard({
  tone = 'ok',
  icon,
  title,
  hint,
  children,
}: {
  /** ok=완료(초록) · info=안내(액센트) · fail=문제(빨강) */
  tone?: 'ok' | 'info' | 'fail';
  icon: IconName;
  title: string;
  hint: string;
  /** 액션 버튼들 */
  children: ReactNode;
}) {
  return (
    <div className="done-card">
      <span className={`done-card__icon done-card__icon--${tone}`}>
        <Icon name={icon} size={28} />
      </span>
      <p className="done-card__title">{title}</p>
      <p className="done-card__hint">{hint}</p>
      <div className="form-actions">{children}</div>
    </div>
  );
}
