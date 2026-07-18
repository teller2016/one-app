import type {
  NightwatchConfig,
  NightwatchStatus,
} from "../../../../shared/types";
import { Badge } from "../../../components/Badge";
import { Banner } from "../../../components/Banner";
import { Button } from "../../../components/Button";
import { Collapsible } from "../../../components/Collapsible";
import { FormRow } from "../../../components/FormRow";
import { Icon } from "../../../components/Icon";
import { Input } from "../../../components/Input";
import { Modal } from "../../../components/Modal";
import { RefreshButton } from "../../../components/RefreshButton";
import { SectionHeader } from "../../../components/SectionHeader";
import { Segment } from "../../../components/Segment";
import { Textarea } from "../../../components/Textarea";
import { useToast } from "../../../components/Toast";
import { useCallback, useEffect, useState } from "react";

/** 티켓 상태 → 뱃지 변형·한글 라벨 */
const ticketBadge = (
  status: string
): { variant: "busy" | "ok" | "fail" | "idle"; label: string } => {
  switch (status) {
    case "analyzed":
      return { variant: "ok", label: "분석 완료" };
    case "committed":
      return { variant: "ok", label: "커밋 완료" };
    case "in_progress":
      return { variant: "busy", label: "진행 중" };
    case "failed":
      return { variant: "fail", label: "실패" };
    case "violation_edited":
      return { variant: "fail", label: "계약 위반" };
    case "analysis_only":
      return { variant: "idle", label: "분석 전용" };
    default:
      return { variant: "idle", label: status };
  }
};

/** 사이클 시각 표시 — 오늘이면 HH:MM, 아니면 M/D HH:MM */
const fmtCycleTime = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
  return d.toDateString() === new Date().toDateString()
    ? hm
    : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
};

/**
 * Nightwatch — 야간 무인 버그 분석 (one-app 내장 엔진 관리).
 * Jira 자격증명은 환경설정 → 연동 공용, 감시는 앱이 실행 중인 동안 동작한다.
 */
