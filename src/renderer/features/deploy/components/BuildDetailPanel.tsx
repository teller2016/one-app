import { useEffect, useRef } from 'react';
import type {
  DeployBuildDetail,
  DeployBuildSummary,
} from '../../../../shared/types';
import { formatTime, formatDuration } from '../lib/format';
import { Button } from '../../../components/Button';
import { Icon } from '../../../components/Icon';
import { TextLink } from '../../../components/TextLink';

/** 콘솔 로그 박스 상태 */
export type LogState = {
  open: boolean;
  loading: boolean;
  text?: string;
  truncated?: boolean; // 앞부분 생략 여부 (tail 만 조회)
  error?: string;
};

/** 커밋 내역 펼침 패널 상태 — 이력·선택 빌드·로그 포함 */
export type DetailState = {
  open: boolean;
  loading: boolean;
  detail?: DeployBuildDetail;
  error?: string;
  history?: DeployBuildSummary[];
  historyError?: string;
  selected?: number; // 이력에서 선택한 빌드 번호 (기본: 최근 빌드)
  log?: LogState;
};

const toneOf = (b: DeployBuildSummary) =>
  b.building ? 'busy' : b.result === 'SUCCESS' ? 'ok' : 'fail';

const histTitle = (b: DeployBuildSummary) =>
  [
    b.building ? '빌드중' : b.result ?? '결과 없음',
    b.timestamp ? formatTime(b.timestamp) : '',
    b.duration != null && !b.building ? `${formatDuration(b.duration)} 소요` : '',
    b.startedBy ?? '',
  ]
    .filter(Boolean)
    .join(' · ');

/** 빌드 상세 패널 — 이력 스트립 + 선택 빌드 커밋 내역 + 콘솔 로그 */
export function BuildDetailPanel({
  state,
  onSelectBuild,
  onToggleLog,
  onRefreshLog,
  onOpenConsole,
}: {
  state: DetailState;
  onSelectBuild: (buildNumber: number) => void;
  onToggleLog: () => void;
  onRefreshLog: () => void;
  onOpenConsole: (buildNumber: number) => void;
}) {
  const logRef = useRef<HTMLPreElement>(null);
  const log = state.log;

  // 로그가 갱신되면 맨 아래(최신)로 스크롤
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log?.text]);

  const d = state.detail;
  const selectedNumber = state.selected ?? d?.number;

  return (
    <div className="deploy__detail">
      {/* 빌드 이력 — 클릭하면 해당 빌드의 커밋 내역으로 전환 */}
      {state.historyError ? (
        <p className="deploy__detail-empty">이력 조회 실패 — {state.historyError}</p>
      ) : state.history && state.history.length > 0 ? (
        <div className="deploy__hist">
          {state.history.map((b) => (
            <button
              key={b.number}
              type="button"
              className={
                `deploy__hist-item deploy__hist-item--${toneOf(b)}` +
                (b.number === selectedNumber ? ' is-selected' : '')
              }
              title={histTitle(b)}
              onClick={() => onSelectBuild(b.number)}
            >
              #{b.number}
            </button>
          ))}
        </div>
      ) : null}

      {/* 선택한 빌드 상세 (커밋 내역) */}
      {state.loading ? (
        <div className="deploy__detail--loading">불러오는 중...</div>
      ) : state.error ? (
        <div className="deploy__detail--error">
          <Icon name="alert-triangle" size={14} />
          {state.error}
        </div>
      ) : d ? (
        <>
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
        </>
      ) : null}

      {/* 콘솔 로그 (선택한 빌드의 마지막 부분) */}
      {selectedNumber != null && (
        <div className="deploy__log-bar">
          <Button size="sm" onClick={onToggleLog}>
            콘솔 로그
            <Icon name={log?.open ? 'chevron-down' : 'chevron-right'} size={12} />
          </Button>
          {log?.open && (
            <>
              <Button size="sm" onClick={onRefreshLog} disabled={log.loading}>
                {log.loading ? '불러오는 중…' : '새로고침'}
              </Button>
              <TextLink
                small
                external
                onClick={() => onOpenConsole(selectedNumber)}
                title="젠킨스 콘솔 페이지 열기"
              >
                젠킨스에서 열기
              </TextLink>
            </>
          )}
        </div>
      )}
      {log?.open &&
        (log.error ? (
          <div className="panel-sunken panel-sunken--log deploy__log deploy__detail--error">
            <Icon name="alert-triangle" size={14} />
            {log.error}
          </div>
        ) : (
          <pre className="panel-sunken panel-sunken--log deploy__log" ref={logRef}>
            {log.truncated ? '…(앞부분 생략)\n' : ''}
            {log.text ?? (log.loading ? '불러오는 중...' : '(로그 없음)')}
          </pre>
        ))}
    </div>
  );
}
