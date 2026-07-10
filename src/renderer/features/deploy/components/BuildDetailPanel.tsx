import type { DeployBuildDetail } from '../../../../shared/types';
import { formatTime, formatDuration } from '../lib/format';
import { Icon } from '../../../components/Icon';

/** 커밋 내역 펼침 패널 상태 */
export type DetailState = {
  open: boolean;
  loading: boolean;
  detail?: DeployBuildDetail;
  error?: string;
};

/** 빌드 상세(커밋 내역·시작자·revision) 패널 */
export function BuildDetailPanel({ state }: { state: DetailState }) {
  if (state.loading)
    return (
      <div className="panel-sunken deploy__detail deploy__detail--loading">
        불러오는 중...
      </div>
    );
  if (state.error)
    return (
      <div className="panel-sunken deploy__detail deploy__detail--error">
        <Icon name="alert-triangle" size={14} />
        {state.error}
      </div>
    );
  const d = state.detail;
  if (!d) return null;

  return (
    <div className="panel-sunken deploy__detail">
      <div className="deploy__detail-head">
        <b>#{d.number}</b>
        {d.timestamp ? ` · 시작 ${formatTime(d.timestamp)}` : ''}
        {d.duration != null && !d.building
          ? ` (${formatDuration(d.duration)} 소요)`
          : ''}
        {d.startedBy ? ` · ${d.startedBy}` : ''}
      </div>
      {(d.revision || d.branch || d.repoUrl) && (
        <div className="deploy__detail-git">
          {d.revision && <code>{d.revision.slice(0, 8)}</code>}
          {d.branch && <span> · {d.branch}</span>}
          {d.repoUrl && <span> · {d.repoUrl}</span>}
        </div>
      )}
      {d.commits.length === 0 ? (
        <p className="deploy__detail-empty">
          이 빌드에 포함된 변경(커밋)이 없습니다.
        </p>
      ) : (
        d.commits.map((c, i) => {
          const [title, ...rest] = c.message.split('\n');
          const body = rest.join('\n').trim();
          return (
            <div className="deploy__commit" key={c.id || i}>
              <div className="deploy__commit-title">{title}</div>
              {body && <pre className="deploy__commit-body">{body}</pre>}
              <div className="deploy__commit-meta">
                {c.author}
                {c.timestamp ? ` · ${formatTime(c.timestamp)}` : ''}
                {c.id ? ` · ${c.id.slice(0, 7)}` : ''}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