export function NightwatchSection() {
  const [status, setStatus] = useState<NightwatchStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [testOutput, setTestOutput] = useState("");
  const [log, setLog] = useState("");
  const [reportKey, setReportKey] = useState<string | null>(null);
  const [reportContent, setReportContent] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState<NightwatchConfig | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 구버전 preload 가 남아 있으면(핫리로드 범위 밖) API 가 없다 — 재시작 안내
      if (!window.oneApp.nightwatch?.setEnabled) {
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

  // 최초 로드 + 1분 자동 새로고침 (로컬 파일 읽기라 저렴)
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  const toggleEnabled = async () => {
    if (!status) return;
    const next = !status.config.enabled;
    setBusy("enable");
    const st = await window.oneApp.nightwatch.setEnabled(next);
    setStatus(st);
    setForm(st.config);
    toast(next ? "야간 감시를 켰습니다" : "야간 감시를 껐습니다");
    setBusy(null);
  };

  const runTest = async () => {
    setBusy("test");
    const res = await window.oneApp.nightwatch.test();
    setTestOutput(res.output);
    setBusy(null);
  };

  const runCycleNow = async () => {
    setBusy("cycle");
    const res = await window.oneApp.nightwatch.cycleNow();
    toast(res.output, res.ok ? undefined : "fail");
    setBusy(null);
    await load();
  };

  const runInitWorkspace = async () => {
    setBusy("workspace");
    toast("워크스페이스 준비 중... (npm install 포함, 수 분 소요)");
    const res = await window.oneApp.nightwatch.initWorkspace();
    toast(res.output, res.ok ? undefined : "fail");
    setBusy(null);
    await load();
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
    setReportKey(key);
    setReportContent("불러오는 중...");
    const res = await window.oneApp.nightwatch.getReport(key);
    setReportContent(
      res.ok && res.content
        ? res.content
        : res.error ?? "리포트를 불러오지 못했습니다"
    );
  };

  const patch = (p: Partial<NightwatchConfig>) =>
    setForm((f) => (f ? { ...f, ...p } : f));

  const watching = !!status?.config.enabled;
  const isTeamAccount = !!form?.claudeConfigDir.endsWith(".claude-team");

  return (
    <div className="section">
      <div className="nightwatch__head">
        <SectionHeader
          title="Nightwatch"
          icon={<Icon name="moon" size={18} />}
          sub="퇴근 후 무인 상태에서 Jira 버그 티켓을 자동 분석합니다. 앱이 실행 중인 동안 동작하고, 결과는 아침에 리포트로 확인하세요."
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
      {status && status.jiraConfigured && !status.workspaceReady && (
        <Banner variant="info">
          분석 전용 워크스페이스가 아직 없습니다. 준비에는 수 분이 걸립니다
          (worktree + npm install).{" "}
          <Button
            variant="ghost"
            size="sm"
            loading={busy === "workspace"}
            onClick={() => void runInitWorkspace()}
          >
            워크스페이스 준비
          </Button>
        </Banner>
      )}

      {status && (
        <div className="nightwatch__card">
          <div className="nightwatch__state">
            <Badge variant={watching ? "ok" : "idle"}>
              {watching ? "감시 중" : "꺼짐"}
            </Badge>
            {status.cycleRunning && (
              <Badge variant="busy">
                {status.currentTicket
                  ? `${status.currentTicket} 분석 중`
                  : "사이클 실행 중"}
              </Badge>
            )}
            <span className="nightwatch__meta">
              {status.config.windowStart}-{status.config.windowEnd}
              {status.config.weekendAllDay ? " +주말종일" : ""} ·{" "}
              {status.inWindow ? "지금 시간창 안" : "지금 시간창 밖"} · 오늘 밤{" "}
              {status.startedTonight}/{status.config.maxTicketsPerNight}건
              {status.lastCycleAt &&
                ` · 마지막 사이클 ${fmtCycleTime(status.lastCycleAt)}`}
            </span>
          </div>
          <div className="nightwatch__actions">
            <Button
              variant={watching ? "danger" : "primary"}
              size="sm"
              loading={busy === "enable"}
              onClick={() => void toggleEnabled()}
            >
              {watching ? "감시 끄기" : "감시 켜기"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              loading={busy === "cycle"}
              disabled={status.cycleRunning || !status.workspaceReady}
              onClick={() => void runCycleNow()}
              title="게이트(시간창·유휴·상한)를 무시하고 지금 티켓 1건을 처리합니다"
            >
              지금 1회 실행
            </Button>
            <Button
              variant="ghost"
              size="sm"
              loading={busy === "test"}
              onClick={() => void runTest()}
            >
              연결 점검
            </Button>
          </div>
        </div>
      )}

      {testOutput && (
        <div className="panel-sunken panel-sunken--log nightwatch__test">
          <pre>{testOutput}</pre>
        </div>
      )}

      {status &&
        (status.tickets.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state__icon">
              <Icon name="moon" size={20} />
            </span>
            <p>아직 처리한 티켓이 없습니다. 밤 사이 결과가 여기에 쌓입니다.</p>
          </div>
        ) : (
          <div className="nightwatch__list">
            {status.tickets.map((t) => {
              const badge = ticketBadge(t.status);
              return (
                <div className="nightwatch__row" key={t.key}>
                  <button
                    type="button"
                    className="nightwatch__key"
                    onClick={() =>
                      void window.oneApp.openExternal(
                        `${status.jiraBaseUrl}/browse/${t.key}`
                      )
                    }
                    title={`${t.key} — Jira에서 열기`}
                  >
                    {t.key}
                  </button>
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                  {t.classification && (
                    <Badge variant="pill">{t.classification}</Badge>
                  )}
                  {typeof t.confidence === "number" && (
                    <span className="nightwatch__conf">
                      확신도 {t.confidence}
                    </span>
                  )}
                  <span
                    className="nightwatch__summary"
                    title={t.summary ?? t.error ?? undefined}
                  >
                    {t.summary ?? t.error ?? "—"}
                  </span>
                  {t.report && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void openReport(t.key)}
                    >
                      리포트
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        ))}

      {form && (
        <Collapsible
          title="설정"
          icon={<Icon name="settings" size={14} />}
          storageKey="nightwatch:settings"
        >
          <FormRow label="분석 대상 저장소" column>
            <Input
              value={form.scopePath}
              onChange={(e) => patch({ scopePath: e.target.value })}
              placeholder="/Users/me/projects/..."
            />
          </FormRow>
          <FormRow label="JQL (티켓 선별 정책)" column>
            <Textarea
              code
              rows={3}
              value={form.jql}
              onChange={(e) => patch({ jql: e.target.value })}
            />
          </FormRow>
          <FormRow label="감시 시간창">
            <Input
              small
              value={form.windowStart}
              onChange={(e) => patch({ windowStart: e.target.value })}
              placeholder="21:00"
            />
            <span className="nightwatch__tilde">~</span>
            <Input
              small
              value={form.windowEnd}
              onChange={(e) => patch({ windowEnd: e.target.value })}
              placeholder="07:00"
            />
            <Segment
              options={[
                { value: "on", label: "주말 종일" },
                { value: "off", label: "주말 제외" },
              ]}
              value={form.weekendAllDay ? "on" : "off"}
              onChange={(v) => patch({ weekendAllDay: v === "on" })}
            />
          </FormRow>
          <FormRow label="자리 비움 판정(분)">
            <Input
              small
              type="number"
              value={String(form.idleMinutes)}
              onChange={(e) => patch({ idleMinutes: Number(e.target.value) })}
            />
          </FormRow>
          <FormRow label="밤당 최대 티켓">
            <Input
              small
              type="number"
              value={String(form.maxTicketsPerNight)}
              onChange={(e) =>
                patch({ maxTicketsPerNight: Number(e.target.value) })
              }
            />
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
          <FormRow label="야간 Claude 계정">
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
          title="cycle 로그"
          icon={<Icon name="clock" size={14} />}
          storageKey="nightwatch:log"
        >
          <pre className="nightwatch__log">{log}</pre>
        </Collapsible>
      )}

      {reportKey && (
        <Modal
          title={`${reportKey} 분석 리포트`}
          onClose={() => setReportKey(null)}
          wide
        >
          <pre className="nightwatch__report">{reportContent}</pre>
        </Modal>
      )}
    </div>
  );
}
