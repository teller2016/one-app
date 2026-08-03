import type { Project } from '../../../../shared/types';
import { Badge } from '../../../components/Badge';
import { Button } from '../../../components/Button';
import { TextLink } from '../../../components/TextLink';
import { REMOTE_KIND_LABELS } from './ProjectForm';

type Props = {
  project: Project;
  onEdit: () => void;
  onDelete: () => void;
};

/** 프로젝트 카드 — 이름·원격 뱃지·로컬 경로·메타(원격 주소/브랜치/Jira 키) */
export function ProjectCard({ project: p, onEdit, onDelete }: Props) {
  return (
    <div className="projects__card">
      <div className="projects__card-head">
        <div className="projects__card-title">
          <span className="projects__name">{p.name}</span>
          {p.remoteUrl && (
            <Badge variant="pill">{REMOTE_KIND_LABELS[p.remoteKind]}</Badge>
          )}
        </div>
        <div className="projects__card-actions">
          <Button size="sm" onClick={onEdit}>
            편집
          </Button>
          <Button size="sm" variant="danger" onClick={onDelete}>
            삭제
          </Button>
        </div>
      </div>

      <div className="projects__path" title={p.localPath}>
        {p.localPath}
      </div>

      {(p.remoteUrl || p.defaultBranch || p.jiraProjectKey) && (
        <div className="projects__meta">
          {p.remoteUrl &&
            (/^https?:\/\//.test(p.remoteUrl) ? (
              <TextLink
                small
                external
                onClick={() => void window.oneApp.openExternal(p.remoteUrl)}
                title="원격 저장소 열기"
              >
                {p.remoteUrl}
              </TextLink>
            ) : (
              <span title="원격 저장소 주소">{p.remoteUrl}</span>
            ))}
          {p.defaultBranch && <span>브랜치 {p.defaultBranch}</span>}
          {p.jiraProjectKey && <span>Jira {p.jiraProjectKey}</span>}
        </div>
      )}
    </div>
  );
}
