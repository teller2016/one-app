// 폰 '변경' 탭 — 대상은 **터미널에서 보고 있는 워크트리**를 따라간다(목업 MoChanges).
// 터미널 대상이 없거나 [바꾸기]로 프로젝트를 고르면 프로젝트 레지스트리 기준으로 본다.
// 커밋·푸시·base 대비·로그는 데스크톱 ChangesView 가 그대로 한다(무수정 재사용).
// "자리 비운 사이 AI 가 만든 변경 확인 → 커밋 → 푸시" 를 폰에서 끝낸다.
import { Button } from '../../renderer/components/Button';
import { EmptyState } from '../../renderer/components/EmptyState';
import { Select } from '../../renderer/components/Select';
import { ChangesView } from '../../renderer/features/changes';
import { initials } from '../../renderer/features/terminal/lib/workspace';
import { useEffect, useMemo, useState } from 'react';
import type { ChangesTarget, Project } from '../../shared/types';

/** 터미널 탭이 알려주는 지금 보는 워크트리 — 필요한 필드만 (wsId 는 main 검증용) */
export type MoTermTarget = {
  path: string;
  wsName: string;
  worktreeName: string;
  branch?: string;
  wsColor?: number;
} | null;

/** '터미널 대상 따라가기' 를 뜻하는 Select 값 — 프로젝트 id 와 겹치지 않는 표식 */
const FOLLOW = '__terminal__';

export function MoChangesView({ target }: { target: MoTermTarget }) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  // FOLLOW = 터미널 대상, 그 밖 = 프로젝트 id
  const [pick, setPick] = useState<string>(FOLLOW);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    // ⚠️ catch 가 없으면 조회 중 RPC 가 끊겼을 때(onclose 가 pending 을 reject) 화면이
    // 영영 빈 채로 굳는다 — 폰은 잠금·앱 전환으로 소켓이 수시로 끊긴다
    void window.oneApp.projects
      .list()
      .then(setProjects)
      .catch((err: Error) => setError(err.message));
  }, []);

  // 터미널 대상의 워크스페이스 id — 터미널 탭 상태에 있으면 쓴다(main 이 워크트리 목록과 대조 검증)
  const wsId = (target as { wsId?: string } | null)?.wsId;
  const follow = pick === FOLLOW && !!target && !!wsId;
  const projectId = pick === FOLLOW ? (projects?.[0]?.id ?? '') : pick;

  const changesTarget = useMemo<ChangesTarget | null>(() => {
    if (follow && target && wsId)
      return { workspaceId: wsId, worktreePath: target.path };
    return projectId ? { projectId } : null;
  }, [follow, target, wsId, projectId]);

  if (error && !follow) {
    return (
      <EmptyState
        icon="alert-triangle"
        message="프로젝트 목록을 불러오지 못했습니다"
        hint={`${error} — 연결이 돌아오면 탭을 다시 여세요.`}
      />
    );
  }
  if (!follow && !projects) return null; // 목록 로딩 중 — 한 순간이라 스피너 없이 비워둔다
  if (!changesTarget) {
    return (
      <EmptyState
        icon="folder"
        message="볼 대상이 없습니다"
        hint="터미널에서 작업 영역을 고르거나, 데스크톱의 프로젝트 탭에서 프로젝트를 등록하세요."
      />
    );
  }

  const current = follow ? null : projects?.find((p) => p.id === projectId);
  const options = [
    ...(target && wsId
      ? [
          {
            value: FOLLOW,
            label: `터미널 — ${target.wsName} · ${target.worktreeName}`,
          },
        ]
      : []),
    ...(projects ?? []).map((p) => ({ value: p.id, label: p.name })),
  ];

  return (
    <div className="mo-changes">
      {/* 대상 — 목업: 이니셜 타일 + 이름 · 브랜치 + [바꾸기] */}
      <div className="mo-changes__target">
        <span
          className={`mo-changes__tile mo-changes__tile--c${follow ? (target?.wsColor ?? 10) : 10}`}
          aria-hidden="true"
        >
          {/* 터미널 타일과 같은 이니셜 규칙(one-app → OA) */}
          {initials((follow ? target?.wsName : current?.name) ?? '?', 2)}
        </span>
        <span className="mo-changes__names">
          <span className="mo-changes__name">
            {follow
              ? `${target?.wsName} · ${target?.worktreeName}`
              : current?.name}
          </span>
          {follow && target?.branch && (
            <span className="mo-changes__branch">{target.branch}</span>
          )}
        </span>
        <Button
          size="sm"
          variant="plain"
          onClick={() => setChoosing((v) => !v)}
        >
          바꾸기
        </Button>
      </div>
      {choosing && (
        <Select
          className="mo-changes__project"
          aria-label="변경을 볼 대상"
          options={options}
          value={follow ? FOLLOW : projectId}
          onChange={(v) => {
            setPick(v);
            setChoosing(false);
          }}
        />
      )}
      <ChangesView key={JSON.stringify(changesTarget)} target={changesTarget} />
    </div>
  );
}
