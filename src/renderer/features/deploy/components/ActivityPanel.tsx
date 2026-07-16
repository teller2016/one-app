import type { DeployActivity } from '../../../../shared/types';
import { formatRelative, formatDuration, formatTime } from '../lib/format';
import { Badge } from '../../../components/Badge';
import { StatusDot } from '../../../components/StatusDot';
import { RefreshButton } from '../../../components/RefreshButton';

type ActivityPanelProps = {
  activity: DeployActivity | null;
  loading: boolean;
  error?: string;
  onRefresh: () => void;
  onOpen: (url: string) => void;
};

/**
 * 젠킨스 서버 현황(실행 중 + 대기) — 프로젝트 카드의 [현황] 팝업 본문.
 * "다른 빌드에 밀려 대기 중인지"를 판단하기 위한 목록.
 */
export function ActivityPanel({
  activity,
  loading,
  error,
  onRefresh,
  onOpen,
}: ActivityPanelProps) {
  const running = activity?.running ?? [];
  const queued = activity?.queued ?? [];
  const empty = running.length === 0 && queued.length === 0;

  return (
    <div className="deploy__activity">
      <div className="deploy__activity-head">
        <span className="deploy__activity-counts">
          실행 {running.length} · 대기 {queued.length}
        </span>
        <RefreshButton spinning={loading} onClick={onRefresh} />
      </div>

      {error ? (
        <p className="hint deploy__activity-error">{error}</p>
      ) : loading && !activity ? (
        <p className="hint">불러오는 중…</p>
      ) : empty ? (
        <p className="hint">지금 실행 중이거나 대기 중인 빌드가 없습니다.</p>
      ) : (
        <>
          {running.length > 0 && (
            <div className="deploy__activity-group">
              <h4 className="deploy__activity-label">실행 중</h4>
              <ul className="deploy__activity-list">
                {running.map((b, i) => (
                  <li key={`r-${i}`} className="deploy__activity-row">
                    <StatusDot status="busy" />
                    <div className="deploy__activity-main">
                      {b.url ? (
                        <button
                          type="button"
                          className="deploy__activity-name deploy__activity-name--link"
                          onClick={() => onOpen(b.url as string)}
                          title="젠킨스에서 열기"
                        >
                          {b.name}
                        </button>
                      ) : (
                        <span className="deploy__activity-name">{b.name}</span>
                      )}
                      <span className="deploy__activity-meta">
                        {b.startedAt != null && (
                          <span title={`시작: ${formatTime(b.startedAt)}`}>
                            {formatRelative(b.startedAt)} 시작
                          </span>
                        )}
                        {b.estimatedMs != null && (
                          <span>예상 {formatDuration(b.estimatedMs)}</span>
                        )}
                        {b.node && <span>{b.node}</span>}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {queued.length > 0 && (
            <div className="deploy__activity-group">
              <h4 className="deploy__activity-label">대기 중</h4>
              <ul className="deploy__activity-list">
                {queued.map((q) => (
                  <li key={`q-${q.id}`} className="deploy__activity-row">
                    <StatusDot status="idle" />
                    <div className="deploy__activity-main">
                      <span className="deploy__activity-name">{q.name}</span>
                      <span className="deploy__activity-meta">
                        {q.since != null && (
                          <span title={`대기 시작: ${formatTime(q.since)}`}>
                            {formatRelative(q.since)}부터 대기
                          </span>
                        )}
                        {q.why && (
                          <span className="deploy__activity-why" title={q.why}>
                            {q.why}
                          </span>
                        )}
                        {q.stuck && <Badge variant="fail">정체</Badge>}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
