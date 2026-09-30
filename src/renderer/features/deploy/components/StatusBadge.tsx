import type { DeployStatus } from '../../../../shared/types';
import { formatDuration, formatRelative, formatTime } from '../lib/format';
import { Badge } from '../../../components/Badge';

/**
 * 빌드중 진행률 — 진행바 + 경과 시간 / 예상 소요 (예상치 없으면 경과만).
 * 목업 Deploy.dc.html: 바 flex 1 · 6px · 액센트 채움, 글자 11.5 보조 잉크.
 * ⚠️ 시작 시각·예상치가 아직 없어도 **빈 트랙을 그려 자리를 유지**한다 —
 * 트랙을 안 그리면 보조 줄에서 [중지] 를 밀어주던 요소가 사라져 버튼이 좌측으로 쏠린다.
 */
export function BuildProgress({ status }: { status: DeployStatus }) {
  if (status.state !== 'building') return null;
  // 시작 시각을 아직 못 받았거나(트리거 직후) 시계가 어긋난 경우 = 진행률 미상
  const raw = status.startedAt ? Date.now() - status.startedAt : -1;
  const elapsed = raw >= 0 ? raw : null;
  // 예상보다 오래 걸려도 바가 넘치지 않게 97%에서 멈춘다
  const pct =
    elapsed != null && status.estimatedMs
      ? Math.min(97, Math.round((elapsed / status.estimatedMs) * 100))
      : 0;
  return (
    <>
      <span
        className="deploy__bar"
        title={
          status.estimatedMs
            ? `예상 소요 약 ${formatDuration(status.estimatedMs)} (최근 빌드 기준)`
            : undefined
        }
      >
        <i style={{ width: `${pct}%` }} />
      </span>
      <span className="deploy__bar-text">
        {elapsed == null
          ? '시작 중…'
          : status.estimatedMs
            ? `${formatDuration(elapsed)} / 약 ${formatDuration(status.estimatedMs)}`
            : `${formatDuration(elapsed)} 경과`}
      </span>
    </>
  );
}

/** 배지 옆 보조 시각 — 목업: 뱃지와 떨어진 11.5 메타 글자, 호버 시 정확한 일시 툴팁 */
function MetaTime({
  ts,
  suffix = '',
  label,
}: {
  ts?: number | null;
  suffix?: string;
  label: string;
}) {
  if (!ts) return null;
  return (
    <span className="deploy__time" title={`${label}: ${formatTime(ts)}`}>
      {formatRelative(ts)}
      {suffix}
    </span>
  );
}

/**
 * 배포 대상의 빌드 상태 배지 + 보조 시각 (대상 행에 그대로 펼쳐진다 — 행의 gap 10 을 공유).
 * 목업 색: 성공 ok · 빌드중/대기 액센트 · 실패/중단/오류 err · 이력 없음 회색.
 */
export function StatusBadge({ status }: { status?: DeployStatus }) {
  if (!status || status.state === 'idle')
    return <Badge variant="idle">빌드 이력 없음</Badge>;
  const num = status.buildNumber ? ` #${status.buildNumber}` : '';
  switch (status.state) {
    case 'queued':
      // 다른 빌드에 밀려 대기 중 — 사유는 툴팁, 대기 경과는 배지 옆에 표시
      return (
        <>
          <Badge variant="busy" title={status.queueWhy ?? undefined}>
            대기중
          </Badge>
          <MetaTime ts={status.queuedSince} suffix="부터" label="대기 시작" />
        </>
      );
    case 'building':
      return <Badge variant="busy">빌드중{num}</Badge>;
    case 'success':
      return (
        <>
          <Badge variant="ok">성공{num}</Badge>
          <MetaTime ts={status.finishedAt} label="완료" />
        </>
      );
    case 'failure':
      return (
        <>
          <Badge variant="fail">
            {status.result === 'ABORTED' ? '중단됨' : '실패'}
            {num}
          </Badge>
          <MetaTime ts={status.finishedAt} label="완료" />
        </>
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
