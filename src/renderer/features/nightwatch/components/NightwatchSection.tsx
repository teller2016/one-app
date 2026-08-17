import type {
  NightwatchCandidate,
  NightwatchConfig,
  NightwatchStatus,
  NightwatchTicket,
  Project,
} from "../../../../shared/types";
import { Badge } from "../../../components/Badge";
import { Banner } from "../../../components/Banner";
import { Button } from "../../../components/Button";
import { Collapsible } from "../../../components/Collapsible";
import { useConfirm } from "../../../components/ConfirmDialog";
import { FormRow } from "../../../components/FormRow";
import { Icon } from "../../../components/Icon";
import { Input } from "../../../components/Input";
import { Markdown } from "../../../components/Markdown";
import { Modal } from "../../../components/Modal";
import { RefreshButton } from "../../../components/RefreshButton";
import { Select } from "../../../components/Select";
import { SectionHeader } from "../../../components/SectionHeader";
import { Segment } from "../../../components/Segment";
import { Textarea } from "../../../components/Textarea";
import { useToast } from "../../../components/Toast";
import { EmptyState } from "../../../components/EmptyState";
import { usePolling } from "../../../lib/usePolling";
import { useAsync } from "../../../lib/useAsync";
import { errMsg, resultError } from "../../../lib/errMsg";
import { useCopy } from "../../../lib/useCopy";
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
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [missionLog, setMissionLog] = useState("");
  const [log, setLog] = useState("");
  const [modal, setModal] = useState<{ title: string; content: string } | null>(
    null
  );
  const [pick, setPick] = useState<{
    key: string;
    repoId: string;
    model: string; // '' = CLI 기본
    note: string;
  } | null>(
    null
  );
  const [error, setError] = useState("");
  const [form, setForm] = useState<NightwatchConfig | null>(null);
  const [projects, setProjects] = useState<Project[]>([]); // 분석 대상 — 프로젝트 레지스트리
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
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // 후보 목록은 조회 한 건이라 loading·error 를 useAsync 에 맡긴다
  // (실패는 throw 로 올려야 훅이 error 로 잡는다 — IPC 는 { ok, error } 로 준다)
  const fetchCandidates = useCallback(async () => {
    const res = await window.oneApp.nightwatch.listCandidates();
    if (!res.ok) throw new Error(resultError(res, "후보 조회에 실패했습니다"));
    return { list: res.candidates ?? [], hidden: res.hiddenCount ?? 0 };
  }, []);
  const {
    data: candidateData,
    loading: candidatesLoading,
    error: candidatesError,
    reload: loadCandidates,
  } = useAsync(fetchCandidates, { immediate: false });
  const candidates = candidateData?.list ?? null;
  const hiddenCount = candidateData?.hidden ?? 0;

  // 최초 로드 + 1분 자동 새로고침 (로컬 파일 읽기라 저렴)
  usePolling(load, 60_000);

  // 분석 대상 프로젝트 — 레지스트리 구독 (프로젝트 탭의 변경 즉시 반영)
  useEffect(() => {
    void window.oneApp.projects.list().then(setProjects);
    return window.oneApp.projects.onChanged(setProjects);
  }, []);

  // 티켓 키의 Jira 프로젝트 키 — "BBJ-123" → "BBJ" (프로젝트 매칭용)
  const jiraKeyOf = (ticketKey: string) => ticketKey.split("-")[0];

  // Jira 연동이 확인되면 후보 목록 1회 자동 조회 (이후엔 새로고침 버튼)
  useEffect(() => {
    if (status?.jiraConfigured && !candidatesLoaded.current) {
      candidatesLoaded.current = true;
      void loadCandidates();
    }
  }, [status?.jiraConfigured, loadCandidates]);

  const analyze = async (
    key: string,
    repoId: string,
    opts?: { model?: string; note?: string },
  ) => {
    // 이미 미션이 돌고 있으면 대기열 추가라 promise 가 즉시 돌아온다
    const queued = !!runningKey;
    if (!queued) {
      setAnalyzing(key);
      setMissionLog("");
    }
    try {
      // 직접 실행이면 미션이 끝날 때까지(수 분~타임아웃) promise 가 유지된다
      const res = await window.oneApp.nightwatch.analyze(key, repoId, opts);
      toast(res.output, res.ok ? undefined : "fail");
    } finally {
      if (!queued) setAnalyzing(null);
      await Promise.all([load(), loadCandidates()]);
    }
  };

  // [분석] 클릭 → 프로젝트·모델·부가설명 선택 모달
  // 기본 선택: 학습값(suggestedRepoId) → 티켓의 Jira 키와 일치하는 프로젝트 → 첫 프로젝트
  const openPick = (c: NightwatchCandidate) => {
    const def =
      projects.find((p) => p.id === c.suggestedRepoId)?.id ??
      projects.find((p) => p.jiraProjectKey === jiraKeyOf(c.key))?.id ??
      projects[0]?.id ??
      "";
    setPick({ key: c.key, repoId: def, model: "", note: "" });
  };

  // [재분석] 클릭 → 이전에 분석한 프로젝트(원장엔 이름 문자열)를 기본 선택해 같은 모달을 연다
  const openReanalyze = (t: NightwatchTicket) => {
    const def =
      projects.find((p) => p.name === t.repo)?.id ??
      projects.find((p) => p.jiraProjectKey === jiraKeyOf(t.key))?.id ??
      projects[0]?.id ??
      "";
    setPick({ key: t.key, repoId: def, model: "", note: "" });
  };

  const confirmPick = () => {
    if (!pick?.repoId) return;
    const { key, repoId, model, note } = pick;
    setPick(null);
    void analyze(key, repoId, {
      model: model || undefined,
      note: note.trim() || undefined,
    });
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
  const copy = useCopy();
  const copyPrompt = async (key: string) => {
    const res = await window.oneApp.nightwatch.getPrompt(key);
    if (!res.ok || !res.content) {
      toast(res.error ?? "프롬프트를 불러오지 못했습니다", "fail");
      return;
    }
    await copy(res.content, {
      success: "작업 프롬프트를 복사했습니다 — Claude Code에 붙여넣으세요",
      fail: "클립보드 복사 실패 — 창을 클릭한 뒤 다시 시도해 주세요",
    });
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

  const patch = (p: Partial<NightwatchConfig>) =>
    setForm((f) => (f ? { ...f, ...p } : f));

  const openJira = (key: string) => {
    if (status?.jiraBaseUrl) {
      void window.oneApp.openExternal(`${status.jiraBaseUrl}/browse/${key}`);
    }
  };

  // 이 창에서 시작한 분석(analyzing) 또는 다른 경로로 도는 미션(status.running)
  const runningKey = analyzing ?? (status?.running ? status.currentTicket : null);
  const queuedKeys = status?.queue ?? [];
  const isTeamAccount = !!form?.claudeConfigDir.endsWith(".claude-team");

  // 실행·대기 중엔 상태를 5초 간격으로 — 대기열이 다음 티켓으로 넘어가는 걸 빠르게 반영.
  // usePolling 을 쓰면 창이 백그라운드일 때 주기가 저절로 느슨해진다(직접 돌리던 인터벌은
  // 다른 앱을 보는 내내 5초마다 Jira·파일을 훑었다).
  const missionActive = !!status?.running || queuedKeys.length > 0;
  const pollActive = useCallback(() => {
    void load();
  }, [load]);
  usePolling(pollActive, 5_000, { enabled: missionActive, immediate: false });

  // 실행 중 미션 진행 로그 라이브 tail (3초 폴링)
  const runningKeyRef = useRef(runningKey);
  runningKeyRef.current = runningKey;
  const pollMissionLog = useCallback(() => {
    const key = runningKey;
    if (!key) return;
    void window.oneApp.nightwatch.getMissionLog(key).then((res) => {
      // 응답이 오는 사이 다른 티켓으로 넘어갔으면 그 결과는 버린다
      if (runningKeyRef.current !== key) return;
      if (res.ok && res.content) setMissionLog(res.content);
    });
  }, [runningKey]);
  usePolling(pollMissionLog, 3_000, { enabled: !!runningKey });

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

      {status?.jiraConfigured && projects.length === 0 && (
        <Banner variant="warning">
          <b>프로젝트</b> 탭에서 분석 대상 프로젝트(로컬 경로)를 먼저 등록하세요.
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
              <EmptyState
                className="nightwatch__empty"
                message={
                  <>
                    {status && status.tickets.length > 0
                      ? "새로 분석할 티켓이 없습니다 — 처리한 티켓은 아래에서 [재분석]할 수 있어요"
                      : "내게 할당된 미해결 티켓이 없습니다"}
                    {hiddenCount > 0 ? ` (숨김 ${hiddenCount}건 제외)` : ""}.
                  </>
                }
              />
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
                    <Button
                      variant="ghost"
                      size="sm"
                      loading={analyzing === t.key}
                      disabled={
                        t.key === runningKey || queuedKeys.includes(t.key)
                      }
                      onClick={() => openReanalyze(t)}
                      title={
                        runningKey
                          ? "저장소를 골라 대기열에 추가합니다 (현재 미션이 끝나면 순서대로 실행)"
                          : "이 티켓을 같은 저장소에서 다시 분석합니다"
                      }
                    >
                      {queuedKeys.includes(t.key) ? "대기 중" : "재분석"}
                    </Button>
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
          <FormRow label="분석 대상 프로젝트">
            <p className="hint">
              분석 대상은 <b>프로젝트</b> 탭에서 관리합니다. (로컬 경로가 있는
              프로젝트가 후보로 표시됩니다)
            </p>
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
          {/* 래퍼 클래스는 모달 확장(:has 선택자) 후크 — 스크롤은 modal__body 가 담당 */}
          <div className="nightwatch__report">
            <Markdown>{modal.content}</Markdown>
          </div>
        </Modal>
      )}

      {pick && status && (
        <Modal
          title={`${pick.key} — 분석 설정`}
          onClose={() => setPick(null)}
        >
          <div className="nightwatch__pick-opts">
            <FormRow label="프로젝트" column>
              {projects.length === 0 ? (
                <p className="hint">
                  등록된 프로젝트가 없습니다 — <b>프로젝트</b> 탭에서 먼저
                  등록해 주세요.
                </p>
              ) : (
                <>
                  <Select
                    className="nightwatch__repo-select"
                    aria-label="프로젝트 선택"
                    value={pick.repoId}
                    onChange={(repoId) => setPick({ ...pick, repoId })}
                    options={[...projects]
                      .sort(
                        // 티켓의 Jira 키와 일치하는 프로젝트를 앞으로 (안정 정렬 — 나머지 순서 유지)
                        (a, b) =>
                          Number(b.jiraProjectKey === jiraKeyOf(pick.key)) -
                          Number(a.jiraProjectKey === jiraKeyOf(pick.key))
                      )
                      .map((p) => ({ value: p.id, label: p.name }))}
                  />
                  <p className="hint nightwatch__repo-hint">
                    {projects.find((p) => p.id === pick.repoId)?.localPath ??
                      "프로젝트를 선택하세요"}
                    {" — "}현재 체크아웃 그대로 분석하며, 선택은 같은
                    프로젝트·말머리 조합에 기억됩니다.
                  </p>
                </>
              )}
            </FormRow>
            <FormRow label="모델" column>
              <Segment
                options={[
                  { value: "", label: "기본" },
                  { value: "fable", label: "Fable" },
                  { value: "opus", label: "Opus" },
                  { value: "sonnet", label: "Sonnet" },
                  { value: "haiku", label: "Haiku" },
                ]}
                value={pick.model}
                onChange={(v) => setPick({ ...pick, model: v })}
              />
            </FormRow>
            <FormRow label="부가설명 (선택)" column>
              <Textarea
                rows={3}
                value={pick.note}
                placeholder="재현 경로·의심 지점·참고 맥락 등 분석에 참고할 내용"
                onChange={(e) => setPick({ ...pick, note: e.target.value })}
              />
            </FormRow>
          </div>
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
