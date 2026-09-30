import { useState } from 'react';
import {
  isMergeCommit,
  type DeployCommit,
  type DeployProjectView,
  type DeployTarget,
  type DeployPreviewResult,
} from '../../../../shared/types';
import { extractIssueKeys, formatStamp } from '../lib/format';
import { Modal } from '../../../components/Modal';
import { Button } from '../../../components/Button';
import { Banner } from '../../../components/Banner';
import { Input } from '../../../components/Input';
import { Icon } from '../../../components/Icon';
import { Badge } from '../../../components/Badge';
import { IssueChip } from '../../../components/IssueChip';
import { useCopy } from '../../../lib/useCopy';

/**
 * 커밋 제목 + 티켓 번호를 줄줄이 — 배포 전 공유 메시지용.
 * (머지 커밋은 작업 내용이 아니라 제외)
 */
function buildShareText(
  commits: Pick<DeployCommit, 'message' | 'isMerge'>[],
): string {
  return commits
    .map((c) => {
      const title = c.message.split('\n')[0].trim();
      if (!title || isMergeCommit(c)) return '';
      // 제목에 이미 키가 있으면 뒤에 또 붙이지 않는다
      const keys = extractIssueKeys(c.message).filter(
        (k) => !title.includes(k),
      );
      return keys.length ? `${title} (${keys.join(', ')})` : title;
    })
    .filter(Boolean)
    .join('\n');
}

/** 배포 미리보기 로드 상태 */
export type PreviewState = {
  loading: boolean;
  result?: DeployPreviewResult;
};

/**
 * 배포 확인 모달 — 이번 배포에 포함될 커밋 미리보기(Gitea 비교) +
 * 운영(PROD) 프로젝트면 대상 이름 타이핑 확인을 요구한다.
 */
export function DeployConfirmModal({
  project,
  target,
  preview,
  jiraUrl,
  onConfirm,
  onClose,
}: {
  project: DeployProjectView;
  target: DeployTarget;
  preview: PreviewState;
  /** 환경설정의 Jira 주소 — 있으면 티켓 칩이 링크가 된다 */
  jiraUrl?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState('');
  const copy = useCopy();
  const prodOk = !project.production || typed.trim() === target.name;
  const r = preview.result;
  const shareText = buildShareText(r?.commits ?? []);
  // 이번 배포에 포함된 티켓 전체 (커밋 순서 유지·중복 제거)
  const allIssueKeys = [
    ...new Set((r?.commits ?? []).flatMap((c) => extractIssueKeys(c.message))),
  ];

  return (
    <Modal
      width={600}
      title={
        <span className="deploy__modal-title">
          {project.name} — {target.name} 배포
          {project.production && (
            <Badge variant="busy" dot={false}>
              PROD
            </Badge>
          )}
        </span>
      }
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>취소</Button>
          <Button
            variant={project.production ? 'danger' : 'primary'}
            onClick={onConfirm}
            disabled={!prodOk}
          >
            {project.production ? '운영 배포 실행' : '배포 시작'}
          </Button>
        </>
      }
    >
      <div className="deploy__confirm">
        {project.production && (
          <Banner variant="danger">
            <b>운영(PROD) 배포입니다.</b> 아래에 대상 이름을 입력해야 배포할 수
            있습니다.
          </Banner>
        )}

        {/* 이번 배포에 포함될 커밋 (Gitea 미설정이면 생략) */}
        {preview.loading ? (
          <p className="deploy__hint">이번 배포에 포함될 커밋을 확인하는 중…</p>
        ) : !r || !r.configured ? (
          <p className="deploy__hint">
            환경설정에 <b>Gitea 주소</b>를 입력하면 배포 전에 포함될 커밋을 미리
            볼 수 있습니다.
          </p>
        ) : !r.ok ? (
          <p className="deploy__hint deploy__hint--warn">
            <Icon name="alert-triangle" size={13} />
            미리보기 실패 — {r.error} (배포는 가능합니다)
          </p>
        ) : (
          <div className="deploy__preview">
            <div className="deploy__preview-head">
              <span className="deploy__preview-count">
                마지막 빌드 이후 새 커밋 <b>{r.totalCommits ?? 0}개</b>
                {r.branch && (
                  <span className="deploy__preview-branch"> ({r.branch})</span>
                )}
              </span>
              {shareText && (
                <Button
                  size="xs"
                  variant="plain"
                  onClick={() =>
                    void copy(shareText, {
                      success:
                        '작업 내용이 복사되었습니다 — 공유 채널에 붙여넣으세요',
                    })
                  }
                >
                  <Icon name="copy" size={12} />
                  작업 내용 복사
                </Button>
              )}
              {r.compareUrl && (
                <Button
                  size="xs"
                  variant="plain"
                  onClick={() =>
                    void window.oneApp.openExternal(r.compareUrl as string)
                  }
                >
                  <Icon name="arrow-up-right" size={12} />
                  Gitea 에서 비교
                </Button>
              )}
            </div>
            {(r.commits ?? []).length === 0 ? (
              <Banner>
                마지막 빌드 이후 <b>새 커밋이 없습니다</b> — 같은 내용이 다시
                배포됩니다.
              </Banner>
            ) : (
              <>
                {allIssueKeys.length > 0 && (
                  <div className="deploy__preview-issues">
                    <span>포함 티켓 {allIssueKeys.length}건</span>
                    {allIssueKeys.map((k) => (
                      <IssueChip key={k} issueKey={k} jiraUrl={jiraUrl} />
                    ))}
                  </div>
                )}
                <ul className="deploy__preview-list">
                  {(r.commits ?? []).map((c, i) => {
                    const title = c.message.split('\n')[0];
                    const keys = extractIssueKeys(c.message);
                    return (
                      <li
                        key={c.id || i}
                        className={
                          isMergeCommit(c)
                            ? 'deploy__preview-item--merge'
                            : undefined
                        }
                      >
                        <span className="deploy__preview-row">
                          <span className="deploy__preview-msg" title={title}>
                            {title}
                          </span>
                          {keys.map((k) => (
                            <IssueChip key={k} issueKey={k} jiraUrl={jiraUrl} />
                          ))}
                        </span>
                        {/* 목업은 줄 전체가 모노 — 작성자는 한글일 수 있어 시각·해시만 모노 */}
                        <span className="deploy__preview-meta">
                          {c.author}
                          {c.timestamp ? (
                            <>
                              {' · '}
                              <span className="deploy__mono">
                                {formatStamp(c.timestamp)}
                              </span>
                            </>
                          ) : null}
                          {c.id ? (
                            <>
                              {' · '}
                              <span className="deploy__mono">
                                {c.id.slice(0, 7)}
                              </span>
                            </>
                          ) : null}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </div>
        )}

        {project.production && (
          <>
            <div className="deploy__divider" />
            <div className="deploy__prod-confirm">
              <label htmlFor="deploy-confirm-name">
                확인을 위해 대상 이름(
                <span className="deploy__prod-name">{target.name}</span>)을
                입력하세요
              </label>
              <Input
                id="deploy-confirm-name"
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={target.name}
                autoFocus
              />
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
