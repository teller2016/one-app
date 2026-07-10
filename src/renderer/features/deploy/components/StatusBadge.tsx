import type { DeployStatus } from '../../../../shared/types';
import { formatRelative, formatTime } from '../lib/format';
import { Badge } from '../../../components/Badge';

// 배지 옆 마지막 배포(완료) 시각 — 호버 시 정확한 완료 일시 툴팁
function FinishedTime({ ts }: { ts?: number }) {
  if (!ts) return null;
  return (
    <span className="badge-time" title={`완료: ${formatTime(ts)}`}>
      {formatRelative(ts)}
    </span>
  );
}

/** 배포 대상의 빌드 상태 배지 (완료 시 마지막 배포 시각 포함) */
export function StatusBadge({ status }: { status?: DeployStatus }) {
  if (!status || status.state === 'idle')
    return <Badge variant="idle">빌드 이력 없음</Badge>;
  const num = status.buildNumber ? ` #${status.buildNumber}` : '';
  switch (status.state) {
    case 'queued':
      return <Badge variant="busy">대기중</Badge>;
    case 'building':
      return <Badge variant="busy">빌드중{num}</Badge>;
    case 'success':
      return (
        <span className="deploy__status">
          <Badge variant="ok">성공{num}</Badge>
          <FinishedTime ts={status.finishedAt} />
        </span>
      );
    case 'failure':
      return (
        <span className="deploy__status">
          <Badge variant="fail">
            {status.result === 'ABORTED' ? '중단됨' : '실패'}
            {num}
          </Badge>
          <FinishedTime ts={status.finishedAt} />
        </span>
      );
    case 'error':
      // 오류 메시지가 길면 뱃지에서 말줄임 — 전체 내용은 툴팁으로
      return (
        <Badge variant="fail" title={status.error ?? undefined}>
          {status.error ?? '오류'}
        </Badge>
      );
  }
}
