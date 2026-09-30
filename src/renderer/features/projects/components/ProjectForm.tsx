import type { Project, ProjectRemoteKind } from '../../../../shared/types';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { Input } from '../../../components/Input';
import { Select } from '../../../components/Select';
import { TopbarSlot } from '../../../components/TopbarSlot';

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
export function ProjectForm({
  form,
  error,
  onChange,
  onSave,
  onCancel,
}: Props) {
  const pickDir = async () => {
    const { path } = await window.oneApp.projects.pickDir();
    if (path) onChange({ ...form, localPath: path });
  };

  // 목업 ProjectForm.dc.html — 페이지 제목(h1) + 패널 안 2열 그리드(라벨 120 · 입력) + 안내 + 구분선 + 버튼
  return (
    <div className="section projects projects--form">
      {/* 탑바 경로 셋째 칸 — 목업 '리소스 / 프로젝트 / 프로젝트 편집' */}
      <TopbarSlot crumb={form.id ? '프로젝트 편집' : '프로젝트 추가'} />
      <div className="projects__form">
        <h1 className="projects__form-title">
          {form.id ? '프로젝트 편집' : '프로젝트 추가'}
        </h1>

        <div className="projects__form-grid">
          <label className="projects__form-label" htmlFor="pj-name">
            프로젝트명
          </label>
          <Input
            id="pj-name"
            type="text"
            value={form.name}
            onChange={(e) => onChange({ ...form, name: e.target.value })}
            placeholder="예: 메타커머스 스토어"
          />

          <label className="projects__form-label" htmlFor="pj-path">
            로컬 경로
          </label>
          <div className="projects__form-row">
            <Input
              id="pj-path"
              className="projects__mono"
              type="text"
              value={form.localPath}
              onChange={(e) => onChange({ ...form, localPath: e.target.value })}
              placeholder="예: ~/projects/metacommerce/store"
            />
            <Button onClick={() => void pickDir()}>폴더 선택</Button>
          </div>

          <label className="projects__form-label" htmlFor="pj-remote">
            원격 저장소
          </label>
          <div className="projects__form-row">
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
              id="pj-remote"
              className="projects__mono"
              type="text"
              value={form.remoteUrl}
              onChange={(e) => onChange({ ...form, remoteUrl: e.target.value })}
              placeholder="예: https://git.example.com/owner/repo (비우면 원격 없음)"
            />
          </div>

          <label className="projects__form-label" htmlFor="pj-branch">
            기본 브랜치
          </label>
          <Input
            id="pj-branch"
            className="projects__mono projects__form-branch"
            type="text"
            value={form.defaultBranch}
            onChange={(e) =>
              onChange({ ...form, defaultBranch: e.target.value })
            }
            placeholder="예: develop"
          />

          <label className="projects__form-label" htmlFor="pj-jira">
            Jira 프로젝트 키
          </label>
          <Input
            id="pj-jira"
            className="projects__mono projects__form-jira"
            type="text"
            value={form.jiraProjectKey}
            onChange={(e) =>
              onChange({ ...form, jiraProjectKey: e.target.value })
            }
            placeholder="예: BBJ"
          />
        </div>

        <p className="projects__form-note">
          토큰 등 인증 정보는 여기 저장하지 않습니다 — Gitea·Jira 연동 계정은{' '}
          <b>환경설정</b>에서 관리합니다.
        </p>

        {error && <Banner>{error}</Banner>}

        <div className="projects__form-divider" />
        <div className="projects__form-actions">
          <Button variant="primary" onClick={onSave}>
            저장
          </Button>
          <Button onClick={onCancel}>취소</Button>
        </div>
      </div>
    </div>
  );
}
