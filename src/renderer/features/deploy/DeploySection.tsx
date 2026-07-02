import { useEffect, useState } from 'react';
import type {
  DeployProjectView,
  DeployStatus,
  DeployBuildDetail,
  SaveDeployProjectInput,
} from '../../../shared/types';

// ── 폼 상태 ──
type TargetForm = { id?: string; name: string; jobPath: string };
type ProjectForm = {
  id?: string;
  name: string;
  jenkinsUrl: string;
  username: string;
  secret: string;
  hasSecret: boolean; // 기존에 토큰이 저장돼 있는지 (placeholder 표시용)
  targets: TargetForm[];
};

const emptyForm = (): ProjectForm => ({
  name: '',
  jenkinsUrl: '',
  username: '',
  secret: '',
  hasSecret: false,
  targets: [{ name: '', jobPath: '' }],
});

const toForm = (p: DeployProjectView): ProjectForm => ({
  id: p.id,
  name: p.name,
  jenkinsUrl: p.jenkinsUrl,
  username: p.username,
  secret: '',
  hasSecret: p.hasSecret,
  targets: p.targets.map((t) => ({ ...t })),
});

const statusKey = (projectId: string, targetId: string) =>
  `${projectId}:${targetId}`;

const isBusy = (s?: DeployStatus) =>
  s?.state === 'queued' || s?.state === 'building';

const formatTime = (ts?: number) =>
  ts ? new Date(ts).toLocaleString('ko-KR') : '';

// "5분 전" 형태의 상대 시간 (일주일 넘으면 날짜로)
const formatRelative = (ts: number) => {
  const min = Math.floor((Date.now() - ts) / 60000);
  if (min < 1) return '방금 전';
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}일 전`;
  return new Date(ts).toLocaleDateString('ko-KR');
};

// 배지 옆 마지막 배포(완료) 시각 — 호버 시 정확한 일시 툴팁
function FinishedTime({ ts }: { ts?: number }) {
  if (!ts) return null;
  return (
    <span className="deploy__badge-time" title={formatTime(ts)}>
      {formatRelative(ts)}
    </span>
  );
}

// 커밋 내역 펼침 패널 상태
type DetailState = {
  open: boolean;
  loading: boolean;
  detail?: DeployBuildDetail;
  error?: string;
};

// ── 빌드 상세(커밋 내역) 패널 ──
function BuildDetailPanel({ state }: { state: DetailState }) {
  if (state.loading)
    return <div className="deploy__detail">불러오는 중...</div>;
  if (state.error)
    return <div className="deploy__detail">⚠️ {state.error}</div>;
  const d = state.detail;
  if (!d) return null;

  return (
    <div className="deploy__detail">
      <div className="deploy__detail-head">
        <b>#{d.number}</b>
        {d.timestamp ? ` · ${formatTime(d.timestamp)}` : ''}
        {d.startedBy ? ` · ${d.startedBy}` : ''}
      </div>
      {(d.revision || d.branch || d.repoUrl) && (
        <div className="deploy__detail-git">
          {d.revision && <code>{d.revision.slice(0, 8)}</code>}
          {d.branch && <span> · {d.branch}</span>}
          {d.repoUrl && <span> · {d.repoUrl}</span>}
        </div>
      )}
      {d.commits.length === 0 ? (
        <p className="deploy__detail-empty">
          이 빌드에 포함된 변경(커밋)이 없습니다.
        </p>
      ) : (
        d.commits.map((c, i) => {
          const [title, ...rest] = c.message.split('\n');
          const body = rest.join('\n').trim();
          return (
            <div className="deploy__commit" key={c.id || i}>
              <div className="deploy__commit-title">{title}</div>
              {body && <pre className="deploy__commit-body">{body}</pre>}
              <div className="deploy__commit-meta">
                {c.author}
                {c.timestamp ? ` · ${formatTime(c.timestamp)}` : ''}
                {c.id ? ` · ${c.id.slice(0, 7)}` : ''}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

// ── 상태 배지 ──
function StatusBadge({ status }: { status?: DeployStatus }) {
  if (!status || status.state === 'idle')
    return <span className="deploy__badge">빌드 이력 없음</span>;
  const num = status.buildNumber ? ` #${status.buildNumber}` : '';
  switch (status.state) {
    case 'queued':
      return (
        <span className="deploy__badge deploy__badge--busy">⏳ 대기중</span>
      );
    case 'building':
      return (
        <span className="deploy__badge deploy__badge--busy">
          🔄 빌드중{num}
        </span>
      );
    case 'success':
      return (
        <>
          <span className="deploy__badge deploy__badge--ok">✅ 성공{num}</span>
          <FinishedTime ts={status.finishedAt} />
        </>
      );
    case 'failure':
      return (
        <>
          <span className="deploy__badge deploy__badge--fail">
            ❌ {status.result === 'ABORTED' ? '중단됨' : '실패'}
            {num}
          </span>
          <FinishedTime ts={status.finishedAt} />
        </>
      );
    case 'error':
      return (
        <span className="deploy__badge deploy__badge--fail">
          ⚠️ {status.error ?? '오류'}
        </span>
      );
  }
}

