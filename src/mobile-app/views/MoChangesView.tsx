// 폰 '변경' 탭 — 프로젝트 레지스트리에서 대상을 고르고 데스크톱 ChangesView 를 무수정 재사용.
// "자리 비운 사이 AI 가 만든 변경 확인 → (터미널에서 AI 로 커밋) → 푸시" 를 폰에서 끝낸다.
import { EmptyState } from '../../renderer/components/EmptyState';
import { Select } from '../../renderer/components/Select';
import { ChangesView } from '../../renderer/features/changes';
import { useEffect, useState } from 'react';
import type { Project } from '../../shared/types';

export function MoChangesView() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectId, setProjectId] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    // ⚠️ catch 가 없으면 조회 중 RPC 가 끊겼을 때(onclose 가 pending 을 reject) 화면이
    // 영영 빈 채로 굳는다 — 폰은 잠금·앱 전환으로 소켓이 수시로 끊긴다
    void window.oneApp.projects
      .list()
      .then((list) => {
        setProjects(list);
        setProjectId((cur) => cur || list[0]?.id || '');
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  if (error) {
    return (
      <EmptyState
        icon="alert-triangle"
        message="프로젝트 목록을 불러오지 못했습니다"
        hint={`${error} — 연결이 돌아오면 탭을 다시 여세요.`}
      />
    );
  }
  if (!projects) return null; // 목록 로딩 중 — 한 순간이라 스피너 없이 비워둔다
  if (projects.length === 0) {
    return (
      <EmptyState
        icon="folder"
        message="등록된 프로젝트가 없습니다"
        hint="데스크톱의 프로젝트 탭에서 먼저 등록하세요."
      />
    );
  }

  return (
    <div className="mo-changes">
      <Select
        className="mo-changes__project"
        aria-label="프로젝트"
        options={projects.map((p) => ({ value: p.id, label: p.name }))}
        value={projectId}
        onChange={setProjectId}
        small
      />
      {projectId && <ChangesView key={projectId} target={{ projectId }} />}
    </div>
  );
}
