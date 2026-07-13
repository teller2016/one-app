import { useEffect, useState } from 'react';
import type {
  DeployProjectView,
  DeployStatus,
  SaveDeployProjectInput,
} from '../../../../shared/types';
import { statusKey, jenkinsJobUrl } from '../lib/format';
import { Button } from '../../../components/Button';
import { Icon } from '../../../components/Icon';
import { Modal } from '../../../components/Modal';
import { SectionHeader } from '../../../components/SectionHeader';
import { ProjectCard } from './ProjectCard';
import { BuildDetailPanel } from './BuildDetailPanel';
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

  // 빌드중이면 5초 틱으로 진행률(경과 시간)을 갱신
  const anyBuilding = Object.values(statuses).some(
    (s) => s?.state === 'building',
  );
  useEffect(() => {
    if (!anyBuilding) return;
    const id = setInterval(() => setClock((t) => t + 1), 5_000);
    return () => clearInterval(id);
  }, [anyBuilding]);

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

  // 배포 탭을 보는 동안 1분마다 상태 자동 새로고침 (젠킨스에서 직접 돌린 빌드도 반영)
  useEffect(() => {
    if (projects.length === 0) return;
    const id = setInterval(() => void refreshStatuses(projects), 60_000);
    return () => clearInterval(id);
  }, [projects]);

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
      next[key] = {
        ...prev[key], // 이력·로그 상태는 유지
        open: true,
        loading: true,
        error: undefined,
        selected: buildNumber ?? prev[key]?.selected,
      };
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
        ...prev[key],
        // 조회 중에 다른 패널을 열었으면(=이 패널은 닫힘) 닫힌 상태를 유지한다
        open: prev[key]?.open ?? false,
        loading: false,
        detail: res.detail,
        error: res.ok ? undefined : res.error ?? '조회 실패',
        // 최근 빌드 기준 조회면 실제 번호로 동기화
        selected: res.detail?.number ?? prev[key]?.selected,
      },
    }));
  };

  // ── 빌드 이력 조회 (패널 상단 스트립) ──
  const loadHistory = async (projectId: string, targetId: string) => {
    const key = statusKey(projectId, targetId);
    const res = await window.oneApp.deploy.getHistory(projectId, targetId);
    setDetails((prev) => {
      const cur = prev[key];
      if (!cur?.open) return prev; // 그 사이 패널이 닫혔으면 무시
      return {
        ...prev,
        [key]: {
          ...cur,
          history: res.builds,
          historyError: res.ok ? undefined : res.error ?? '이력 조회 실패',
        },
      };
    });
  };

  // ── 커밋 내역 모달 열기 (열 때마다 상세+이력 새로 조회) ──
  const openDetail = (projectId: string, targetId: string) => {
    const key = statusKey(projectId, targetId);
    void loadDetail(projectId, targetId, statuses[key]?.buildNumber);
    void loadHistory(projectId, targetId);
  };

  const closeDetail = (key: string) => {
    setDetails((prev) =>
      prev[key] ? { ...prev, [key]: { ...prev[key], open: false } } : prev,
    );
  };

  // ── 이력에서 특정 빌드 선택 → 그 빌드의 커밋 내역으로 전환 ──
  const selectBuild = (
    projectId: string,
    targetId: string,
    buildNumber: number,
  ) => {
    const key = statusKey(projectId, targetId);
    void loadDetail(projectId, targetId, buildNumber);
    // 로그가 열려 있으면 선택한 빌드 기준으로 다시 조회
    if (details[key]?.log?.open) {
      setDetails((prev) => ({
        ...prev,
        [key]: { ...prev[key], log: { open: true, loading: true } },
      }));
      void fetchLogInto(projectId, targetId, buildNumber);
    }
  };

  // ── 콘솔 로그 조회/토글 ──
  const fetchLogInto = async (
    projectId: string,
    targetId: string,
    buildNumber: number,
  ) => {
    const key = statusKey(projectId, targetId);
    const res = await window.oneApp.deploy.getLog(
      projectId,
      targetId,
      buildNumber,
    );
    setDetails((prev) => {
      const cur = prev[key];
      if (!cur?.log?.open) return prev; // 그 사이 로그를 닫았으면 무시
      return {
        ...prev,
        [key]: {
          ...cur,
          log: {
            open: true,
            loading: false,
            text: res.text,
            truncated: res.truncated,
            error: res.ok ? undefined : res.error ?? '로그 조회 실패',
          },
        },
      };
    });
  };

  const toggleLog = (projectId: string, targetId: string) => {
    const key = statusKey(projectId, targetId);
    const cur = details[key];
    if (!cur) return;
    if (cur.log?.open) {
      setDetails((prev) => ({
        ...prev,
        [key]: { ...cur, log: { ...(cur.log as NonNullable<typeof cur.log>), open: false } },
      }));
      return;
    }
    const n = cur.selected ?? cur.detail?.number;
    if (n == null) return;
    setDetails((prev) => ({
      ...prev,
      [key]: { ...prev[key], log: { open: true, loading: true } },
    }));
    void fetchLogInto(projectId, targetId, n);
  };

  const refreshLog = (projectId: string, targetId: string) => {
    const key = statusKey(projectId, targetId);
    const cur = details[key];
    const n = cur?.selected ?? cur?.detail?.number;
    if (n == null) return;
    setDetails((prev) => ({
      ...prev,
      [key]: { ...prev[key], log: { ...prev[key]?.log, open: true, loading: true } },
    }));
    void fetchLogInto(projectId, targetId, n);
  };

  // ── 진행 중 빌드 중지 ──
  const stopBuild = async (
    projectId: string,
    targetId: string,
    buildNumber: number,
  ) => {
    const project = projects.find((p) => p.id === projectId);
    const target = project?.targets.find((t) => t.id === targetId);
    const label = [project?.name, target?.name].filter(Boolean).join(' — ');
    if (!window.confirm(`${label} 빌드 #${buildNumber} 을(를) 중지할까요?`)) return;

    const res = await window.oneApp.deploy.stopBuild(
      projectId,
      targetId,
      buildNumber,
    );
    if (!res.ok) {
      window.alert(`중지 실패: ${res.error ?? '알 수 없는 오류'}`);
      return;
    }
    // 젠킨스가 중단을 반영할 시간을 준 뒤 상태 갱신
    // (앱에서 트리거한 빌드는 watchBuild 가 ABORTED 를 곧 감지한다)
    setTimeout(() => {
      if (project) void refreshStatuses([project]);
    }, 2000);
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
        void loadHistory(p.id, targetId);
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
            refreshing={refreshingIds.has(p.id)}
            onDeploy={(targetId) => deploy(p.id, targetId)}
            onStop={(targetId, buildNumber) =>
              void stopBuild(p.id, targetId, buildNumber)
            }
            onOpenDetail={(targetId) => openDetail(p.id, targetId)}
            onRefresh={() => refreshProject(p)}
            onEdit={() => setForm(toForm(p))}
            onDelete={() => removeProject(p)}
          />
        ))
      )}

      {/* 커밋 내역 모달 — 열린 대상(details.open)이 있을 때만 렌더 */}
      {(() => {
        const openEntry = Object.entries(details).find(([, v]) => v.open);
        if (!openEntry) return null;
        const [key, st] = openEntry;
        const sep = key.indexOf(':');
        const projectId = key.slice(0, sep);
        const targetId = key.slice(sep + 1);
        const project = projects.find((p) => p.id === projectId);
        const target = project?.targets.find((t) => t.id === targetId);
        const title = [project?.name, target?.name].filter(Boolean).join(' — ');
        return (
          <Modal
            wide
            title={`${title} 빌드 내역`}
            onClose={() => closeDetail(key)}
          >
            <BuildDetailPanel
              state={st}
              onSelectBuild={(n) => selectBuild(projectId, targetId, n)}
              onToggleLog={() => toggleLog(projectId, targetId)}
              onRefreshLog={() => refreshLog(projectId, targetId)}
              onOpenConsole={(n) => {
                if (!project || !target) return;
                void window.oneApp.openExternal(
                  `${jenkinsJobUrl(project.jenkinsUrl, target.jobPath)}${n}/console`,
                );
              }}
            />
          </Modal>
        );
      })()}
    </div>
  );
}
