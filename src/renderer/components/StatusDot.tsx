/**
 * 상태 점 — busy(경고색+펄스) · ok · fail · idle · run(초록+펄스, 에이전트 작업 중) · wait(주황, 펄스 없음 — 사람을 부르는 입력 대기).
 * sm 6px(뱃지 내 기본) / md 8px(VPN 위젯 등 단독 사용).
 */
export function StatusDot({
  status,
  md = false,
}: {
  status: 'busy' | 'ok' | 'fail' | 'idle' | 'run' | 'wait';
  md?: boolean;
}) {
  return (
    <span
      className={`status-dot status-dot--${status}${md ? ' status-dot--md' : ''}`}
      aria-hidden="true"
    />
  );
}
