// 메일 탭 — 데스크톱의 리더 모달을 '항상 열린 화면'으로 쓴다.
// MailModal 은 이미 목록 + 본문 슬라이드오버 구조라, 폰에서 필요한 '목록↔본문 전환'이
// 그대로 들어 있다(폭만 mo.scss 에서 100% 로 넓힌다). 그래서 래퍼가 이 정도로 얇다.
import { MailModal } from '../../renderer/features/mail';

export function MoMailView({ onExit }: { onExit: () => void }) {
  return <MailModal onClose={onExit} onRead={() => undefined} />;
}
