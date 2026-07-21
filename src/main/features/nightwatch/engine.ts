// Nightwatch 엔진 — Jira 후보 조회 → 티켓 데이터 준비 → 실제 저장소(현재 체크아웃)에서 헤드리스 미션 → 사후 검증 → 원장 기록.
// worktree 없이 사용자의 작업 트리를 그대로 읽는다 — 그래서 저장소에 대한 어떤 git 조작(원복 포함)도 하지 않고,
// 미션이 저장소를 건드린 흔적이 보이면 증거 patch 만 남기고 경고한다.
import type {
  JiraIssue,
  NightwatchCandidatesResult,
  NightwatchCommandResult,
  NightwatchConfig,
  NightwatchRepo,
  NightwatchStatus,
  NightwatchTextResult,
  NightwatchTicket,
} from "../../../shared/types";
import { fetchMyIssues } from "../jira/jira";
import { getJiraApiConfig } from "../settings/store";
import {
  appendMissionLog,
  buildObserveMission,
  detectClaudeBin,
  runMission,
} from "./mission";
import {
  appendCycleLog,
  ensureNwDirs,
  getNightwatchConfig,
  loadNwState,
  nwPaths,
  readCycleLogTail,
  saveNwState,
} from "./store";
import type { NwState } from "./store";
import { execFile } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const GIT = "/usr/bin/git";
const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
const TICKET_KEY_RE = /^[A-Z][A-Z0-9]*-\d+$/;
const ISSUE_FIELDS =
  "summary,description,priority,labels,created,comment,attachment";
const RETENTION_DAYS = 30; // 처리한 티켓 자동 정리 기한

// 실행 상태 — 앱 프로세스 내 단일 엔진이라 모듈 변수로 충분
let missionBusy = false;
let runningTicket: string | null = null;
let runningChild: ChildProcess | null = null;
let lastRunAt: string | undefined;

type RunResult = { code: number; stdout: string; stderr: string };

const run = (
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number } = {}
): Promise<RunResult> =>
  new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { cwd: opts.cwd, timeout: opts.timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({
          code: err ? 1 : 0,
          stdout: String(stdout).trim(),
          stderr: String(stderr).trim(),
        });
      }
    );
  });

const git = (cwd: string, args: string[], timeoutMs?: number) =>
  run(GIT, ["-C", cwd, ...args], { timeoutMs });

