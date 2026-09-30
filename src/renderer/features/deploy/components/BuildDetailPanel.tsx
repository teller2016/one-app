import { useEffect, useRef, type ReactNode } from 'react';
import {
  isMergeCommit,
  type DeployBuildDetail,
  type DeployBuildSummary,
} from '../../../../shared/types';
import { formatTime, formatDuration, formatStamp } from '../lib/format';
import { JIRA_KEY_RE, jiraIssueUrl } from '../../../../shared/jira-url';
import { Button } from '../../../components/Button';
import { Icon } from '../../../components/Icon';
import { DeployLink } from './DeployLink';

/** 외부 링크 설정 — 커밋 해시(Gitea)·이슈 키(Jira) 링크화용 (미설정이면 평문) */
export type DetailLinks = {
  commitBase?: string | null; // 예: http://gitea/{owner}/{repo}/commit/
  jiraUrl?: string;
};

/** 텍스트 속 Jira 이슈 키(BBJ-1234)를 클릭 가능한 링크로 치환 */
function JiraText({ text, jiraUrl }: { text: string; jiraUrl?: string }) {
  if (!jiraUrl) return <>{text}</>;
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(JIRA_KEY_RE)) {
    const idx = m.index ?? 0;
    if (idx > last) nodes.push(text.slice(last, idx));
    const key = m[0];
    nodes.push(
      <DeployLink
        key={`${key}-${idx}`}
        mono
        className="deploy__key"
        title={`Jira 이슈 열기 — ${key}`}
        onClick={(e) => {
          e.stopPropagation();
          void window.oneApp.openExternal(jiraIssueUrl(jiraUrl, key));
        }}
      >
        {key}
      </DeployLink>,
    );
    last = idx + key.length;
  }
  if (nodes.length === 0) return <>{text}</>;
  if (last < text.length) nodes.push(text.slice(last));
  return <>{nodes}</>;
}

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
    b.building ? '빌드중' : (b.result ?? '결과 없음'),
    b.timestamp ? formatTime(b.timestamp) : '',
    b.duration != null && !b.building
      ? `${formatDuration(b.duration)} 소요`
      : '',
    b.startedBy ?? '',
  ]
    .filter(Boolean)
    .join(' · ');

/**
 * 콘솔 로그 본문 — 목업처럼 파이프라인 단계 줄은 흐리게, 최종 결과 줄은 결과 색으로.
 * 나머지 줄은 한 덩어리 글자로 묶어 둔다(64KB tail 이라 줄마다 요소를 만들지 않는다).
 */
function LogText({ text }: { text: string }) {
  const nodes: ReactNode[] = [];
  let buf = ''; // 색 없는 줄 묶음 (각 줄의 줄바꿈 포함)
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const nl = i < lines.length - 1 ? '\n' : '';
    const tone = line.startsWith('[Pipeline]')
      ? 'dim'
      : /^Finished: SUCCESS/.test(line)
        ? 'ok'
        : /^Finished: (FAILURE|ABORTED|UNSTABLE)/.test(line)
          ? 'fail'
          : null;
    if (!tone) {
      buf += line + nl;
      return;
    }
    if (buf) nodes.push(buf);
    nodes.push(
      <span key={i} className={`deploy__log-line deploy__log-line--${tone}`}>
        {line}
      </span>,
    );
    buf = nl;
  });
  if (buf) nodes.push(buf);
  return <>{nodes}</>;
}

/**
 * 빌드 상세 패널 — 목업 BuildDetailModal.dc.html: 이력 스트립 → 선택 빌드 머리 → 커밋 패널(남는 높이) →
 * 로그 바 → 콘솔 로그(176). 모달 폭 880 · 높이 744 는 `_deploy.scss` 의 `:has(.deploy__detail)` 가 준다.
 */
