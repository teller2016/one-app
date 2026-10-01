// 메일 화면(더보기 › 메일) — 데스크톱의 리더 모달을 '항상 열린 화면'으로 쓴다.
// MailModal 은 이미 목록 + 본문 슬라이드오버 구조라, 폰에서 필요한 '목록↔본문 전환'이
// 그대로 들어 있다(폭만 mo.scss 에서 100% 로 넓힌다). 모달의 [×]·폰 뒤로가기 = 더보기로.
import { MailModal } from '../../renderer/features/mail';

export function MoMailView({
  onExit,
  onRead,
  onCount,
}: {
  onExit: () => void;
  /** 안 읽은 메일을 열어 읽음 처리됐을 때 — 탭바 배지 즉시 −1 */
  onRead: () => void;
  /** 목록을 불러오며 받은 안읽은 수 — 탭바 배지를 최신값으로. ⚠️ 안정된 참조(setState 등)만 */
  onCount: (n: number) => void;
}) {
  return <MailModal onClose={onExit} onRead={onRead} onCount={onCount} />;
}
