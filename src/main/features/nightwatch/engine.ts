// Nightwatch 엔진 — 게이트 → Jira 폴링 → 워크스페이스 위생 → 헤드리스 미션 → 사후 검증 → 원장 기록.
// launchd 없이 one-app 이 트레이 상주하는 동안 스케줄러(scheduler.ts)가 이 엔진을 주기 호출한다.
import type {
  NightwatchCommandResult,
  NightwatchConfig,
  NightwatchStatus,
  NightwatchTextResult,
  NightwatchTicket,
} from "../../../shared/types";
import { getJiraApiConfig } from "../settings/store";
import { buildObserveMission, detectClaudeBin, runMission } from "./mission";
import {
  appendCycleLog,
  ensureNwDirs,
  getNightwatchConfig,
  loadNwState,
  nwPaths,
  readCycleLogTail,
  saveNightwatchConfig,
  saveNwState,
} from "./store";
import { execFile } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const GIT = "/usr/bin/git";
const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 60_000;
const NPM_INSTALL_TIMEOUT_MS = 15 * 60_000;

// 실행 상태 — 앱 프로세스 내 단일 엔진이라 모듈 변수로 충분
let cycleBusy = false;
let runningTicket: string | null = null;
let runningChild: ChildProcess | null = null;
let lastCycleAt: string | undefined;
let lastGateReason = ""; // 같은 게이트 사유가 tick 마다 로그를 채우지 않도록 변화 시만 기록

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

// volta 등 사용자 셸 전용 PATH 가 필요한 명령은 zsh 로그인 셸을 경유한다
const zsh = (script: string, opts: { cwd?: string; timeoutMs?: number } = {}) =>
  run("/bin/zsh", ["-lc", script], opts);

// ── 게이트 헬퍼 ─────────────────────────────────────────────────────────
const toMinutes = (time: string) => {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
};

function inWindow(cfg: NightwatchConfig, now: Date): boolean {
  const day = now.getDay();
  if (cfg.weekendAllDay && (day === 0 || day === 6)) return true;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const start = toMinutes(cfg.windowStart);
  const end = toMinutes(cfg.windowEnd);
  return start > end
    ? minutes >= start || minutes < end
    : minutes >= start && minutes < end;
}

// 밤당 상한 계산 기준점 — 주말 종일 창은 자정, 야간 창은 직전 windowStart 시각
function windowOpenedAt(cfg: NightwatchConfig, now: Date): Date {
  const day = now.getDay();
  if (cfg.weekendAllDay && (day === 0 || day === 6)) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  const [h, m] = cfg.windowStart.split(":").map(Number);
  const opened = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    h,
    m
  );
  if (opened > now) opened.setDate(opened.getDate() - 1);
  return opened;
}

async function idleSeconds(): Promise<number> {
  const result = await run("/bin/sh", [
    "-c",
    "/usr/sbin/ioreg -c IOHIDSystem | /usr/bin/awk '/HIDIdleTime/ {print int($NF/1000000000); exit}'",
  ]);
  return result.code === 0 ? Number(result.stdout) || 0 : 0;
}

function startedTonight(cfg: NightwatchConfig, now: Date): number {
  const opened = windowOpenedAt(cfg, now);
  return Object.values(loadNwState().tickets).filter(
    (t) => t.startedAt && new Date(t.startedAt) >= opened
  ).length;
}

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

// ── 상태 조립 ───────────────────────────────────────────────────────────
export function getNightwatchStatus(): NightwatchStatus {
  const cfg = getNightwatchConfig();
  const p = nwPaths();
  const state = loadNwState();
  const now = new Date();
  const tickets: NightwatchTicket[] = Object.entries(state.tickets)
    .map(([key, t]) => ({
      key,
      ...t,
      report: fs.existsSync(path.join(p.reports, `${key}.md`)),
    }))
    .sort((a, b) =>
      String(b.startedAt ?? "").localeCompare(String(a.startedAt ?? ""))
    );
  return {
    jiraConfigured: !!getJiraApiConfig(),
    workspaceReady: fs.existsSync(path.join(p.workspace, ".git")),
    claudeFound: !!detectClaudeBin(),
    cycleRunning: cycleBusy,
    currentTicket: runningTicket ?? undefined,
    lastCycleAt,
    inWindow: inWindow(cfg, now),
    startedTonight: startedTonight(cfg, now),
    jiraBaseUrl: getJiraApiConfig()?.url,
    config: cfg,
    tickets,
  };
}

/** 감시 on/off — 끌 때는 실행 중 미션도 함께 중지한다 */
export function setNightwatchEnabled(enabled: boolean): NightwatchStatus {
  saveNightwatchConfig({ enabled });
  if (!enabled && runningChild) {
    appendCycleLog(`사용자 중지 — 실행 중 미션(${runningTicket}) SIGTERM`);
    try {
      runningChild.kill("SIGTERM");
    } catch {
      // 이미 종료된 프로세스면 무시
    }
  }
  return getNightwatchStatus();
}

