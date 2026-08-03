import type { Project, ProjectRemoteKind } from '../../../../shared/types';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { FormRow } from '../../../components/FormRow';
import { Icon } from '../../../components/Icon';
import { Input } from '../../../components/Input';
import { SectionHeader } from '../../../components/SectionHeader';
import { Select } from '../../../components/Select';

/** 원격 저장소 종류 표시명 — Select 옵션·카드 뱃지 공용 */
export const REMOTE_KIND_LABELS: Record<ProjectRemoteKind, string> = {
  gitea: 'Gitea',
  bitbucket: 'Bitbucket',
  other: '기타',
};

const REMOTE_KIND_OPTIONS = (
  Object.entries(REMOTE_KIND_LABELS) as [ProjectRemoteKind, string][]
).map(([value, label]) => ({ value, label }));

// ── 폼 상태 ──
export type ProjectFormState = {
  id?: string;
  name: string;
  localPath: string;
  remoteKind: ProjectRemoteKind;
  remoteUrl: string;
  defaultBranch: string;
  jiraProjectKey: string;
};

export const emptyForm = (): ProjectFormState => ({
  name: '',
  localPath: '',
  remoteKind: 'gitea',
  remoteUrl: '',
  defaultBranch: '',
  jiraProjectKey: '',
});

export const toForm = (p: Project): ProjectFormState => ({ ...p });

type Props = {
  form: ProjectFormState;
  error: string;
  onChange: (next: ProjectFormState) => void;
  onSave: () => void;
  onCancel: () => void;
};

/** 프로젝트 추가/편집 폼 — 이름·로컬 경로(필수) + 원격·브랜치·Jira 키(선택) */
export function ProjectForm({ form, error, onChange, onSave, onCancel }: Props) {
  const pickDir = async () => {
    const { path } = await window.oneApp.projects.pickDir();
    if (path) onChange({ ...form, localPath: path });
  };

  return (
    <div className="section">
      <SectionHeader
        icon={<Icon name="folder" size={18} />}
        title={form.id ? '프로젝트 편집' : '프로젝트 추가'}
        sub="다른 기능(배포·PR 등)이 참조할 프로젝트 정보를 등록합니다."
      />

      <FormRow label="프로젝트명">
        <Input
          type="text"
          value={form.name}
          onChange={(e) => onChange({ ...form, name: e.target.value })}
          placeholder="예: 메타커머스 스토어"
        />
      </FormRow>

      <FormRow label="로컬 경로">
        <Input
          type="text"
          value={form.localPath}
          onChange={(e) => onChange({ ...form, localPath: e.target.value })}
          placeholder="예: ~/projects/metacommerce/store"
        />
        <Button onClick={() => void pickDir()}>폴더 선택</Button>
      </FormRow>

      <FormRow label="원격 저장소">
        <Select
          className="projects__form-remote"
          options={REMOTE_KIND_OPTIONS}
          value={form.remoteKind}
          onChange={(v) =>
            onChange({ ...form, remoteKind: v as ProjectRemoteKind })
          }
          aria-label="원격 저장소 종류"
        />
        <Input
          type="text"
          value={form.remoteUrl}
          onChange={(e) => onChange({ ...form, remoteUrl: e.target.value })}
          placeholder="예: https://git.example.com/owner/repo (비우면 원격 없음)"
        />
      </FormRow>

      <FormRow label="기본 브랜치">
        <Input
          type="text"
          value={form.defaultBranch}
          onChange={(e) => onChange({ ...form, defaultBranch: e.target.value })}
          placeholder="예: develop"
        />
      </FormRow>

      <FormRow label="Jira 프로젝트 키">
        <Input
          type="text"
          value={form.jiraProjectKey}
          onChange={(e) => onChange({ ...form, jiraProjectKey: e.target.value })}
          placeholder="예: BBJ"
        />
      </FormRow>

      <p className="note">
        토큰 등 인증 정보는 여기 저장하지 않습니다 — Gitea·Jira 연동 계정은{' '}
        <b>환경설정</b>에서 관리합니다.
      </p>

      {error && <Banner>{error}</Banner>}

      <div className="form-actions">
        <Button variant="primary" onClick={onSave}>
          저장
        </Button>
        <Button onClick={onCancel}>취소</Button>
      </div>
    </div>
  );
}
