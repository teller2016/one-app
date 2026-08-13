import type { ReactNode } from 'react';
import { Button } from '../../../components/Button';
import { Icon, type IconName } from '../../../components/Icon';
import { useEaBox } from '../lib/useEaBox';

/**
 * 결재 작업 완료 화면 — 아이콘 + 제목 + 안내 + [전자결재 상신함 열기].
 * 작성 창은 사용자가 그 창에서 직접 닫는다(앱이 닫아주는 버튼은 두지 않는다).
 */
export function DoneCard({
  tone,
  icon,
  title,
  hint,
}: {
  tone: 'ok' | 'info' | 'warn';
  icon: IconName;
  title: string;
  hint: ReactNode;
}) {
  // 상신함 열기는 결재 홈과 공유한다 (lib/useEaBox)
  const { opening, openEaBox } = useEaBox();

  return (
    <div className={`approval-done approval-done--${tone}`}>
      <span className="approval-done__icon">
        <Icon name={icon} size={28} />
      </span>
      {title && <p className="approval-done__title">{title}</p>}
      <p className="approval-done__hint">{hint}</p>
      <div className="form-actions">
        <Button variant="primary" loading={opening} onClick={() => void openEaBox()}>
          전자결재 상신함 열기
        </Button>
      </div>
    </div>
  );
}