/** Jira 인증 + JQL 후보 미리보기 — 설정 점검용 */
export async function testConnection(): Promise<NightwatchCommandResult> {
  try {
    const me = (await jiraFetch("/rest/api/3/myself")) as {
      displayName?: string;
      emailAddress?: string;
    };
    const cfg = getNightwatchConfig();
    const search = (await jiraFetch(
      `/rest/api/3/search/jql?jql=${encodeURIComponent(
        cfg.jql
      )}&maxResults=20&fields=summary,priority`
    )) as {
      issues?: {
        key: string;
        fields: { summary: string; priority?: { name?: string } };
      }[];
    };
    const state = loadNwState();
    const lines = (search.issues ?? []).map((issue) => {
      const seen = state.tickets[issue.key]
        ? `  [처리됨: ${state.tickets[issue.key].status}]`
        : "";
      return `${issue.key}  ${issue.fields.priority?.name ?? "-"}  ${
        issue.fields.summary
      }${seen}`;
    });
    return {
      ok: true,
      output: [
        `인증 OK: ${me.displayName ?? me.emailAddress ?? "unknown"}`,
        `JQL 후보 ${lines.length}건:`,
        ...lines,
      ].join("\n"),
    };
  } catch (e) {
    return { ok: false, output: e instanceof Error ? e.message : String(e) };
  }
}

/** 전용 워크스페이스 준비 — worktree + .env 복사 + npm install. 각 단계 멱등 */
export async function initWorkspace(): Promise<NightwatchCommandResult> {
  try {
    ensureNwDirs();
    const cfg = getNightwatchConfig();
    const ws = nwPaths().workspace;
    if (!fs.existsSync(path.join(cfg.scopePath, ".git"))) {
      return {
        ok: false,
        output: `분석 대상 저장소가 없습니다: ${cfg.scopePath}`,
      };
    }
    if (!fs.existsSync(path.join(ws, ".git"))) {
      // 사내 원격은 VPN 여부에 따라 끊길 수 있어 fetch 실패는 경고로 강등
      const fetched = await git(
        cfg.scopePath,
        ["fetch", "origin"],
        FETCH_TIMEOUT_MS
      );
      if (fetched.code !== 0) {
        appendCycleLog(
          "워크스페이스 생성: fetch 실패, 로컬 origin/develop 기준"
        );
      }
      const added = await git(cfg.scopePath, [
        "worktree",
        "add",
        ws,
        "--detach",
        "origin/develop",
      ]);
      if (added.code !== 0) {
        return { ok: false, output: `worktree 생성 실패: ${added.stderr}` };
      }
    }
    for (const file of fs.readdirSync(cfg.scopePath)) {
      // .env 가 디렉터리인 프로젝트도 있어 cpSync recursive 로 통일
      if (file.startsWith(".env")) {
        fs.cpSync(path.join(cfg.scopePath, file), path.join(ws, file), {
          recursive: true,
          force: true,
        });
      }
    }
    if (!fs.existsSync(path.join(ws, "node_modules"))) {
      const installed = await zsh("npm install --no-audit --no-fund", {
        cwd: ws,
        timeoutMs: NPM_INSTALL_TIMEOUT_MS,
      });
      if (installed.code !== 0) {
        return { ok: false, output: `npm install 실패: ${installed.stderr}` };
      }
    }
    appendCycleLog(`워크스페이스 준비 완료: ${ws}`);
    return { ok: true, output: "워크스페이스 준비 완료" };
  } catch (e) {
    return { ok: false, output: e instanceof Error ? e.message : String(e) };
  }
}

// ── 사이클 ──────────────────────────────────────────────────────────────
function gateSkip(reason: string): NightwatchCommandResult {
  if (reason !== lastGateReason) {
    appendCycleLog(`gate: ${reason}`);
    lastGateReason = reason;
  }
  return { ok: true, output: `실행 안 함 — ${reason}` };
}