/** 배포 섹션 — 프로젝트별 젠킨스 잡을 버튼 한 번으로 배포한다. */
export function DeploySection() {
  const [projects, setProjects] = useState<DeployProjectView[]>([]);
  const [statuses, setStatuses] = useState<Record<string, DeployStatus>>({});
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<ProjectForm | null>(null); // null 이면 목록 화면
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
  const loadDetail = async (
    projectId: string,
    targetId: string,
    buildNumber?: number,
  ) => {
    const key = statusKey(projectId, targetId);
    setDetails((prev) => ({ ...prev, [key]: { open: true, loading: true } }));
    const res = await window.oneApp.deploy.getBuildDetail(
      projectId,
      targetId,
      buildNumber,
    );
    setDetails((prev) => ({
      ...prev,
      [key]: {
        open: true,
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

  const setTarget = (idx: number, patch: Partial<TargetForm>) => {
    setForm((f) =>
      f
        ? {
            ...f,
            targets: f.targets.map((t, i) =>
              i === idx ? { ...t, ...patch } : t,
            ),
          }
        : f,
    );
  };

  // ── 프로젝트 추가/편집 폼 ──
  if (form) {
    return (
      <div className="sched">
        <h2 className="sched__title">
          🚀 {form.id ? '프로젝트 편집' : '프로젝트 추가'}
        </h2>
        <p className="sched__sub">
          프로젝트의 젠킨스 정보와 배포 대상(스토어/어드민 등)을 등록합니다.
        </p>

        <div className="sched__row">
          <label className="sched__label">프로젝트명</label>
          <input
            className="sched__input"
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="예: 메타커머스"
            autoComplete="off"
          />
        </div>

        <div className="sched__row">
          <label className="sched__label">젠킨스 URL</label>
          <input
            className="sched__input"
            type="text"
            value={form.jenkinsUrl}
            onChange={(e) => setForm({ ...form, jenkinsUrl: e.target.value })}
            placeholder="예: https://jenkins.example.com"
            autoComplete="off"
          />
        </div>

        <div className="sched__row">
          <label className="sched__label">아이디</label>
          <input
            className="sched__input"
            type="text"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            placeholder="젠킨스 아이디"
            autoComplete="off"
          />
        </div>

        <div className="sched__row">
          <label className="sched__label">API 토큰</label>
          <input
            className="sched__input"
            type="password"
            value={form.secret}
            onChange={(e) => setForm({ ...form, secret: e.target.value })}
            placeholder={
              form.hasSecret
                ? '●●●●●●  (저장됨 — 바꿀 때만 입력)'
                : 'API 토큰 또는 비밀번호'
            }
            autoComplete="off"
          />
        </div>

        <p className="sched__note">
          🔐 젠킨스 <b>내 계정 → 설정(Configure) → API Token</b> 에서 발급한
          토큰 권장. 비밀번호도 동작하지만 젠킨스 보안 설정에 따라 막힐 수
          있습니다. 값은 macOS 키체인으로 <b>암호화</b>되어 이 기기에만
          저장됩니다.
        </p>

        <label className="sched__label sched__label--log">배포 대상</label>
        {form.targets.map((t, i) => (
          <div className="sched__row" key={t.id ?? `new-${i}`}>
            <input
              className="sched__input"
              style={{ maxWidth: 180 }}
              type="text"
              value={t.name}
              onChange={(e) => setTarget(i, { name: e.target.value })}
              placeholder="표시명 (예: 스토어)"
              autoComplete="off"
            />
            <input
              className="sched__input"
              type="text"
              value={t.jobPath}
              onChange={(e) => setTarget(i, { jobPath: e.target.value })}
              placeholder="젠킨스 잡 이름 (폴더 안이면 폴더/잡)"
              autoComplete="off"
            />
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() =>
                setForm({
                  ...form,
                  targets: form.targets.filter((_, idx) => idx !== i),
                })
              }
              disabled={form.targets.length <= 1}
              title="이 배포 대상 삭제"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() =>
            setForm({
              ...form,
              targets: [...form.targets, { name: '', jobPath: '' }],
            })
          }
        >
          + 배포 대상 추가
        </button>

        {formError && <p className="sched__banner">{formError}</p>}

        <div className="sched__actions">
          <button type="button" className="btn btn--primary" onClick={saveForm}>
            저장
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              setForm(null);
              setFormError('');
            }}
          >
            취소
          </button>
        </div>
      </div>
    );
  }

  // ── 프로젝트 목록 ──
  return (
    <div className="sched">
      <div className="deploy__head">
        <div>
          <h2 className="sched__title">🚀 배포</h2>
          <p className="sched__sub">
            프로젝트별 젠킨스 잡을 버튼 한 번으로 배포합니다.
          </p>
        </div>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => setForm(emptyForm())}
        >
          + 프로젝트 추가
        </button>
      </div>

      {loading ? (
        <p className="sched__hint">불러오는 중...</p>
      ) : projects.length === 0 ? (
        <div className="deploy__empty">
          <p>등록된 프로젝트가 없습니다.</p>
          <p className="sched__hint">
            [+ 프로젝트 추가] 를 눌러 젠킨스 정보와 배포 대상을 등록하세요.
          </p>
        </div>
      ) : (
        projects.map((p) => (
          <div className="deploy__card" key={p.id}>
            <div className="deploy__card-head">
              <div>
                <span className="deploy__project-name">{p.name}</span>
                <span className="deploy__project-url">{p.jenkinsUrl}</span>
              </div>
              <div className="deploy__card-actions">
                <button
                  type="button"
                  className={
                    refreshingIds.has(p.id)
                      ? 'deploy__refresh deploy__refresh--spinning'
                      : 'deploy__refresh'
                  }
                  onClick={() => refreshProject(p)}
                  disabled={!p.hasSecret || refreshingIds.has(p.id)}
                  title="이 프로젝트의 빌드 상태 새로고침"
                  aria-label="새로고침"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                    <path d="M21 3v6h-6" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => setForm(toForm(p))}
                >
                  편집
                </button>
                <button
                  type="button"
                  className="btn btn--danger"
                  onClick={() => removeProject(p)}
                >
                  삭제
                </button>
              </div>
            </div>

            {!p.hasSecret && (
              <p className="sched__banner">
                ⚠️ 젠킨스 계정이 저장되지 않았습니다. [편집]에서 API 토큰을
                입력하세요.
              </p>
            )}

            {p.targets.map((t) => {
              const key = statusKey(p.id, t.id);
              const status = statuses[key];
              const detail = details[key];
              return (
                <div key={t.id}>
                  <div className="deploy__target">
                    <span className="deploy__target-name">{t.name}</span>
                    <button
                      type="button"
                      className="btn btn--primary"
                      onClick={() => deploy(p.id, t.id)}
                      disabled={!p.hasSecret || isBusy(status)}
                    >
                      배포
                    </button>
                    <StatusBadge status={status} />
                    <button
                      type="button"
                      className="deploy__detail-toggle"
                      onClick={() => toggleDetail(p.id, t.id)}
                      disabled={!p.hasSecret}
                    >
                      커밋 내역 {detail?.open ? '▾' : '▸'}
                    </button>
                  </div>
                  {detail?.open && <BuildDetailPanel state={detail} />}
                </div>
              );
            })}
          </div>
        ))
      )}
    </div>
  );
}