// ── Jira REST ───────────────────────────────────────────────────────────
async function jiraFetch(apiPath: string): Promise<Record<string, unknown>> {
  const cfg = getJiraApiConfig();
  if (!cfg)
    throw new Error("Jira 연동이 설정되지 않았습니다 (환경설정 → 연동)");
  const auth = Buffer.from(`${cfg.email}:${cfg.token}`).toString("base64");
  const response = await fetch(`${cfg.url}${apiPath}`, {
    headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
  });
  if (!response.ok)
    throw new Error(`Jira ${apiPath} -> HTTP ${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}

async function jiraDownload(url: string, dest: string): Promise<void> {
  const cfg = getJiraApiConfig();
  if (!cfg) throw new Error("Jira 연동이 설정되지 않았습니다");
  const auth = Buffer.from(`${cfg.email}:${cfg.token}`).toString("base64");
  const response = await fetch(url, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!response.ok)
    throw new Error(`첨부 다운로드 실패 -> HTTP ${response.status}`);
  fs.writeFileSync(dest, Buffer.from(await response.arrayBuffer()));
}

// Jira description/comment 는 ADF(JSON) 라 재귀 평탄화로 텍스트만 추출한다
type AdfNode =
  | string
  | AdfNode[]
  | {
      type?: string;
      text?: string;
      attrs?: { text?: string };
      content?: AdfNode;
    }
  | null
  | undefined;

function adfToText(node: AdfNode): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(adfToText).join("");
  let text = node.text ?? "";
  if (node.attrs?.text) text += node.attrs.text;
  if (node.content) text += adfToText(node.content);
  if (
    ["paragraph", "heading", "listItem", "codeBlock", "blockquote"].includes(
      node.type ?? ""
    )
  ) {
    text += "\n";
  }
  return text;
}

// ── 원장 정리 ───────────────────────────────────────────────────────────
/** 티켓 산출물 일괄 삭제 — 리포트·프롬프트·위반 patch·미션 로그·작업 데이터(첨부 포함) */
function removeTicketArtifacts(key: string) {
  const p = nwPaths();
  const targets = [
    path.join(p.reports, `${key}.md`),
    path.join(p.reports, `${key}.prompt.md`),
    path.join(p.reports, `${key}.partial.patch`),
    path.join(p.logs, `${key}.mission.log`),
    path.join(p.logs, `${key}.session.json`), // 초기 버전 산출물 호환
    path.join(p.work, key),
  ];
  for (const target of targets) {
    fs.rmSync(target, { recursive: true, force: true });
  }
}

/** 처리한 티켓 1건 삭제 — 원장 기록 + 산출물 파일 */
export function deleteTicket(key: string): NightwatchCommandResult {
  if (!TICKET_KEY_RE.test(key)) {
    return { ok: false, output: "잘못된 티켓 키입니다" };
  }
  if (runningTicket === key) {
    return { ok: false, output: "실행 중인 티켓은 삭제할 수 없습니다" };
  }
  const state = loadNwState();
  delete state.tickets[key];
  saveNwState(state);
  removeTicketArtifacts(key);
  return { ok: true, output: `${key} 분석 기록을 삭제했습니다` };
}

/** 기한 지난 항목 자동 정리 — 상태 조회 때마다 확인 (원장이 작아 부담 없음) */
function pruneOldTickets(state: NwState): boolean {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let changed = false;
  for (const [key, t] of Object.entries(state.tickets)) {
    if (key === runningTicket) continue;
    const when = new Date(t.finishedAt ?? t.startedAt ?? "").getTime();
    if (Number.isFinite(when) && when < cutoff) {
      delete state.tickets[key];
      removeTicketArtifacts(key);
      appendCycleLog(`정리: ${key} (${RETENTION_DAYS}일 경과 자동 삭제)`);
      changed = true;
    }
  }
  return changed;
}

// ── 상태 조립 ───────────────────────────────────────────────────────────
export function getNightwatchStatus(): NightwatchStatus {
  const p = nwPaths();
  const state = loadNwState();
  if (pruneOldTickets(state)) saveNwState(state);
  const tickets: NightwatchTicket[] = Object.entries(state.tickets)
    .map(([key, t]) => ({
      key,
      ...t,
      report: fs.existsSync(path.join(p.reports, `${key}.md`)),
      prompt: fs.existsSync(path.join(p.reports, `${key}.prompt.md`)),
    }))
    .sort((a, b) =>
      String(b.startedAt ?? "").localeCompare(String(a.startedAt ?? ""))
    );
  return {
    jiraConfigured: !!getJiraApiConfig(),
    claudeFound: !!detectClaudeBin(),
    running: missionBusy,
    currentTicket: runningTicket ?? undefined,
    lastRunAt,
    jiraBaseUrl: getJiraApiConfig()?.url,
    config: getNightwatchConfig(),
    tickets,
  };
}

// 해결 판별 — renderer jira 의 isDone 과 동일 기준. 이 팀 워크플로우는 '해결됨'이
// 카테고리상 done 이 아니라(진행 중) 이름 휴리스틱을 병행해야 후보에서 빠진다.
const isIssueDone = (issue: JiraIssue) =>
  issue.statusCategory === "done" ||
  /해결|완료|resolved|done|closed/i.test(issue.status);

// "[FO][이벤트]" 같은 제목 말머리의 첫 태그 — 저장소 기본 선택 학습 키에 쓴다
const summaryPrefix = (summary: string) =>
  /^\[([A-Za-z가-힣]+)\]/.exec(summary.trim())?.[1]?.toUpperCase() ?? "-";

const repoDefaultKey = (ticketKey: string, summary: string) =>
  `${ticketKey.split("-")[0]}:${summaryPrefix(summary)}`;

/** 분석 후보 목록 — Jira 섹션과 같은 '내 미해결 이슈' 조회를 재사용해 미해결 버그만 남긴다 */
export async function listCandidates(): Promise<NightwatchCandidatesResult> {
  const list = await fetchMyIssues();
  if (!list.ok || !list.issues) {
    return { ok: false, error: list.error ?? "이슈 조회에 실패했습니다" };
  }
  const state = loadNwState();
  return {
    ok: true,
    candidates: list.issues
      .filter(
        (issue) => /bug|버그/i.test(issue.issueType) && !isIssueDone(issue)
      )
      .map((issue) => ({
        key: issue.key,
        summary: issue.summary,
        status: issue.status,
        priority: issue.priority,
        processedStatus: state.tickets[issue.key]?.status ?? null,
        suggestedRepoId:
          state.repoDefaults[repoDefaultKey(issue.key, issue.summary)] ?? null,
      })),
  };
}

// ── 분석 실행 ───────────────────────────────────────────────────────────
/** 티켓 1건 분석 — UI [분석]에서 저장소를 골라 호출. 동시 실행은 1건으로 제한 */
export async function analyzeTicket(
  key: string,
  repoId: string
): Promise<NightwatchCommandResult> {
  if (!TICKET_KEY_RE.test(key)) {
    return { ok: false, output: "잘못된 티켓 키입니다" };
  }
  if (missionBusy) {
    return { ok: false, output: `이미 분석이 실행 중입니다 (${runningTicket})` };
  }
  missionBusy = true;
  try {
    ensureNwDirs();
    const cfg = getNightwatchConfig();
    if (!getJiraApiConfig()) {
      return {
        ok: false,
        output: "Jira 연동이 설정되지 않았습니다 (환경설정 → 연동)",
      };
    }
    const repo = cfg.repos.find((r) => r.id === repoId);
    if (!repo) {
      return { ok: false, output: "저장소를 선택해 주세요" };
    }
    if (!fs.existsSync(path.join(repo.path, ".git"))) {
      return { ok: false, output: `저장소가 없습니다: ${repo.path}` };
    }
    const issue = (await jiraFetch(
      `/rest/api/3/issue/${key}?fields=${ISSUE_FIELDS}`
    )) as unknown as JiraIssueRaw;
    // 같은 프로젝트·말머리의 다음 분석 때 이 저장소가 기본 선택되도록 기억
    const state = loadNwState();
    state.repoDefaults[repoDefaultKey(key, issue.fields.summary)] = repo.id;
    return await processTicket(cfg, state, issue, repo);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    appendCycleLog(`분석 오류: ${message}`);
    return { ok: false, output: message };
  } finally {
    missionBusy = false;
    lastRunAt = new Date().toISOString();
  }
}

/** 실행 중 미션 중지 — SIGTERM. 결과는 미션 종료 시 원장에 기록된다 */
export function stopMission(): NightwatchCommandResult {
  if (!runningChild) {
    return { ok: false, output: "실행 중인 분석이 없습니다" };
  }
  appendCycleLog(`사용자 중지 — 실행 중 미션(${runningTicket}) SIGTERM`);
  try {
    runningChild.kill("SIGTERM");
  } catch {
    // 이미 종료된 프로세스면 무시
  }
  return { ok: true, output: "중지 신호를 보냈습니다" };
}

type JiraIssueRaw = {
  key: string;
  fields: {
    summary: string;
    created?: string;
    priority?: { name?: string };
    labels?: string[];
    description?: AdfNode;
    comment?: {
      comments?: {
        author?: { displayName?: string };
        created?: string;
        body?: AdfNode;
      }[];
    };
    attachment?: { filename: string; size: number; content: string }[];
  };
};

async function processTicket(
  cfg: NightwatchConfig,
  state: NwState,
  issue: JiraIssueRaw,
  repo: NightwatchRepo
): Promise<NightwatchCommandResult> {
  const p = nwPaths();
  const key = issue.key;
  const ticketDir = path.join(p.work, key);
  const attachmentsDir = path.join(ticketDir, "attachments");
  fs.mkdirSync(attachmentsDir, { recursive: true });
  const startedAt = new Date().toISOString();
  state.tickets[key] = {
    status: "in_progress",
    startedAt,
    repo: repo.name,
    title: issue.fields.summary,
  };
  saveNwState(state);
  appendCycleLog(`ticket ${key}: 시작 (${repo.name} — ${issue.fields.summary})`);
  // 미션 전 단계도 UI 라이브 패널에 보이도록 미션 로그를 여기서 초기화한다
  const missionLogPath = path.join(p.logs, `${key}.mission.log`);
  fs.writeFileSync(missionLogPath, "");
  appendMissionLog(missionLogPath, "티켓 데이터·첨부 수집 중...");

  try {
    const ticket = {
      key,
      summary: issue.fields.summary,
      priority: issue.fields.priority?.name ?? null,
      labels: issue.fields.labels ?? [],
      created: issue.fields.created,
      description: adfToText(issue.fields.description).trim(),
      comments: (issue.fields.comment?.comments ?? []).map((c) => ({
        author: c.author?.displayName,
        created: c.created,
        body: adfToText(c.body).trim(),
      })),
      attachments: [] as string[],
    };
    for (const att of issue.fields.attachment ?? []) {
      if (att.size > ATTACHMENT_MAX_BYTES) continue;
      const dest = path.join(
        attachmentsDir,
        att.filename.replace(/[/\\]/g, "_")
      );
      await jiraDownload(att.content, dest);
      ticket.attachments.push(dest);
    }
    const ticketJsonPath = path.join(ticketDir, "ticket.json");
    fs.writeFileSync(ticketJsonPath, `${JSON.stringify(ticket, null, 2)}\n`);

    // 분석 컨텍스트 기록 + 미션 전 스냅샷 (읽기 전용 검증 기준점)
    const branch = await git(repo.path, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const before = await snapshotRepo(repo.path);
    appendMissionLog(
      missionLogPath,
      `저장소: ${repo.name} (${branch.stdout || "?"}${
        before.status ? ", 작업 중 변경분 있음" : ""
      }) — 현재 체크아웃 그대로 분석`
    );

    const mission = buildObserveMission({
      key,
      ticketJson: ticketJsonPath,
      attachmentsDir,
      reportPath: path.join(p.reports, `${key}.md`),
      promptPath: path.join(p.reports, `${key}.prompt.md`),
      resultJsonPath: path.join(ticketDir, "result.json"),
      repoName: repo.name,
    });
    runningTicket = key;
    const missionRun = runMission({
      mission,
      repoPath: repo.path,
      claudeConfigDir: cfg.claudeConfigDir,
      timeoutMinutes: cfg.timeoutMinutes,
      missionLogPath,
    });
    runningChild = missionRun.child;
    const outcome = await missionRun.done;
    runningChild = null;
    runningTicket = null;

    const violation = await detectRepoTampering(key, repo.path, before);
    let result: { summary?: string } | null = null;
    try {
      result = JSON.parse(
        fs.readFileSync(path.join(ticketDir, "result.json"), "utf8")
      ) as typeof result;
    } catch {
      result = null;
    }
    const finishedAt = new Date().toISOString();
    const durationMin = Math.round(
      (new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 60000
    );
    const entry = state.tickets[key];
    Object.assign(entry, {
      finishedAt,
      durationMin,
      summary: result?.summary ?? null,
      error: outcome.ok ? null : outcome.error,
      status: violation
        ? "violation_edited"
        : outcome.ok && result
        ? "analyzed"
        : "failed",
    });
    saveNwState(state);
    appendCycleLog(`ticket ${key}: ${entry.status} (${durationMin}분)`);
    return { ok: true, output: `${key}: ${entry.status} (${durationMin}분)` };
  } catch (e) {
    runningChild = null;
    runningTicket = null;
    const message = e instanceof Error ? e.message : String(e);
    state.tickets[key].status = "failed";
    state.tickets[key].error = message;
    state.tickets[key].finishedAt = new Date().toISOString();
    saveNwState(state);
    appendCycleLog(`ticket ${key}: failed (${message})`);
    return { ok: false, output: `${key} 실패: ${message}` };
  }
}

// ── 읽기 전용 검증 (실제 저장소라 절대 원복하지 않는다) ─────────────────
type RepoSnapshot = { status: string; diff: string };

async function snapshotRepo(repoPath: string): Promise<RepoSnapshot> {
  const status = await git(repoPath, ["status", "--porcelain"]);
  const diff = await git(repoPath, ["diff"]);
  return { status: status.stdout, diff: diff.stdout };
}

/**
 * 미션 전후 스냅샷 비교로 저장소를 건드렸는지 검사.
 * 사용자의 작업본과 섞일 수 있어 자동 원복은 하지 않고, 증거 patch 를 남기고 경고만 한다.
 */
async function detectRepoTampering(
  key: string,
  repoPath: string,
  before: RepoSnapshot
): Promise<boolean> {
  const after = await snapshotRepo(repoPath);
  if (after.status === before.status && after.diff === before.diff)
    return false;
  fs.writeFileSync(
    path.join(nwPaths().reports, `${key}.partial.patch`),
    `# 미션 전 status:\n${before.status}\n\n# 미션 후 status:\n${after.status}\n\n# 미션 후 diff:\n${after.diff}\n`
  );
  appendCycleLog(
    `[경고] ${key}: 미션이 저장소(${repoPath})를 수정한 흔적 — git status 로 확인하세요 (자동 원복 안 함)`
  );
  return true;
}