export function BuildDetailPanel({
  state,
  links,
  onSelectBuild,
  onToggleLog,
  onRefreshLog,
  onOpenConsole,
}: {
  state: DetailState;
  links?: DetailLinks;
  onSelectBuild: (buildNumber: number) => void;
  onToggleLog: () => void;
  onRefreshLog: () => void;
  onOpenConsole: (buildNumber: number) => void;
}) {
  const openCommit = (sha: string) => {
    if (!links?.commitBase) return;
    void window.oneApp.openExternal(`${links.commitBase}${sha}`);
  };
  const logRef = useRef<HTMLPreElement>(null);
  const log = state.log;

  // 로그가 갱신되면 맨 아래(최신)로 스크롤
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log?.text]);

  const d = state.detail;
  const selectedNumber = state.selected ?? d?.number;

  // 커밋 해시 — Gitea 주소가 있으면 링크, 없으면 모노 글자
  const sha = (id: string, len: number) =>
    links?.commitBase ? (
      <DeployLink
        mono
        title="Gitea 에서 커밋 보기"
        onClick={() => openCommit(id)}
      >
        {id.slice(0, len)}
      </DeployLink>
    ) : (
      <span className="deploy__mono">{id.slice(0, len)}</span>
    );

  return (
    <div className="deploy__detail">
      {/* 빌드 이력 — 클릭하면 해당 빌드의 커밋 내역으로 전환 */}
      {state.historyError ? (
        <p className="deploy__hint deploy__hint--warn">
          이력 조회 실패 — {state.historyError}
        </p>
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
        <p className="deploy__hint">불러오는 중...</p>
      ) : state.error ? (
        <p className="deploy__hint deploy__hint--error">
          <Icon name="alert-triangle" size={14} />
          {state.error}
        </p>
      ) : d ? (
        <>
          <div className="deploy__detail-meta">
            <span className="deploy__detail-head">
              <b className="deploy__mono">#{d.number}</b>
              {d.timestamp ? (
                <>
                  {' · 시작 '}
                  <span className="deploy__mono">
                    {formatStamp(d.timestamp)}
                  </span>
                </>
              ) : null}
              {d.duration != null && !d.building
                ? ` (${formatDuration(d.duration)} 소요)`
                : ''}
              {d.startedBy ? ` · ${d.startedBy}` : ''}
            </span>
            {(d.revision || d.branch || d.repoUrl) && (
              <span className="deploy__detail-git">
                {d.revision && sha(d.revision, 8)}
                {d.branch && <span> · {d.branch}</span>}
                {d.repoUrl && <span> · {d.repoUrl}</span>}
              </span>
            )}
          </div>
          <div className="deploy__commits">
            {d.commits.length === 0 ? (
              <p className="deploy__hint deploy__commits-empty">
                이 빌드에 포함된 변경(커밋)이 없습니다.
              </p>
            ) : (
              d.commits.map((c, i) => {
                const [title, ...rest] = c.message.split('\n');
                const body = rest.join('\n').trim();
                return (
                  <div
                    className={`deploy__commit${isMergeCommit(c) ? ' deploy__commit--merge' : ''}`}
                    key={c.id || i}
                  >
                    <span className="deploy__commit-title">
                      <JiraText text={title} jiraUrl={links?.jiraUrl} />
                    </span>
                    {body && (
                      <pre className="deploy__commit-body">
                        <JiraText text={body} jiraUrl={links?.jiraUrl} />
                      </pre>
                    )}
                    <span className="deploy__commit-meta">
                      {c.author}
                      {c.timestamp ? (
                        <>
                          {' · '}
                          <span className="deploy__mono">
                            {formatStamp(c.timestamp)}
                          </span>
                        </>
                      ) : null}
                      {c.id && (
                        <>
                          {' · '}
                          {sha(c.id, 7)}
                        </>
                      )}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </>
      ) : null}

      {/* 콘솔 로그 (선택한 빌드의 마지막 부분) */}
      {selectedNumber != null && (
        <div className="deploy__log-bar">
          <Button size="xs" onClick={onToggleLog}>
            콘솔 로그
            <Icon
              name={log?.open ? 'chevron-down' : 'chevron-right'}
              size={12}
            />
          </Button>
          {log?.open && (
            <>
              <Button size="xs" onClick={onRefreshLog} disabled={log.loading}>
                {log.loading ? '불러오는 중…' : '새로고침'}
              </Button>
              <DeployLink
                external
                className="deploy__log-open"
                onClick={() => onOpenConsole(selectedNumber)}
                title="젠킨스 콘솔 페이지 열기"
              >
                젠킨스에서 열기
              </DeployLink>
            </>
          )}
        </div>
      )}
      {log?.open &&
        (log.error ? (
          <div className="deploy__log deploy__log--error">
            <Icon name="alert-triangle" size={14} />
            {log.error}
          </div>
        ) : (
          <pre className="deploy__log" ref={logRef}>
            {log.truncated ? '…(앞부분 생략)\n' : ''}
            {log.text != null ? (
              <LogText text={log.text} />
            ) : log.loading ? (
              '불러오는 중...'
            ) : (
              '(로그 없음)'
            )}
          </pre>
        ))}
    </div>
  );
}
