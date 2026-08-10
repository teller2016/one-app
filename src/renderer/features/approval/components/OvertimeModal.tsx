import { useState } from 'react';
import { Modal } from '../../../components/Modal';
import { OvertimeForm } from './OvertimeForm';

/**
 * 야근 결재 모달 — 출퇴근 위젯에서 바로 여는 진입점.
 * 본문은 결재 섹션의 야근 폼을 그대로 쓴다(로직 중복 없음).
 * 상신 진행 중에는 dim·Escape·닫기 버튼으로 닫히지 않게 잠근다.
 */
export function OvertimeModal({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState(false);

  return (
    <Modal
      title="야근 결재 상신"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <OvertimeForm onBusyChange={setBusy} onDone={onClose} />
    </Modal>
  );
}