// ── 리포트·프롬프트·로그 조회 ───────────────────────────────────────────
export function readNightwatchReport(key: string): NightwatchTextResult {
  if (!TICKET_KEY_RE.test(key)) {
    return { ok: false, error: "잘못된 티켓 키입니다." };
  }
  try {
    const content = fs.readFileSync(
      path.join(nwPaths().reports, `${key}.md`),
      "utf8"
    );
    return { ok: true, content };
  } catch {
    return { ok: false, error: "리포트 파일이 없습니다." };
  }
}

/** 작업 프롬프트(md) — 아침에 Claude Code 세션에 붙여넣을 작업 지시문 (fixable 일 때 생성) */
export function readNightwatchPrompt(key: string): NightwatchTextResult {
  if (!TICKET_KEY_RE.test(key)) {
    return { ok: false, error: "잘못된 티켓 키입니다." };
  }
  try {
    const content = fs.readFileSync(
      path.join(nwPaths().reports, `${key}.prompt.md`),
      "utf8"
    );
    return { ok: true, content };
  } catch {
    return { ok: false, error: "작업 프롬프트 파일이 없습니다." };
  }
}

/** 미션 진행 로그 tail — 실행 중 UI 라이브 표시 + 사후 확인 공용 */
export function readMissionLog(key: string): NightwatchTextResult {
  if (!TICKET_KEY_RE.test(key)) {
    return { ok: false, error: "잘못된 티켓 키입니다." };
  }
  try {
    const raw = fs
      .readFileSync(path.join(nwPaths().logs, `${key}.mission.log`), "utf8")
      .trimEnd();
    return { ok: true, content: raw.split("\n").slice(-200).join("\n") };
  } catch {
    return { ok: false, error: "미션 로그가 없습니다." };
  }
}

export function readNightwatchLog(): NightwatchTextResult {
  const content = readCycleLogTail();
  return content
    ? { ok: true, content }
    : { ok: false, error: "로그가 아직 없습니다." };
}
