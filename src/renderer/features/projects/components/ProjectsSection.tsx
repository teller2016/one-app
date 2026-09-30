import { useEffect, useState } from 'react';
import type { Project } from '../../../../shared/types';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { useConfirm } from '../../../components/ConfirmDialog';
import { EmptyState } from '../../../components/EmptyState';
import { Icon } from '../../../components/Icon';
import { useToast } from '../../../components/Toast';
import { TopbarSlot } from '../../../components/TopbarSlot';
import { errMsg } from '../../../lib/errMsg';
import { ProjectCard } from './ProjectCard';
import {
  ProjectForm,
  ProjectFormState,
  emptyForm,
  toForm,
} from './ProjectForm';

/** 프로젝트 섹션 — 다른 기능(배포·PR·Nightwatch 등)이 참조하는 프로젝트 중앙 관리 지점 */
export function ProjectsSection() {
  const confirmDialog = useConfirm();
  const toast = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [form, setForm] = useState<ProjectFormState | null>(null); // null 이면 목록 화면
  const [formError, setFormError] = useState('');

  useEffect(() => {
    let mounted = true;
    // 실패를 삼키면 '불러오는 중...' 에서 영영 멈춘다 — 에러로 끝내 배너를 띄운다
    window.oneApp.projects
      .list()
      .then((list) => {
        if (mounted) setProjects(list);
      })
      .catch((e: unknown) => {
        if (mounted)
          setLoadError(errMsg(e, '프로젝트 목록을 불러오지 못했습니다.'));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    // 다른 경로(향후 소비 기능·다른 창)의 저장도 즉시 반영
    const off = window.oneApp.projects.onChanged((list) => setProjects(list));
    return () => {
      mounted = false;
      off();
    };
  }, []);

  const saveForm = async () => {
    if (!form) return;
    if (!form.name.trim()) return setFormError('프로젝트 이름을 입력하세요.');
    if (!form.localPath.trim()) return setFormError('로컬 경로를 입력하세요.');
    const remoteUrl = form.remoteUrl.trim();
    if (remoteUrl && !/^(https?:\/\/|git@)/.test(remoteUrl))
      return setFormError(
        '원격 주소를 http(s):// 또는 git@ 형태로 입력하세요.',
      );

    // main 이 throw 하는 경로(경로 검증 등)와 invoke 거부를 잡는다 — 안 잡으면
    // 폼이 열린 채 아무 반응이 없어 보인다 (배포 saveForm 과 같은 패턴)
    try {
      const list = await window.oneApp.projects.save({
        id: form.id,
        name: form.name,
        localPath: form.localPath,
        remoteKind: form.remoteKind,
        remoteUrl,
        defaultBranch: form.defaultBranch,
        jiraProjectKey: form.jiraProjectKey,
      });
      setProjects(list);
      setForm(null);
      setFormError('');
    } catch (err) {
      setFormError(errMsg(err, '프로젝트를 저장하지 못했습니다.'));
    }
  };

  const removeProject = async (p: Project) => {
    const ok = await confirmDialog({
      title: '프로젝트 삭제',
      message: `'${p.name}' 프로젝트가 목록에서 삭제됩니다. (로컬 파일은 지우지 않습니다)`,
      confirmLabel: '삭제',
      danger: true,
    });
    if (!ok) return;
    try {
      setProjects(await window.oneApp.projects.delete(p.id));
    } catch (err) {
      toast(errMsg(err, '프로젝트를 삭제하지 못했습니다.'), 'fail');
    }
  };

  // ── 프로젝트 추가/편집 폼 ──
  if (form) {
    return (
      <ProjectForm
        form={form}
        error={formError}
        onChange={setForm}
        onSave={() => void saveForm()}
        onCancel={() => {
          setForm(null);
          setFormError('');
        }}
      />
    );
  }

  // ── 프로젝트 목록 ── (목업 Projects: 섹션 제목 없이 [프로젝트 추가]는 탑바 오른쪽 끝)
  return (
    <div className="section projects">
      <TopbarSlot
        right={
          <Button variant="primary" onClick={() => setForm(emptyForm())}>
            <Icon name="plus" size={14} />
            프로젝트 추가
          </Button>
        }
      />

      <div className="projects__list">
        {loading ? (
          <p className="hint">불러오는 중...</p>
        ) : loadError ? (
          <Banner variant="danger">{loadError}</Banner>
        ) : projects.length === 0 ? (
          <EmptyState
            icon="folder"
            message="등록된 프로젝트가 없습니다."
            hint="[프로젝트 추가] 를 눌러 로컬 경로와 원격 저장소 정보를 등록하세요."
          />
        ) : (
          projects.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              onEdit={() => setForm(toForm(p))}
              onDelete={() => void removeProject(p)}
            />
          ))
        )}
      </div>
    </div>
  );
}
