// Nightwatch 엔진 — Jira 후보 조회 → 티켓 데이터 준비 → 실제 저장소(현재 체크아웃)에서 헤드리스 미션 → 사후 검증 → 원장 기록.
// 진입점 둘: UI 의 [분석] 수동 호출과 자동 순회 스케줄러(scheduler.ts). 실행 중 추가된 요청은 대기열로 순차 처리한다.
// worktree 없이 사용자의 작업 트리를 그대로 읽는다 — 그래서 저장소에 대한 어떤 git 조작(원복 포함)도 하지 않고,
// 미션이 저장소를 건드린 흔적이 보이면 증거 patch 만 남기고 경고한다.
import type {
  JiraIssue,
  NightwatchAnalyzeOpts,
  NightwatchCandidatesResult,
  NightwatchCommandResult,
  NightwatchConfig,
  NightwatchStatus,
  NightwatchTextResult,
  NightwatchTicket,
  Project,
} from "../../../shared/types";
import { fetchMyIssues, jiraAuth } from "../jira/jira";
// 전역 fetch 를 타임아웃 래퍼로 대체 — 소켓 hang 시 무한 대기 방지
import { fetchWithTimeout as fetch } from "../../lib/http";
import { getProject } from "../projects/store";
import { getJiraApiConfig } from "../settings/store";
import {
  appendMissionLog,
  buildObserveMission,
  ensureClaudeBin,
  runMission,
} from "./mission";
import {
  appendCycleLog,
  ensureNwDirs,
  getNightwatchConfig,
  loadAutoState,
  loadNwState,
  nwPaths,
  readCycleLogTail,
  saveNwState,
  updateNwState,
} from "./store";
import type { NwState } from "./store";
import { execFile } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const GIT = "/usr/bin/git";
const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
// 첨부는 최대 20MB 라 기본 15초로는 사내망에서도 모자랄 수 있다
const ATTACHMENT_TIMEOUT_MS = 60_000;

/** 분석 대상 — 프로젝트 레지스트리의 Project 를 엔진 내부 형태로 축약 (path = localPath) */
type AnalysisRepo = { id: string; name: string; path: string };
const toAnalysisRepo = (p: Project): AnalysisRepo => ({
  id: p.id,
  name: p.name,
  path: p.localPath,
});
const TICKET_KEY_RE = /^[A-Z][A-Z0-9]*-\d+$/;
const ISSUE_FIELDS =
  "summary,description,priority,labels,created,comment,attachment";
const RETENTION_DAYS = 30; // 처리한 티켓 자동 정리 기한

// 실행 상태 — 앱 프로세스 내 단일 엔진이라 모듈 변수로 충분
let missionBusy = false;
let runningTicket: string | null = null;
let runningChild: ChildProcess | null = null;
let lastRunAt: string | undefined;
// 실행 중 추가된 분석 요청 — 현재 미션이 끝나는 대로 순서대로 실행
let queue: { key: string; repoId: string; opts: NightwatchAnalyzeOpts }[] = [];

// 모델 인자 검증 — spawn 인자로만 쓰여 셸 위험은 없지만 오타·이상값을 미리 거른다
const MODEL_RE = /^[A-Za-z0-9._-]{1,64}$/;
const NOTE_MAX_LEN = 4000; // 부가설명 상한 — 미션 프롬프트가 무한정 커지지 않게

/** 렌더러에서 온 분석 옵션 정리 — 빈 값은 null 로 통일 */
function sanitizeAnalyzeOpts(opts?: NightwatchAnalyzeOpts): NightwatchAnalyzeOpts {
  const model =
    opts?.model && MODEL_RE.test(opts.model) ? opts.model : null;
  const note = opts?.note?.trim() ? opts.note.trim().slice(0, NOTE_MAX_LEN) : null;
  return { model, note };
}

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
// 인증 헤더는 조립하지 않고 jira/jira.ts 의 jiraAuth() 를 공유한다.
// ⚠️ 호출은 전역 fetch 가 아니라 fetchWithTimeout — 소켓 hang 시 IPC 가 영영 안 풀린다.
const requireJiraAuth = () => {
  const auth = jiraAuth();
  if (!auth)
    throw new Error("Jira 연동이 설정되지 않았습니다 (환경설정 → 연동)");
  return auth;
};

