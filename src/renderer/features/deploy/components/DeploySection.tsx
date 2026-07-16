import { useEffect, useRef, useState } from 'react';
import type {
  DeployActivity,
  DeployProjectView,
  DeployStatus,
  SaveDeployProjectInput,
} from '../../../../shared/types';
import { statusKey, jenkinsJobUrl, giteaCommitBase } from '../lib/format';
import { Button } from '../../../components/Button';
import { Icon } from '../../../components/Icon';
import { Modal } from '../../../components/Modal';
import { useConfirm } from '../../../components/ConfirmDialog';
import { SectionHeader } from '../../../components/SectionHeader';
import { ActivityPanel } from './ActivityPanel';
import { ProjectCard } from './ProjectCard';
import { BuildDetailPanel } from './BuildDetailPanel';
import { DeployConfirmModal, PreviewState } from './DeployConfirmModal';
import {
  ProjectForm,
  ProjectFormState,
  emptyForm,
  toForm,
} from './ProjectForm';
import type { DetailState } from './BuildDetailPanel';

/** 배포 섹션 — 프로젝트별 젠킨스 잡을 버튼 한 번으로 배포한다. */
export function DeploySection() {
  const confirmDialog = useConfirm(); // 이름 주의: confirm 은 배포 확인 모달 상태가 사용 중
  const [projects, setProjects] = useState<DeployProjectView[]>([]);
  const [statuses, setStatuses] = useState<Record<string, DeployStatus>>({});
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<ProjectFormState | null>(null); // null 이면 목록 화면
  const [formError, setFormError] = useState('');
  const [details, setDetails] = useState<Record<string, DetailState>>({});
  const [refreshingIds, setRefreshingIds] = useState<Set<string>>(new Set());
  const [, setClock] = useState(0); // "n분 전" 갱신용 1분 틱
  // 젠킨스 서버 현황 팝업 — 열린 프로젝트 id + 그 서버의 현황(실행 중 + 대기)
  const [activityFor, setActivityFor] = useState<string | null>(null);
  const [activity, setActivity] = useState<DeployActivity | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<string>();
  // 앱에서 방금 트리거해 watchBuild 가 상태를 몰고 가는 대상 키 집합.
  // 이 대상의 낙관적 '대기중'만 주기 조회가 덮지 않도록 보호한다.
  const optimistic = useRef<Set<string>>(new Set());
  // 배포 확인 모달 (미리보기 + PROD 타이핑 확인)
  const [confirm, setConfirm] = useState<{
    projectId: string;
    targetId: string;
  } | null>(null);
  const [preview, setPreview] = useState<PreviewState>({ loading: false });
  // 커밋 링크화 설정 (환경설정의 Jira/Gitea 주소)
  const [linkCfg, setLinkCfg] = useState({ jiraUrl: '', giteaUrl: '' });

  useEffect(() => {
    window.oneApp?.settings
      .get()
      .then((s) => setLinkCfg({ jiraUrl: s.jiraUrl, giteaUrl: s.giteaUrl }));
  }, []);

  useEffect(() => {
    const id = setInterval(() => setClock((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  // 젠킨스 서버 현황 조회 (실행 중 + 대기) — 해당 프로젝트의 서버 기준
  const refreshActivity = async (projectId: string) => {
    setActivityLoading(true);
    try {
      const res = await window.oneApp.deploy.fetchActivity(projectId);
      if (res.ok) {
        setActivity(res.activity ?? null);
        setActivityError(undefined);
      } else {
        setActivity(null);
        setActivityError(res.error ?? '현황 조회 실패');
      }
    } catch (err) {
      setActivity(null);
      setActivityError((err as Error).message);
    } finally {
      setActivityLoading(false);
    }
  };

  // 카드의 [현황] 버튼 → 팝업 열고 즉시 조회
  const openActivity = (projectId: string) => {
    setActivityFor(projectId);
    setActivity(null);
    setActivityError(undefined);
    void refreshActivity(projectId);
  };

  // 현황 팝업이 열려 있는 동안 5초마다 자동 갱신 (실행/대기 목록은 자주 바뀜)
  useEffect(() => {
    if (!activityFor) return;
    const id = setInterval(() => void refreshActivity(activityFor), 5_000);
    return () => clearInterval(id);
  }, [activityFor]);

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
              // 앱에서 방금 트리거한 대상의 낙관적 '대기중'만 보호
              // (watchBuild 가 갱신하므로 주기 조회가 직전 빌드 완료로 덮지 않게).
              // 서버 감지 대기중(다른 빌드에 밀림)은 조회 결과로 계속 갱신해야
              // 빌드 시작 시 '대기중 → 빌드중'으로 자연스럽게 넘어간다.
              if (!(optimistic.current.has(key) && next[key]?.state === 'queued'))
                next[key] = status;
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
        const key = statusKey(projectId, targetId);
        // 완료(성공/실패/오류)면 watchBuild 종료 — 보호 해제해 이후 조회가 반영되게
        if (
          status.state === 'success' ||
          status.state === 'failure' ||
          status.state === 'error'
        )
          optimistic.current.delete(key);
        setStatuses((prev) => ({ ...prev, [key]: status }));
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

  // ── 배포 실행 — 확인 모달을 열고, 모달에서 [배포]를 눌러야 트리거된다 ──
  const openDeployConfirm = (projectId: string, targetId: string) => {
    setConfirm({ projectId, targetId });
    // 이번 배포에 포함될 커밋 미리보기 (Gitea 미설정이면 즉시 configured:false)
    setPreview({ loading: true });
    void window.oneApp.deploy
      .getPreview(projectId, targetId)
      .then((result) => setPreview({ loading: false, result }))
      .catch((err: Error) =>
        setPreview({
          loading: false,
          result: { ok: false, configured: true, error: err.message },
        }),
      );
  };

  const doDeploy = async (projectId: string, targetId: string) => {
    setConfirm(null);
    const key = statusKey(projectId, targetId);
    optimistic.current.add(key); // watchBuild 가 몰고 갈 대상 — 주기 조회 보호
    setStatuses((prev) => ({ ...prev, [key]: { state: 'queued' } }));
    const res = await window.oneApp.deploy.trigger(projectId, targetId);
    if (!res.ok) {
      optimistic.current.delete(key);
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
    const ok = await confirmDialog({
      title: `빌드 #${buildNumber} 중지`,
      message: `${label} 빌드를 중지할까요?`,
      confirmLabel: '중지',
      danger: true,
    });
    if (!ok) return;

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
      production: form.production,
      targets,
    };
    const list = await window.oneApp.deploy.saveProject(input);
    setProjects(list);
    setForm(null);
    setFormError('');
    refreshStatuses(list);
  };

  const removeProject = async (p: DeployProjectView) => {
    const ok = await confirmDialog({
      title: '프로젝트 삭제',
      message: `'${p.name}' 프로젝트와 배포 대상 설정이 함께 삭제됩니다.`,
      confirmLabel: '삭제',
      danger: true,
    });
    if (!ok) return;
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
            onDeploy={(targetId) => openDeployConfirm(p.id, targetId)}
            onStop={(targetId, buildNumber) =>
              void stopBuild(p.id, targetId, buildNumber)
            }
            onOpenDetail={(targetId) => openDetail(p.id, targetId)}
            onOpenActivity={() => openActivity(p.id)}
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
              links={{
                commitBase: giteaCommitBase(linkCfg.giteaUrl, st.detail?.repoUrl),
                jiraUrl: linkCfg.jiraUrl,
              }}
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

      {/* 배포 확인 모달 — 미리보기 + PROD 타이핑 확인 */}
      {confirm &&
        (() => {
          const project = projects.find((p) => p.id === confirm.projectId);
          const target = project?.targets.find((t) => t.id === confirm.targetId);
          if (!project || !target) return null;
          return (
            <DeployConfirmModal
              project={project}
              target={target}
              preview={preview}
              onConfirm={() => void doDeploy(confirm.projectId, confirm.targetId)}
              onClose={() => setConfirm(null)}
            />
          );
        })()}

      {/* 젠킨스 서버 현황 모달 — 카드의 [현황] 버튼으로 연다 */}
      {activityFor &&
        (() => {
          const project = projects.find((p) => p.id === activityFor);
          return (
            <Modal
              title={`${project?.name ?? '젠킨스'} 현황`}
              onClose={() => setActivityFor(null)}
            >
              <ActivityPanel
                activity={activity}
                loading={activityLoading}
                error={activityError}
                onRefresh={() => void refreshActivity(activityFor)}
                onOpen={(url) => void window.oneApp.openExternal(url)}
              />
            </Modal>
          );
        })()}
    </div>
  );
}
