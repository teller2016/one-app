import type { DeployStatus } from '../../../../shared/types';
import { formatRelative, formatTime } from '../lib/format';

// 배지 옆 마지막 배포(완료) 시각 — 호버 시 정확한 완료 일시 툴팁
function FinishedTime({ ts }: { ts?: number }) {
  if (!ts) return null;
  return (
    <span className="deploy__badge-time" title={`완료: ${formatTime(ts)}`}>
      {formatRelative(ts)}
    </span>
  );
}

/** 배포 대상의 빌드 상태 배지 (완료 시 마지막 배포 시각 포함) */
export function StatusBadge({ status }: { status?: DeployStatus }) {
  if (!status || status.state === 'idle')
    return <span className="deploy__badge">빌드 이력 없음</span>;
  const num = status.buildNumber ? ` #${status.buildNumber}` : '';
  switch (status.state) {
    case 'queued':
      return (
        <span className="deploy__badge deploy__badge--busy">⏳ 대기중</span>
      );
    case 'building':
      return (
        <span className="deploy__badge deploy__badge--busy">
          🔄 빌드중{num}
        </span>
      );
    case 'success':
      return (
        <>
          <span className="deploy__badge deploy__badge--ok">✅ 성공{num}</span>
          <FinishedTime ts={status.finishedAt} />
        </>
      );
    case 'failure':
      return (
        <>
          <span className="deploy__badge deploy__badge--fail">
            ❌ {status.result === 'ABORTED' ? '중단됨' : '실패'}
            {num}
          </span>
          <FinishedTime ts={status.finishedAt} />
        </>
      );
    case 'error':
      return (
        <span className="deploy__badge deploy__badge--fail">
          ⚠️ {status.error ?? '오류'}
        </span>
      );
  }
}
