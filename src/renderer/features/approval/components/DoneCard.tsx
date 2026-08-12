import { useState, type ReactNode } from 'react';
import { Button } from '../../../components/Button';
import { Icon, type IconName } from '../../../components/Icon';
import { useToast } from '../../../components/Toast';

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
  const toast = useToast();
  const [opening, setOpening] = useState(false);

  // 전자결재 상신함 — 올린 문서의 진행 상태를 확인하는 경로 (작성 창과 별개 창)
  const openEaBox = async () => {
    setOpening(true);
    const res = await window.oneApp.approval.openEaBox();
    setOpening(false);
    if (!res.ok) toast(res.error ?? '전자결재 상신함을 열지 못했습니다.', 'fail');
  };

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
