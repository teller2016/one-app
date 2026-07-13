import { useState } from 'react';
import type {
  DeployProjectView,
  DeployTarget,
  DeployPreviewResult,
} from '../../../../shared/types';
import { formatTime } from '../lib/format';
import { Modal } from '../../../components/Modal';
import { Button } from '../../../components/Button';
import { Banner } from '../../../components/Banner';
import { Input } from '../../../components/Input';
import { Icon } from '../../../components/Icon';
import { TextLink } from '../../../components/TextLink';

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
  onConfirm,
  onClose,
}: {
  project: DeployProjectView;
  target: DeployTarget;
  preview: PreviewState;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState('');
  const prodOk = !project.production || typed.trim() === target.name;
  const r = preview.result;

  return (
    <Modal title={`${project.name} — ${target.name} 배포`} onClose={onClose}>
      {project.production && (
        <Banner variant="danger">
          <b>운영(PROD) 배포입니다.</b> 아래에 대상 이름을 입력해야 배포할 수
          있습니다.
        </Banner>
      )}

      {/* 이번 배포에 포함될 커밋 (Gitea 미설정이면 생략) */}
      {preview.loading ? (
        <p className="deploy__preview-note">
          이번 배포에 포함될 커밋을 확인하는 중…
        </p>
      ) : !r || !r.configured ? (
        <p className="deploy__preview-note">
          환경설정에 <b>Gitea 주소</b>를 입력하면 배포 전에 포함될 커밋을 미리
          볼 수 있습니다.
        </p>
      ) : !r.ok ? (
        <p className="deploy__preview-note deploy__preview-note--warn">
          <Icon name="alert-triangle" size={13} />
          미리보기 실패 — {r.error} (배포는 가능합니다)
        </p>
      ) : (
        <div className="deploy__preview">
          <div className="deploy__preview-head">
            <span>
              마지막 빌드 이후 새 커밋 <b>{r.totalCommits ?? 0}개</b>
              {r.branch ? ` (${r.branch})` : ''}
            </span>
            {r.compareUrl && (
              <TextLink
                small
                external
                onClick={() => void window.oneApp.openExternal(r.compareUrl as string)}
              >
                Gitea 에서 비교
              </TextLink>
            )}
          </div>
          {(r.commits ?? []).length === 0 ? (
            <Banner>
              마지막 빌드 이후 <b>새 커밋이 없습니다</b> — 같은 내용이 다시
              배포됩니다.
            </Banner>
          ) : (
            <ul className="deploy__preview-list">
              {(r.commits ?? []).map((c, i) => (
                <li key={c.id || i}>
                  <span className="deploy__preview-msg">
                    {c.message.split('\n')[0]}
                  </span>
                  <span className="deploy__preview-meta">
                    {c.author}
                    {c.timestamp ? ` · ${formatTime(c.timestamp)}` : ''}
                    {c.id ? ` · ${c.id.slice(0, 7)}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {project.production && (
        <div className="deploy__prod-confirm">
          <label className="form-label">
            확인을 위해 대상 이름(<code>{target.name}</code>)을 입력하세요
          </label>
          <Input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={target.name}
            autoFocus
          />
        </div>
      )}

      <div className="form-actions">
        <Button
          variant={project.production ? 'danger' : 'primary'}
          onClick={onConfirm}
          disabled={!prodOk}
        >
          {project.production ? '운영 배포 실행' : '배포 시작'}
        </Button>
        <Button onClick={onClose}>취소</Button>
      </div>
    </Modal>
  );
}