async function jiraFetch(apiPath: string): Promise<Record<string, unknown>> {
  const { url, headers } = requireJiraAuth();
  const response = await fetch(`${url}${apiPath}`, { headers });
  if (!response.ok)
    throw new Error(`Jira ${apiPath} -> HTTP ${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}

async function jiraDownload(url: string, dest: string): Promise<void> {
  const { authorization } = requireJiraAuth();
  // 첨부는 이미지·문서라 본문 조회보다 오래 걸릴 수 있어 타임아웃을 넉넉히 준다
  const response = await fetch(
    url,
    { headers: { Authorization: authorization } },
    ATTACHMENT_TIMEOUT_MS,
  );
  if (!response.ok)
    throw new Error(`첨부 다운로드 실패 -> HTTP ${response.status}`);
  fs.writeFileSync(dest, Buffer.from(await response.arrayBuffer()));
}

/** 미션이 남기는 result.json — 요약만 읽는다 */
type MissionResultFile = { summary?: string };

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
  appendCycleLog(`삭제: ${key} (수동)`);
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
// claude 탐지가 비동기라 async 다 — 동기로 돌리면 로그인 셸 rc 로딩 동안 메인
// 프로세스(= 모든 IPC·터미널 입출력)가 멈춘다(mission.ts 의 ensureClaudeBin 주석 참고).
export async function getNightwatchStatus(): Promise<NightwatchStatus> {
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
  const config = getNightwatchConfig();
  return {
    jiraConfigured: !!getJiraApiConfig(),
    claudeFound: !!(await ensureClaudeBin()),
    running: missionBusy,
    currentTicket: runningTicket ?? undefined,
    queue: queue.map((q) => q.key),
    lastRunAt,
    jiraBaseUrl: getJiraApiConfig()?.url,
    config,
    auto: loadAutoState(),
    // 타이머 부착 여부는 설정 enabled 와 1:1 이다 (scheduler.refreshNightwatchSchedule).
    // scheduler 를 import 하지 않는 이유: scheduler → engine 방향 의존만 두고 순환을 만들지 않는다.
    autoRunning: config.auto.enabled,
    tickets,
  };
}

/** 지금 분석이 돌고 있거나 대기열이 남았는지 — 자동 순회가 한 건씩만 태우도록 쓰는 게이트 */
export function isAnalysisActive(): boolean {
  return missionBusy || queue.length > 0;
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

/**
 * 분석 후보 목록 — '내 미해결 이슈' + Jira 섹션에서 직접 추가한 티켓에서 숨김·기분석만 뺀다.
 *
 * ⚠️ **직접 추가한 티켓(pinned)은 해결 상태여도 남긴다** — 내 담당이 아닐 수 있고, 사용자가
 * "이걸 보겠다"고 명시적으로 넣은 티켓이다. 해결됨으로 목록에서 사라지면 분석할 경로가
 * 아예 없어진다(Jira 섹션은 '해결됨' 그룹에 접어 두지만 여기엔 그 그룹이 없다).
 * 대신 `resolved` 를 실어 보내 자동 순회가 이미 끝난 티켓에 비용을 쓰지 않게 한다.
 */
export async function listCandidates(): Promise<NightwatchCandidatesResult> {
  const list = await fetchMyIssues();
  if (!list.ok || !list.issues) {
    return { ok: false, error: list.error ?? "이슈 조회에 실패했습니다" };
  }
  const state = loadNwState();
  const open = list.issues.filter(
    (issue) => issue.pinned || !isIssueDone(issue)
  );
  // 숨김 목록 위생 — 해결·할당 해제로 내 목록에서 사라진 키는 더 기억할 필요 없다
  const openKeys = new Set(open.map((issue) => issue.key));
  const hidden = state.hiddenTickets.filter((key) => openKeys.has(key));
  if (hidden.length !== state.hiddenTickets.length) {
    state.hiddenTickets = hidden;
    saveNwState(state);
  }
  return {
    ok: true,
    hiddenCount: hidden.length,
    candidates: open
      .filter((issue) => !hidden.includes(issue.key))
      // 이미 분석한 티켓은 '처리한 티켓' 섹션에서 [재분석]으로 다루므로 후보에서 제외 (중복 표시 방지)
      .filter((issue) => !state.tickets[issue.key])
      .map((issue) => ({
        key: issue.key,
        summary: issue.summary,
        issueType: issue.issueType,
        status: issue.status,
        priority: issue.priority,
        pinned: issue.pinned,
        resolved: isIssueDone(issue) || undefined,
        // 위 필터로 처리한 티켓은 이미 빠졌으므로 항상 null (필드는 타입 호환 위해 유지)
        processedStatus: state.tickets[issue.key]?.status ?? null,
        suggestedRepoId:
          state.repoDefaults[repoDefaultKey(issue.key, issue.summary)] ?? null,
      })),
  };
}

/** 후보 숨김 — 분석이 필요 없는 티켓을 목록에서 제외 (해결되면 자동 정리) */
export function hideCandidate(key: string): NightwatchCommandResult {
  if (!TICKET_KEY_RE.test(key)) {
    return { ok: false, output: "잘못된 티켓 키입니다" };
  }
  const state = loadNwState();
  if (!state.hiddenTickets.includes(key)) {
    state.hiddenTickets.push(key);
    saveNwState(state);
  }
  return { ok: true, output: `${key} 를 후보에서 숨겼습니다` };
}

/** 숨김 전체 해제 */
export function clearHiddenCandidates(): NightwatchCommandResult {
  const state = loadNwState();
  const count = state.hiddenTickets.length;
  state.hiddenTickets = [];
  saveNwState(state);
  return { ok: true, output: `숨김 ${count}건을 해제했습니다` };
}

// ── 분석 실행 ───────────────────────────────────────────────────────────
/** 티켓 1건 분석 — UI [분석]에서 저장소·모델·부가설명을 골라 호출. 실행 중이면 대기열에 쌓여 순차 실행 */
export async function analyzeTicket(
  key: string,
  repoId: string,
  rawOpts?: NightwatchAnalyzeOpts
): Promise<NightwatchCommandResult> {
  const opts = sanitizeAnalyzeOpts(rawOpts);
  if (!TICKET_KEY_RE.test(key)) {
    return { ok: false, output: "잘못된 티켓 키입니다" };
  }
  if (!getJiraApiConfig()) {
    return {
      ok: false,
      output: "Jira 연동이 설정되지 않았습니다 (환경설정 → 연동)",
    };
  }
  const project = getProject(repoId);
  if (!project) {
    return {
      ok: false,
      output: "프로젝트를 찾을 수 없습니다 — 프로젝트 탭에서 등록해 주세요",
    };
  }
  const repo = toAnalysisRepo(project);
  // 레지스트리는 경로의 git 여부를 검증하지 않으므로 실행 직전에 확인한다
  if (!fs.existsSync(path.join(repo.path, ".git"))) {
    return { ok: false, output: `저장소가 없습니다: ${repo.path}` };
  }
  if (runningTicket === key || queue.some((q) => q.key === key)) {
    return { ok: false, output: `${key} 는 이미 실행·대기 중입니다` };
  }
  if (missionBusy) {
    queue.push({ key, repoId, opts });
    appendCycleLog(`대기열 추가: ${key} (${repo.name}, ${queue.length}건 대기)`);
    return {
      ok: true,
      output: `${key} 를 대기열에 추가했습니다 (${queue.length}건 대기)`,
    };
  }
  return runAnalysis(key, repo, opts);
}

async function runAnalysis(
  key: string,
  repo: AnalysisRepo,
  opts: NightwatchAnalyzeOpts
): Promise<NightwatchCommandResult> {
  missionBusy = true;
  try {
    ensureNwDirs();
    const issue = (await jiraFetch(
      `/rest/api/3/issue/${key}?fields=${ISSUE_FIELDS}`
    )) as unknown as JiraIssueRaw;
    // 같은 프로젝트·말머리의 다음 분석 때 이 저장소가 기본 선택되도록 기억
    updateNwState((s) => {
      s.repoDefaults[repoDefaultKey(key, issue.fields.summary)] = repo.id;
    });
    return await processTicket(getNightwatchConfig(), issue, repo, opts);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    appendCycleLog(`분석 오류: ${message}`);
    return { ok: false, output: message };
  } finally {
    missionBusy = false;
    lastRunAt = new Date().toISOString();
    drainQueue();
  }
}

// 대기열 순차 실행 — 한 건이 실패해도 다음 항목으로 넘어간다
function drainQueue() {
  const next = queue.shift();
  if (!next) return;
  // 대기 중 프로젝트가 삭제됐을 수 있으므로 재조회 — 없으면 안전하게 건너뜀
  const project = getProject(next.repoId);
  const repo = project && toAnalysisRepo(project);
  if (!repo || !fs.existsSync(path.join(repo.path, ".git"))) {
    appendCycleLog(`대기열 건너뜀: ${next.key} (프로젝트·저장소 없음)`);
    drainQueue();
    return;
  }
  appendCycleLog(`대기열 실행: ${next.key} (${repo.name})`);
  void runAnalysis(next.key, repo, next.opts);
}

/** 실행 중 미션 중지 — SIGTERM + 대기열 비움. 결과는 미션 종료 시 원장에 기록된다 */
export function stopMission(): NightwatchCommandResult {
  if (!runningChild) {
    return { ok: false, output: "실행 중인 분석이 없습니다" };
  }
  const dropped = queue.length;
  queue = [];
  appendCycleLog(
    `사용자 중지 — 실행 중 미션(${runningTicket}) SIGTERM${
      dropped ? `, 대기열 ${dropped}건 취소` : ""
    }`
  );
  try {
    runningChild.kill("SIGTERM");
  } catch {
    // 이미 종료된 프로세스면 무시
  }
  return {
    ok: true,
    output: `중지 신호를 보냈습니다${dropped ? ` (대기열 ${dropped}건 취소)` : ""}`,
  };
}

/** 앱 시작 시 좀비 정리 — 이전 세션에서 in_progress 로 남은 항목은 중단된 것 */
export function sweepInterruptedTickets() {
  const state = loadNwState();
  let changed = false;
  for (const [key, t] of Object.entries(state.tickets)) {
    if (t.status !== "in_progress") continue;
    t.status = "failed";
    t.error = "앱 종료로 분석이 중단되었습니다";
    t.finishedAt = t.finishedAt ?? new Date().toISOString();
    appendCycleLog(`좀비 정리: ${key} (앱 종료로 중단)`);
    changed = true;
  }
  if (changed) saveNwState(state);
}

/** 앱 종료 시 정리 — 실행 중 claude 프로세스가 고아로 남지 않도록 SIGTERM */
export function cleanupOnQuit() {
  queue = [];
  if (runningChild) {
    appendCycleLog(`앱 종료 — 실행 중 미션(${runningTicket}) SIGTERM`);
    try {
      runningChild.kill("SIGTERM");
    } catch {
      // 이미 종료된 프로세스면 무시
    }
  }
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
  issue: JiraIssueRaw,
  repo: AnalysisRepo,
  opts: NightwatchAnalyzeOpts
): Promise<NightwatchCommandResult> {
  const p = nwPaths();
  const key = issue.key;
  const ticketDir = path.join(p.work, key);
  const attachmentsDir = path.join(ticketDir, "attachments");
  fs.mkdirSync(attachmentsDir, { recursive: true });
  const startedAt = new Date().toISOString();
  // ⚠️ state 스냅샷을 미션(수십 분) 내내 들고 있으면 안 된다 — 종료 시 통째 저장이
  // 그 사이의 숨김·삭제·자동 정리를 되덮는다(lost update). 원장 쓰기는 매번
  // updateNwState 로 "방금 읽은 원장"에 이 티켓만 병합한다.
  updateNwState((s) => {
    s.tickets[key] = {
      status: "in_progress",
      startedAt,
      repo: repo.name,
      title: issue.fields.summary,
      model: opts.model ?? null,
    };
  });
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
    if (opts.model) appendMissionLog(missionLogPath, `모델 지정: ${opts.model}`);
    if (opts.note)
      appendMissionLog(missionLogPath, `부가설명 첨부 (${opts.note.length}자)`);

    const mission = buildObserveMission({
      key,
      ticketJson: ticketJsonPath,
      attachmentsDir,
      reportPath: path.join(p.reports, `${key}.md`),
      promptPath: path.join(p.reports, `${key}.prompt.md`),
      resultJsonPath: path.join(ticketDir, "result.json"),
      repoName: repo.name,
      note: opts.note,
    });
    runningTicket = key;
    // 탐지가 아직이면 여기서 기다린다 — runMission 은 캐시된 경로만 읽는다
    await ensureClaudeBin();
    const missionRun = runMission({
      mission,
      repoPath: repo.path,
      claudeConfigDir: cfg.claudeConfigDir,
      timeoutMinutes: cfg.timeoutMinutes,
      missionLogPath,
      model: opts.model,
    });
    runningChild = missionRun.child;
    const outcome = await missionRun.done;
    runningChild = null;
    runningTicket = null;

    const violation = await detectRepoTampering(key, repo.path, before);
    // ⚠️ `as typeof result` 로 쓰지 말 것 — 좁혀진 타입(null)이 잡혀 result 가 never 가 된다
    let result: MissionResultFile | null = null;
    try {
      result = JSON.parse(
        fs.readFileSync(path.join(ticketDir, "result.json"), "utf8")
      ) as MissionResultFile;
    } catch {
      result = null;
    }
    const finishedAt = new Date().toISOString();
    const durationMin = Math.round(
      (new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 60000
    );
    const status = violation
      ? ("violation_edited" as const)
      : outcome.ok && result
      ? ("analyzed" as const)
      : ("failed" as const);
    // 미션 중 사용자가 이 행을 지웠으면(원장에 키 없음) 되살리지 않는다 — 삭제 존중.
    // 이때 미션이 삭제 뒤 다시 써 둔 산출물(리포트·로그·work)도 함께 지운다 —
    // 원장에 없는 파일은 UI 에도 안 보이고 30일 정리도 원장만 돌아 영구히 남는다.
    const recorded = updateNwState((s) => {
      const entry = s.tickets[key];
      if (!entry) return false;
      Object.assign(entry, {
        finishedAt,
        durationMin,
        costUsd: outcome.costUsd,
        summary: result?.summary ?? null,
        error: outcome.ok ? null : outcome.error,
        status,
      });
      return true;
    });
    if (!recorded) removeTicketArtifacts(key);
    appendCycleLog(
      `ticket ${key}: ${status} (${durationMin}분${
        outcome.costUsd != null ? `, $${outcome.costUsd.toFixed(2)}` : ""
      })${recorded ? "" : " — 미션 중 삭제된 티켓이라 원장 기록·산출물 생략"}`
    );
    return {
      ok: true,
      output: `${key}: ${status} (${durationMin}분)${
        recorded ? "" : " — 미션 중 삭제되어 원장에는 기록하지 않음"
      }`,
    };
  } catch (e) {
    runningChild = null;
    runningTicket = null;
    const message = e instanceof Error ? e.message : String(e);
    const recorded = updateNwState((s) => {
      const entry = s.tickets[key];
      if (!entry) return false; // 미션 중 삭제된 행은 되살리지 않는다
      entry.status = "failed";
      entry.error = message;
      entry.finishedAt = new Date().toISOString();
      return true;
    });
    // 삭제 존중 — 그 사이 다시 생긴 산출물(미션 로그 등)도 함께 정리 (위 성공 경로와 동일)
    if (!recorded) removeTicketArtifacts(key);
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
