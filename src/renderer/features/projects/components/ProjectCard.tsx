import type { Project } from '../../../../shared/types';
import { Badge } from '../../../components/Badge';
import { Button } from '../../../components/Button';
import { Icon } from '../../../components/Icon';
import { REMOTE_KIND_LABELS } from './ProjectForm';

type Props = {
  project: Project;
  onEdit: () => void;
  onDelete: () => void;
};

/**
 * 프로젝트 카드 — 이름·원격 뱃지·로컬 경로·메타(원격 주소/브랜치/Jira 키).
 * 목업 Projects.dc.html: 카드 padding 14 16 · gap 8, 이름 15/600, 경로 모노 12, 메타 12 · gap 14.
 */
export function ProjectCard({ project: p, onEdit, onDelete }: Props) {
  const webRemote = !!p.remoteUrl && /^https?:\/\//.test(p.remoteUrl);
  return (
    <div className="projects__card">
      <div className="projects__card-head">
        <span className="projects__name">{p.name}</span>
        {p.remoteUrl && (
          <Badge variant="pill">{REMOTE_KIND_LABELS[p.remoteKind]}</Badge>
        )}
        <span className="projects__spacer" />
        <Button size="xs" onClick={onEdit}>
          편집
        </Button>
        <Button size="xs" variant="danger" onClick={onDelete}>
          삭제
        </Button>
      </div>

      <div className="projects__path" title={p.localPath}>
        {p.localPath}
      </div>

      {(p.remoteUrl || p.defaultBranch || p.jiraProjectKey) && (
        <div className="projects__meta">
          {p.remoteUrl &&
            (webRemote ? (
              <button
                type="button"
                className="projects__remote"
                onClick={() => void window.oneApp.openExternal(p.remoteUrl)}
                title="원격 저장소 열기"
              >
                {p.remoteUrl}
                <Icon name="arrow-up-right" size={12} />
              </button>
            ) : (
              <span
                className="projects__remote projects__remote--plain"
                title="원격 저장소 주소"
              >
                {p.remoteUrl}
              </span>
            ))}
          {p.defaultBranch && (
            <span>
              브랜치{' '}
              <span className="projects__meta-val">{p.defaultBranch}</span>
            </span>
          )}
          {p.jiraProjectKey && (
            <span>
              Jira{' '}
              <span className="projects__meta-val">{p.jiraProjectKey}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
