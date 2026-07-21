import type {
  NightwatchCandidate,
  NightwatchConfig,
  NightwatchRepo,
  NightwatchStatus,
} from "../../../../shared/types";
import { Badge } from "../../../components/Badge";
import { Banner } from "../../../components/Banner";
import { Button } from "../../../components/Button";
import { Collapsible } from "../../../components/Collapsible";
import { useConfirm } from "../../../components/ConfirmDialog";
import { FormRow } from "../../../components/FormRow";
import { Icon } from "../../../components/Icon";
import { Input } from "../../../components/Input";
import { Modal } from "../../../components/Modal";
import { RefreshButton } from "../../../components/RefreshButton";
import { SectionHeader } from "../../../components/SectionHeader";
import { Segment } from "../../../components/Segment";
import { useToast } from "../../../components/Toast";
import { useCallback, useEffect, useRef, useState } from "react";

/** 티켓 상태 → 뱃지 변형·한글 라벨 */
const ticketBadge = (
  status: string
): { variant: "busy" | "ok" | "fail" | "idle"; label: string } => {
  switch (status) {
    case "analyzed":
      return { variant: "ok", label: "분석 완료" };
    case "in_progress":
      return { variant: "busy", label: "진행 중" };
    case "failed":
      return { variant: "fail", label: "실패" };
    case "violation_edited":
      return { variant: "fail", label: "계약 위반" };
    default:
      return { variant: "idle", label: status };
  }
};

/**
 * Nightwatch — Jira 버그 티켓 헤드리스 분석 (수동 실행 전용).
 * Jira 섹션과 같은 '내 미해결 이슈' 중 버그만 후보로 보여주고, [분석]에서
 * 저장소를 골라 시작하면 그 저장소의 현재 체크아웃에서 헤드리스 Claude
 * 미션이 돌아 리포트 + 작업 프롬프트를 만든다. 실행 중 추가한 티켓은
 * 대기열로 순차 실행. Jira 자격증명은 환경설정 → 연동 공용.
 */