/** 사이클 1회 — force 는 수동 실행(감시 off·시간창·유휴·상한 게이트 무시) */
export async function runCycleOnce(
  force = false
): Promise<NightwatchCommandResult> {
  if (cycleBusy) return { ok: false, output: "이미 사이클이 실행 중입니다" };
  cycleBusy = true;
  try {
    ensureNwDirs();
    const cfg = getNightwatchConfig();
    if (!getJiraApiConfig())
      return gateSkip("Jira 연동 미설정 (환경설정 → 연동)");
    if (!fs.existsSync(path.join(nwPaths().workspace, ".git"))) {
      return gateSkip("워크스페이스 미준비");
    }
    const now = new Date();
    if (!force) {
      if (!cfg.enabled) return gateSkip("감시 꺼짐");
      if (!inWindow(cfg, now)) return gateSkip("시간창 밖");
      const idle = await idleSeconds();
      if (idle < cfg.idleMinutes * 60) {
        return gateSkip(`사용자 활동 중 (idle ${idle}s < ${cfg.idleMinutes}m)`);
      }
      const started = startedTonight(cfg, now);
      if (started >= cfg.maxTicketsPerNight) {
        return gateSkip(
          `밤당 상한 도달 (${started}/${cfg.maxTicketsPerNight})`
        );
      }
    }
    lastGateReason = "";

    const search = (await jiraFetch(
      `/rest/api/3/search/jql?jql=${encodeURIComponent(
        cfg.jql
      )}&maxResults=20&fields=summary,description,priority,labels,created,comment,attachment`
    )) as { issues?: JiraIssueRaw[] };
    const issues = search.issues ?? [];
    const state = loadNwState();
    appendCycleLog(`poll: 후보 ${issues.length}건`);
    const issue = issues.find((candidate) => !state.tickets[candidate.key]);
    if (!issue) return { ok: true, output: "신규 티켓 없음" };

    return await processTicket(cfg, state, issue);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    appendCycleLog(`사이클 오류: ${message}`);
    return { ok: false, output: message };
  } finally {
    cycleBusy = false;
    lastCycleAt = new Date().toISOString();
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
  state: ReturnType<typeof loadNwState>,
  issue: JiraIssueRaw
): Promise<NightwatchCommandResult> {
  const p = nwPaths();
  const key = issue.key;
  const ticketDir = path.join(p.work, key);
  const attachmentsDir = path.join(ticketDir, "attachments");
  fs.mkdirSync(attachmentsDir, { recursive: true });
  const startedAt = new Date().toISOString();
  state.tickets[key] = { status: "in_progress", startedAt };
  saveNwState(state);
  appendCycleLog(`ticket ${key}: 시작 (${issue.fields.summary})`);

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

    await prepareWorkspace(key);

    const mission = buildObserveMission({
      key,
      ticketJson: ticketJsonPath,
      attachmentsDir,
      reportPath: path.join(p.reports, `${key}.md`),
      resultJsonPath: path.join(ticketDir, "result.json"),
      repoName: path.basename(cfg.scopePath),
    });
    runningTicket = key;
    const missionRun = runMission({
      mission,
      workspace: p.workspace,
      claudeConfigDir: cfg.claudeConfigDir,
      timeoutMinutes: cfg.timeoutMinutes,
      sessionLogPath: path.join(p.logs, `${key}.session.json`),
    });
    runningChild = missionRun.child;
    const outcome = await missionRun.done;
    runningChild = null;
    runningTicket = null;

    const violation = await enforceReadOnly(key);
    let result: {
      classification?: string;
      confidence?: number;
      summary?: string;
    } | null = null;
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
      classification: result?.classification ?? null,
      confidence: result?.confidence ?? null,
      summary: result?.summary ?? null,
      error: outcome.ok ? null : outcome.error,
      status: violation
        ? "violation_edited"
        : outcome.ok && result
        ? "analyzed"
        : "failed",
    });
    saveNwState(state);
    appendCycleLog(
      `ticket ${key}: ${entry.status} (${durationMin}분, class=${entry.classification}, conf=${entry.confidence})`
    );
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

// 분석 대상 코드를 항상 최신 origin/develop 에 맞춘다 (fetch 실패는 로컬 ref 로 강등)
async function prepareWorkspace(key: string): Promise<void> {
  const ws = nwPaths().workspace;
  const dirty = await git(ws, ["status", "--porcelain"]);
  if (dirty.stdout) {
    const salvage = await git(ws, ["diff"]);
    fs.writeFileSync(
      path.join(nwPaths().logs, `salvage-${key}-${Date.now()}.patch`),
      `${salvage.stdout}\n`
    );
    await git(ws, ["restore", "."]);
    await git(ws, ["clean", "-fd"]);
  }
  const fetched = await git(ws, ["fetch", "origin"], FETCH_TIMEOUT_MS);
  if (fetched.code !== 0) {
    appendCycleLog(`[경고] git fetch 실패, 로컬 origin/develop 기준으로 분석`);
  }
  const switched = await git(ws, ["switch", "--detach", "origin/develop"]);
  if (switched.code !== 0)
    throw new Error(`git switch 실패: ${switched.stderr}`);
}

// 관찰 모드 읽기 전용 계약 검증 — 위반 시 증거 patch 보존 후 원복
async function enforceReadOnly(key: string): Promise<boolean> {
  const ws = nwPaths().workspace;
  const dirty = await git(ws, ["status", "--porcelain"]);
  if (!dirty.stdout) return false;
  const patch = await git(ws, ["diff"]);
  fs.writeFileSync(
    path.join(nwPaths().reports, `${key}.partial.patch`),
    `${patch.stdout}\n${dirty.stdout}\n`
  );
  await git(ws, ["restore", "."]);
  await git(ws, ["clean", "-fd"]);
  return true;
}

// ── 리포트·로그 조회 ────────────────────────────────────────────────────
export function readNightwatchReport(key: string): NightwatchTextResult {
  if (!/^[A-Z][A-Z0-9]*-\d+$/.test(key)) {
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

export function readNightwatchLog(): NightwatchTextResult {
  const content = readCycleLogTail();
  return content
    ? { ok: true, content }
    : { ok: false, error: "로그가 아직 없습니다." };
}
