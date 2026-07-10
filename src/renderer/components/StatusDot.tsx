/**
 * 상태 점 — busy(경고색+펄스) · ok · fail · idle.
 * sm 6px(뱃지 내 기본) / md 8px(VPN 위젯 등 단독 사용).
 */
export function StatusDot({
  status,
  md = false,
}: {
  status: 'busy' | 'ok' | 'fail' | 'idle';
  md?: boolean;
}) {
  return (
    <span
      className={`status-dot status-dot--${status}${md ? ' status-dot--md' : ''}`}
      aria-hidden="true"
    />
  );
}