export function NightwatchSection() {
  const [status, setStatus] = useState<NightwatchStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<NightwatchCandidate[] | null>(
    null
  );
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [candidatesError, setCandidatesError] = useState("");
  const [hiddenCount, setHiddenCount] = useState(0);
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [missionLog, setMissionLog] = useState("");
  const [log, setLog] = useState("");
  const [modal, setModal] = useState<{ title: string; content: string } | null>(
    null
  );
  const [pick, setPick] = useState<{ key: string; repoId: string } | null>(
    null
  );
  const [error, setError] = useState("");
  const [form, setForm] = useState<NightwatchConfig | null>(null);
  const candidatesLoaded = useRef(false);
  const missionLogRef = useRef<HTMLPreElement | null>(null);
  const toast = useToast();
  const confirm = useConfirm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 구버전 preload 가 남아 있으면(핫리로드 범위 밖) API 가 없다 — 재시작 안내
      if (!window.oneApp.nightwatch?.analyze) {
        throw new Error(
          "새 기능이 아직 로드되지 않았습니다. 앱을 종료 후 npm start 로 다시 실행해 주세요."
        );
      }
      const [st, lg] = await Promise.all([
        window.oneApp.nightwatch.getStatus(),
        window.oneApp.nightwatch.getLog(),
      ]);
      setStatus(st);
      setForm((prev) => prev ?? st.config); // 편집 중이면 덮어쓰지 않는다
      setLog(lg.ok && lg.content ? lg.content : "");
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCandidates = useCallback(async () => {
    setCandidatesLoading(true);
    const res = await window.oneApp.nightwatch.listCandidates();
    if (res.ok) {
      setCandidates(res.candidates ?? []);
      setHiddenCount(res.hiddenCount ?? 0);
      setCandidatesError("");
    } else {
      setCandidatesError(res.error ?? "후보 조회에 실패했습니다");
    }
    setCandidatesLoading(false);
  }, []);

  // 최초 로드 + 1분 자동 새로고침 (로컬 파일 읽기라 저렴)
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  // Jira 연동이 확인되면 후보 목록 1회 자동 조회 (이후엔 새로고침 버튼)
  useEffect(() => {
    if (status?.jiraConfigured && !candidatesLoaded.current) {
      candidatesLoaded.current = true;
      void loadCandidates();
    }
  }, [status?.jiraConfigured, loadCandidates]);

  const analyze = async (key: string, repoId: string) => {
    // 이미 미션이 돌고 있으면 대기열 추가라 promise 가 즉시 돌아온다
    const queued = !!runningKey;
    if (!queued) {
      setAnalyzing(key);
      setMissionLog("");
    }
    try {
      // 직접 실행이면 미션이 끝날 때까지(수 분~타임아웃) promise 가 유지된다
      const res = await window.oneApp.nightwatch.analyze(key, repoId);
      toast(res.output, res.ok ? undefined : "fail");
    } finally {
      if (!queued) setAnalyzing(null);
      await Promise.all([load(), loadCandidates()]);
    }
  };

  // [분석] 클릭 → 저장소 선택 모달 (학습된 기본값 미리 선택)
  const openPick = (c: NightwatchCandidate) => {
    const repos = status?.config.repos ?? [];
    const def =
      repos.find((r) => r.id === c.suggestedRepoId)?.id ?? repos[0]?.id ?? "";
    setPick({ key: c.key, repoId: def });
  };

  const confirmPick = () => {
    if (!pick?.repoId) return;
    const { key, repoId } = pick;
    setPick(null);
    void analyze(key, repoId);
  };

  const stopAnalyze = async () => {
    const res = await window.oneApp.nightwatch.stop();
    toast(res.output, res.ok ? undefined : "fail");
  };

  // 분석이 필요 없는 티켓을 후보에서 제외 — 해결되면 숨김 목록에서 자동 정리
  const hideTicket = async (key: string) => {
    const res = await window.oneApp.nightwatch.hideCandidate(key);
    toast(res.output, res.ok ? undefined : "fail");
    await loadCandidates();
  };

  const unhideAll = async () => {
    const res = await window.oneApp.nightwatch.clearHidden();
    toast(res.output, res.ok ? undefined : "fail");
    await loadCandidates();
  };

  const saveForm = async () => {
    if (!form) return;
    setBusy("save");
    const st = await window.oneApp.nightwatch.saveConfig(form);
    setStatus(st);
    setForm(st.config);
    toast("설정을 저장했습니다");
    setBusy(null);
  };

  const openReport = async (key: string) => {
    setModal({ title: `${key} 분석 리포트`, content: "불러오는 중..." });
    const res = await window.oneApp.nightwatch.getReport(key);
    setModal({
      title: `${key} 분석 리포트`,
      content:
        res.ok && res.content
          ? res.content
          : res.error ?? "리포트를 불러오지 못했습니다",
    });
  };

  // 작업 프롬프트 복사 — 아침에 실제 저장소의 Claude Code 세션에 그대로 붙여넣는다
  const copyPrompt = async (key: string) => {
    const res = await window.oneApp.nightwatch.getPrompt(key);
    if (!res.ok || !res.content) {
      toast(res.error ?? "프롬프트를 불러오지 못했습니다", "fail");
      return;
    }
    try {
      await navigator.clipboard.writeText(res.content);
      toast("작업 프롬프트를 복사했습니다 — Claude Code에 붙여넣으세요");
    } catch {
      // 창이 포커스를 잃은 상태 등 클립보드 접근 실패
      toast("클립보드 복사 실패 — 창을 클릭한 뒤 다시 시도해 주세요", "fail");
    }
  };

  // 처리한 티켓 삭제 — 원장 기록 + 산출물 파일 (30일 경과분은 자동 정리)
  const removeTicket = async (key: string) => {
    const ok = await confirm({
      title: `${key} 분석 기록 삭제`,
      message: "리포트·작업 프롬프트·미션 로그·첨부 파일이 함께 삭제됩니다.",
      confirmLabel: "삭제",
      danger: true,
    });
    if (!ok) return;
    const res = await window.oneApp.nightwatch.deleteTicket(key);
    toast(res.output, res.ok ? undefined : "fail");
    await load();
  };

  const openMissionLog = async (key: string) => {
    setModal({ title: `${key} 미션 로그`, content: "불러오는 중..." });
    const res = await window.oneApp.nightwatch.getMissionLog(key);
    setModal({
      title: `${key} 미션 로그`,
      content:
        res.ok && res.content
          ? res.content
          : res.error ?? "미션 로그를 불러오지 못했습니다",
    });
  };

  const patch = (p: Partial<NightwatchConfig>) =>
    setForm((f) => (f ? { ...f, ...p } : f));

  const patchRepo = (index: number, p: Partial<NightwatchRepo>) =>
    setForm((f) =>
      f
        ? {
            ...f,
            repos: f.repos.map((r, i) => (i === index ? { ...r, ...p } : r)),
          }
        : f
    );

  const removeRepo = (index: number) =>
    setForm((f) =>
      f ? { ...f, repos: f.repos.filter((_, i) => i !== index) } : f
    );

  const addRepo = () =>
    setForm((f) =>
      f
        ? {
            ...f,
            repos: [...f.repos, { id: crypto.randomUUID(), name: "", path: "" }],
          }
        : f
    );

  const openJira = (key: string) => {
    if (status?.jiraBaseUrl) {
      void window.oneApp.openExternal(`${status.jiraBaseUrl}/browse/${key}`);
    }
  };

  // 이 창에서 시작한 분석(analyzing) 또는 다른 경로로 도는 미션(status.running)
  const runningKey = analyzing ?? (status?.running ? status.currentTicket : null);
  const queuedKeys = status?.queue ?? [];
  const isTeamAccount = !!form?.claudeConfigDir.endsWith(".claude-team");

  // 실행·대기 중엔 상태를 5초 간격으로 — 대기열이 다음 티켓으로 넘어가는 걸 빠르게 반영
  const missionActive = !!status?.running || queuedKeys.length > 0;
  useEffect(() => {
    if (!missionActive) return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [missionActive, load]);

  // 실행 중 미션 진행 로그 라이브 tail (3초 폴링)
  useEffect(() => {
    if (!runningKey) return;
    let cancelled = false;
    const tick = async () => {
      const res = await window.oneApp.nightwatch.getMissionLog(runningKey);
      if (!cancelled && res.ok && res.content) setMissionLog(res.content);
    };
    void tick();
    const timer = setInterval(() => void tick(), 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [runningKey]);

  // 새 로그가 붙으면 맨 아래로 스크롤 유지
  useEffect(() => {
    const el = missionLogRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [missionLog]);

  return (
    <div className="section">
      <div className="nightwatch__head">
        <SectionHeader
          title="Nightwatch"
          icon={<Icon name="moon" size={18} />}
          sub="Jira 버그 티켓을 골라 headless Claude 분석을 돌리고, 결과를 리포트로 확인합니다."
        />
        <RefreshButton
          size={14}
          spinning={loading}
          onClick={() => void load()}
          title="상태 새로고침"
        />
      </div>

      {error && <Banner variant="danger">{error}</Banner>}
      {status && !status.jiraConfigured && (
        <Banner variant="warning">
          환경설정 → 연동에서 Jira 주소·이메일·API 토큰을 입력하면 동작합니다.
          (Jira 섹션과 공용)
        </Banner>
      )}
      {status && !status.claudeFound && (
        <Banner variant="danger">
          claude 바이너리를 찾을 수 없습니다. Claude Code 설치를 확인해 주세요.
        </Banner>
      )}

      {status && status.jiraConfigured && (
        <>
          <div className="nightwatch__list-head">
            <span className="form-label">작업 가능한 티켓</span>
            <div className="nightwatch__list-actions">
              {hiddenCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void unhideAll()}
                  title="숨김 처리한 티켓을 모두 다시 표시합니다"
                >
                  숨김 {hiddenCount}건 해제
                </Button>
              )}
              {runningKey && (
                <>
                  <Badge variant="busy">{runningKey} 분석 중</Badge>
                  {queuedKeys.length > 0 && (
                    <span className="nightwatch__dim">
                      대기 {queuedKeys.length}건
                    </span>
                  )}
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => void stopAnalyze()}
                    title={
                      queuedKeys.length
                        ? "실행 중 미션을 중지하고 대기열도 비웁니다"
                        : "실행 중 미션을 중지합니다"
                    }
                  >
                    중지
                  </Button>
                </>
              )}
              <RefreshButton
                size={13}
                spinning={candidatesLoading}
                onClick={() => void loadCandidates()}
                title="후보 새로고침"
              />
            </div>
          </div>
          {runningKey && (
            <div className="panel-sunken panel-sunken--log nightwatch__mission">
              <pre ref={missionLogRef}>
                {missionLog || "미션 시작 중..."}
              </pre>
            </div>
          )}
          {candidatesError && <Banner variant="danger">{candidatesError}</Banner>}
          {candidates &&
            (candidates.length === 0 ? (
              <div className="empty-state">
                <p>
                  내게 할당된 미해결 티켓이 없습니다
                  {hiddenCount > 0 ? ` (숨김 ${hiddenCount}건 제외)` : ""}.
                </p>
              </div>
            ) : (
              <div className="nightwatch__list">
                {candidates.map((c) => (
                  <div className="nightwatch__row" key={c.key}>
                    <div className="nightwatch__row-main">
                      <div className="nightwatch__row-meta">
                        <button
                          type="button"
                          className="nightwatch__key"
                          onClick={() => openJira(c.key)}
                          title={`${c.key} — Jira에서 열기`}
                        >
                          {c.key}
                        </button>
                        <span className="nightwatch__dim">{c.issueType}</span>
                        <span className="nightwatch__dim">{c.status}</span>
                        {c.priority && (
                          <span className="nightwatch__dim">{c.priority}</span>
                        )}
                        {c.processedStatus && (
                          <Badge
                            variant={ticketBadge(c.processedStatus).variant}
                          >
                            {ticketBadge(c.processedStatus).label}
                          </Badge>
                        )}
                      </div>
                      <div className="nightwatch__row-title" title={c.summary}>
                        {c.summary}
                      </div>
                    </div>
                    <div className="nightwatch__row-actions">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={
                          c.key === runningKey || queuedKeys.includes(c.key)
                        }
                        onClick={() => void hideTicket(c.key)}
                        title="분석이 필요 없는 티켓을 후보에서 제외합니다"
                      >
                        숨김
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={analyzing === c.key}
                        disabled={
                          c.key === runningKey || queuedKeys.includes(c.key)
                        }
                        onClick={() => openPick(c)}
                        title={
                          runningKey
                            ? "저장소를 골라 대기열에 추가합니다 (현재 미션이 끝나면 순서대로 실행)"
                            : "저장소를 골라 이 티켓 분석을 시작합니다"
                        }
                      >
                        {queuedKeys.includes(c.key) ? "대기 중" : "분석"}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ))}
        </>
      )}

      {status && status.tickets.length > 0 && (
        <>
          <div className="nightwatch__list-head">
            <span className="form-label">처리한 티켓</span>
          </div>
          <div className="nightwatch__list">
            {status.tickets.map((t) => {
              const badge = ticketBadge(t.status);
              return (
                <div className="nightwatch__row" key={t.key}>
                  <div className="nightwatch__row-main">
                    <div className="nightwatch__row-meta">
                      <button
                        type="button"
                        className="nightwatch__key"
                        onClick={() => openJira(t.key)}
                        title={`${t.key} — Jira에서 열기`}
                      >
                        {t.key}
                      </button>
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                      {t.repo && (
                        <span className="nightwatch__dim">{t.repo}</span>
                      )}
                      {typeof t.durationMin === "number" && (
                        <span className="nightwatch__dim">
                          {t.durationMin}분
                          {typeof t.costUsd === "number"
                            ? ` · $${t.costUsd.toFixed(2)}`
                            : ""}
                        </span>
                      )}
                    </div>
                    {/* 본문은 티켓 명칭 — 분석 요약·에러는 툴팁(전문은 리포트)으로 */}
                    <div
                      className="nightwatch__row-title"
                      title={t.summary ?? t.error ?? undefined}
                    >
                      {t.title ?? t.summary ?? t.error ?? "—"}
                    </div>
                  </div>
                  <div className="nightwatch__row-actions">
                    {t.prompt && (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => void copyPrompt(t.key)}
                        title="작업 지시문을 클립보드로 복사 — Claude Code 세션에 붙여넣어 바로 작업 시작"
                      >
                        프롬프트 복사
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void openMissionLog(t.key)}
                    >
                      로그
                    </Button>
                    {t.report && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void openReport(t.key)}
                      >
                        리포트
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={t.key === runningKey}
                      onClick={() => void removeTicket(t.key)}
                      title="분석 기록과 산출물 파일을 삭제합니다 (30일 지나면 자동 정리)"
                    >
                      삭제
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {form && (
        <Collapsible
          title="설정"
          icon={<Icon name="settings" size={14} />}
          storageKey="nightwatch:settings"
        >
          <FormRow label="분석 대상 저장소 목록" column>
            <div className="nightwatch__repo-form">
              {form.repos.map((r, i) => (
                <div className="nightwatch__repo-row" key={r.id}>
                  <Input
                    small
                    value={r.name}
                    placeholder="이름"
                    onChange={(e) => patchRepo(i, { name: e.target.value })}
                  />
                  <Input
                    value={r.path}
                    placeholder="/Users/me/projects/..."
                    onChange={(e) => patchRepo(i, { path: e.target.value })}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeRepo(i)}
                  >
                    삭제
                  </Button>
                </div>
              ))}
              <Button variant="ghost" size="sm" onClick={addRepo}>
                저장소 추가
              </Button>
            </div>
          </FormRow>
          <FormRow label="티켓당 타임아웃(분)">
            <Input
              small
              type="number"
              value={String(form.timeoutMinutes)}
              onChange={(e) =>
                patch({ timeoutMinutes: Number(e.target.value) })
              }
            />
          </FormRow>
          <FormRow label="분석 Claude 계정">
            <Segment
              options={[
                { value: "personal", label: "개인" },
                { value: "team", label: "공용" },
              ]}
              value={isTeamAccount ? "team" : "personal"}
              onChange={(v) =>
                patch({
                  claudeConfigDir:
                    v === "team"
                      ? form.claudeConfigDir.replace(
                          /\.claude(-team)?$/,
                          ".claude-team"
                        )
                      : form.claudeConfigDir.replace(
                          /\.claude(-team)?$/,
                          ".claude"
                        ),
                })
              }
            />
          </FormRow>
          <div className="form-actions">
            <Button
              variant="primary"
              size="sm"
              loading={busy === "save"}
              onClick={() => void saveForm()}
            >
              저장
            </Button>
          </div>
        </Collapsible>
      )}

      {status && log && (
        <Collapsible
          title="실행 로그"
          icon={<Icon name="clock" size={14} />}
          storageKey="nightwatch:log"
        >
          <pre className="nightwatch__log">{log}</pre>
        </Collapsible>
      )}

      {modal && (
        <Modal title={modal.title} onClose={() => setModal(null)} wide>
          <pre className="nightwatch__report">{modal.content}</pre>
        </Modal>
      )}

      {pick && status && (
        <Modal
          title={`${pick.key} — 분석할 저장소 선택`}
          onClose={() => setPick(null)}
        >
          <div className="nightwatch__repos">
            {status.config.repos.map((r) => (
              <button
                type="button"
                key={r.id}
                className={`nightwatch__repo${
                  pick.repoId === r.id ? " nightwatch__repo--on" : ""
                }`}
                onClick={() => setPick({ ...pick, repoId: r.id })}
              >
                <span className="nightwatch__repo-name">{r.name}</span>
                <span className="nightwatch__repo-path">{r.path}</span>
              </button>
            ))}
          </div>
          <p className="hint">
            현재 체크아웃 그대로 분석합니다 (브랜치 전환·수정 없음). 선택은
            같은 프로젝트·말머리 조합에 기억됩니다.
          </p>
          <div className="form-actions">
            <Button
              variant="primary"
              size="sm"
              disabled={!pick.repoId}
              onClick={confirmPick}
            >
              분석 시작
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
