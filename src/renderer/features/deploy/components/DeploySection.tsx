import { useEffect, useState } from 'react';
import type {
  DeployProjectView,
  DeployStatus,
  SaveDeployProjectInput,
} from '../../../../shared/types';
import { statusKey } from '../lib/format';
import { Button } from '../../../components/Button';
import { Icon } from '../../../components/Icon';
import { SectionHeader } from '../../../components/SectionHeader';
import { ProjectCard } from './ProjectCard';
import {
  ProjectForm,
  ProjectFormState,
  emptyForm,
  toForm,
} from './ProjectForm';
import type { DetailState } from './BuildDetailPanel';

/** 배포 섹션 — 프로젝트별 젠킨스 잡을 버튼 한 번으로 배포한다. */
export function DeploySection() {
  const [projects, setProjects] = useState<DeployProjectView[]>([]);
  const [statuses, setStatuses] = useState<Record<string, DeployStatus>>({});
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<ProjectFormState | null>(null); // null 이면 목록 화면
  const [formError, setFormError] = useState('');
  const [details, setDetails] = useState<Record<string, DetailState>>({});
  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(new Set());
  const [, setClock] = useState(0); // "n분 전" 갱신용 1분 틱

  useEffect(() => {
    const id = setInterval(() => setClock((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // 프로젝트 목록의 최근 빌드 상태 조회
  const refreshStatuses = async (list: DeployProjectView[]) => {
    await Promise.all(
      list
        .filter((p) => p.hasSecret)
        .map(async (p) => {
          const map = await window.oneApp.deploy.fetchStatuses(p.id);
          setStatuses((prev) => {
            const next = { ...prev };
            for (const [targetId, status] of Object.entries(map)) {
              const key = statusKey(p.id, targetId);
              // 배포 직후 '대기중'만 보호 — 그 외(빌드중 포함)는 조회 결과로 갱신
              // (빌드중을 보호하면 젠킨스에서 직접 돌린 빌드가 끝나도 배지가 안 바뀜)
              if (next[key]?.state !== 'queued') next[key] = status;
            }
            return next;
          });
        }),
    );
  };

  useEffect(() => {
    window.oneApp?.deploy.getProjects().then((list) => {
      setProjects(list);
      setLoading(false);
      refreshStatuses(list);
    });
    // 배포 진행 상태 이벤트 구독
    const off = window.oneApp?.deploy.onStatus(
      ({ projectId, targetId, status }) => {
        setStatuses((prev) => ({
          ...prev,
          [statusKey(projectId, targetId)]: status,
        }));
      },
    );
    return () => off?.();
  }, []);

  // ── 배포 실행 ──
  const deploy = async (projectId: string, targetId: string) => {
    // 실수 방지 — 무엇을 배포하는지 확인받고 진행
    const project = projects.find((p) => p.id === projectId);
    const target = project?.targets.find((t) => t.id === targetId);
    const label = [project?.name, target?.name].filter(Boolean).join(' — ');
    if (!window.confirm(`${label} 배포를 시작할까요?`)) return;

    const key = statusKey(projectId, targetId);
    setStatuses((prev) => ({ ...prev, [key]: { state: 'queued' } }));
    const res = await window.oneApp.deploy.trigger(projectId, targetId);
    if (!res.ok) {
      setStatuses((prev) => ({
        ...prev,
        [key]: { state: 'error', error: res.error ?? '실행 실패' },
      }));
    }
  };

  // ── 커밋 내역 조회 (buildNumber 없으면 최근 빌드 기준) ──
  // 패널은 한 번에 하나만 — 하나를 열면 다른 대상의 패널은 닫는다
  const loadDetail = async (
    projectId: string,
    targetId: string,
    buildNumber?: number,
  ) => {
    const key = statusKey(projectId, targetId);
    setDetails((prev) => {
      const next: Record<string, DetailState> = {};
      for (const [k, v] of Object.entries(prev)) next[k] = { ...v, open: false };
      next[key] = { open: true, loading: true };
      return next;
    });
    const res = await window.oneApp.deploy.getBuildDetail(
      projectId,
      targetId,
      buildNumber,
    );
    setDetails((prev) => ({
      ...prev,
      [key]: {
        // 조회 중에 다른 패널을 열었으면(=이 패널은 닫힘) 닫힌 상태를 유지한다
        open: prev[key]?.open ?? false,
        loading: false,
        detail: res.detail,
        error: res.ok ? undefined : res.error ?? '조회 실패',
      },
    }));
  };

  // ── 커밋 내역 패널 열기/닫기 (열 때마다 새로 조회) ──
  const toggleDetail = (projectId: string, targetId: string) => {
    const key = statusKey(projectId, targetId);
    const cur = details[key];
    if (cur?.open) {
      setDetails((prev) => ({ ...prev, [key]: { ...cur, open: false } }));
      return;
    }
    void loadDetail(projectId, targetId, statuses[key]?.buildNumber);
  };

  // ── 프로젝트 단위 새로고침 — 상태 배지 + 열려있는 커밋 패널 재조회 ──
  const refreshProject = async (p: DeployProjectView) => {
    setRefreshingIds((prev) => new Set(prev).add(p.id));
    try {
      await refreshStatuses([p]);
      Object.entries(details).forEach(([key, st]) => {
        if (!st?.open || !key.startsWith(`${p.id}:`)) return;
        const targetId = key.slice(p.id.length + 1);
        void loadDetail(p.id, targetId); // 최근 빌드 기준으로 갱신
      });
    } finally {
      setRefreshingIds((prev) => {
        const next = new Set(prev);
        next.delete(p.id);
        return next;
      });
    }
  };

  // ── 프로젝트 저장/삭제 ──
  const saveForm = async () => {
    if (!form) return;
    const targets = form.targets.filter((t) => t.name.trim() && t.jobPath.trim());
    if (!form.name.trim()) return setFormError('프로젝트 이름을 입력하세요.');
    if (!/^https?:\/\//.test(form.jenkinsUrl.trim()))
      return setFormError('젠킨스 URL 을 http(s):// 형태로 입력하세요.');
    if (!form.username.trim()) return setFormError('젠킨스 아이디를 입력하세요.');
    if (!form.hasSecret && !form.secret)
      return setFormError('API 토큰(또는 비밀번호)을 입력하세요.');
    if (targets.length === 0)
      return setFormError('배포 대상을 1개 이상 입력하세요. (표시명 + 잡 이름)');

    const input: SaveDeployProjectInput = {
      id: form.id,
      name: form.name,
      jenkinsUrl: form.jenkinsUrl,
      username: form.username,
      secret: form.secret || undefined,
      targets,
    };
    const list = await window.oneApp.deploy.saveProject(input);
    setProjects(list);
    setForm(null);
    setFormError('');
    refreshStatuses(list);
  };

  const removeProject = async (p: DeployProjectView) => {
    if (!window.confirm(`'${p.name}' 프로젝트를 삭제할까요?`)) return;
    setProjects(await window.oneApp.deploy.deleteProject(p.id));
  };

  // ── 프로젝트 추가/편집 폼 ──
  if (form) {
    return (
      <ProjectForm
        form={form}
        error={formError}
        onChange={setForm}
        onSave={saveForm}
        onCancel={() => {
          setForm(null);
          setFormError('');
        }}
      />
    );
  }

  // ── 프로젝트 목록 ──
  return (
    <div className="section">
      <div className="deploy__head">
        <SectionHeader
          icon={<Icon name="rocket" size={18} />}
          title="배포"
          sub="프로젝트별 젠킨스 잡을 버튼 한 번으로 배포합니다."
        />
        <Button variant="primary" onClick={() => setForm(emptyForm())}>
          <Icon name="plus" size={14} />
          프로젝트 추가
        </Button>
      </div>

      {loading ? (
        <p className="hint">불러오는 중...</p>
      ) : projects.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state__icon">
            <Icon name="rocket" size={20} />
          </span>
          <p>등록된 프로젝트가 없습니다.</p>
          <p className="hint">
            [프로젝트 추가] 를 눌러 젠킨스 정보와 배포 대상을 등록하세요.
          </p>
        </div>
      ) : (
        projects.map((p) => (
          <ProjectCard
            key={p.id}
            project={p}
            statuses={statuses}
            details={details}
            refreshing={refreshingIds.has(p.id)}
            onDeploy={(targetId) => deploy(p.id, targetId)}
            onToggleDetail={(targetId) => toggleDetail(p.id, targetId)}
            onRefresh={() => refreshProject(p)}
            onEdit={() => setForm(toForm(p))}
            onDelete={() => removeProject(p)}
          />
        ))
      )}
    </div>
  );
}
