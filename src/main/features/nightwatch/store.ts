// Nightwatch 설정·티켓 원장 저장 — 데이터는 전부 userData/nightwatch/ 아래 (비밀 없음, 평문 JSON)
// Jira 자격증명은 환경설정 공용(settings/store.ts getJiraApiConfig)이라 여기서 다루지 않는다.
import type { NightwatchConfig, NightwatchTicket } from "../../../shared/types";
import { app } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const nwPaths = () => {
  const base = path.join(app.getPath("userData"), "nightwatch");
  return {
    base,
    config: path.join(base, "config.json"),
    state: path.join(base, "state.json"),
    workspace: path.join(base, "workspace"),
    work: path.join(base, "work"),
    reports: path.join(base, "reports"),
    logs: path.join(base, "logs"),
    cycleLog: path.join(base, "logs", "cycle.log"),
  };
};

export function ensureNwDirs() {
  const p = nwPaths();
  for (const dir of [p.base, p.work, p.reports, p.logs]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

const DEFAULT_CONFIG: NightwatchConfig = {
  enabled: false,
  scopePath: path.join(
    os.homedir(),
    "projects/babybonjuk/babybonjuk-metacommerce-vue-store"
  ),
  jql: 'project = BBJ AND issuetype = Bug AND assignee = currentUser() AND status = "해야 할 일" ORDER BY priority DESC, created ASC',
  windowStart: "21:00",
  windowEnd: "07:00",
  weekendAllDay: true,
  idleMinutes: 30,
  maxTicketsPerNight: 3,
  claudeConfigDir: path.join(os.homedir(), ".claude"),
  timeoutMinutes: 40,
};

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

// 야간 무인 갱신 중 크래시로 파일이 반파되지 않도록 tmp+rename 원자 쓰기 고정
function writeJson(file: string, value: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

export function getNightwatchConfig(): NightwatchConfig {
  return {
    ...DEFAULT_CONFIG,
    ...(readJson<NightwatchConfig>(nwPaths().config) ?? {}),
  };
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const clamp = (n: unknown, min: number, max: number, fallback: number) => {
  const v = Number(n);
  return Number.isFinite(v)
    ? Math.min(max, Math.max(min, Math.round(v)))
    : fallback;
};

/** 렌더러 입력을 정제해 저장 — 형식이 깨진 값은 기존값 유지 */
export function saveNightwatchConfig(
  input: Partial<NightwatchConfig>
): NightwatchConfig {
  const prev = getNightwatchConfig();
  const next: NightwatchConfig = {
    enabled: typeof input.enabled === "boolean" ? input.enabled : prev.enabled,
    scopePath:
      typeof input.scopePath === "string" && input.scopePath.trim()
        ? input.scopePath.trim()
        : prev.scopePath,
    jql:
      typeof input.jql === "string" && input.jql.trim()
        ? input.jql.trim()
        : prev.jql,
    windowStart: TIME_RE.test(input.windowStart ?? "")
      ? (input.windowStart as string)
      : prev.windowStart,
    windowEnd: TIME_RE.test(input.windowEnd ?? "")
      ? (input.windowEnd as string)
      : prev.windowEnd,
    weekendAllDay:
      typeof input.weekendAllDay === "boolean"
        ? input.weekendAllDay
        : prev.weekendAllDay,
    idleMinutes: clamp(input.idleMinutes, 1, 120, prev.idleMinutes),
    maxTicketsPerNight: clamp(
      input.maxTicketsPerNight,
      1,
      10,
      prev.maxTicketsPerNight
    ),
    claudeConfigDir:
      typeof input.claudeConfigDir === "string" && input.claudeConfigDir.trim()
        ? input.claudeConfigDir.trim()
        : prev.claudeConfigDir,
    timeoutMinutes: clamp(input.timeoutMinutes, 5, 120, prev.timeoutMinutes),
  };
  writeJson(nwPaths().config, next);
  return next;
}

export type NwStateTicket = Omit<NightwatchTicket, "key" | "report">;
export type NwState = { tickets: Record<string, NwStateTicket> };

export function loadNwState(): NwState {
  return readJson<NwState>(nwPaths().state) ?? { tickets: {} };
}

export function saveNwState(state: NwState) {
  writeJson(nwPaths().state, state);
}

export function appendCycleLog(message: string) {
  try {
    ensureNwDirs();
    fs.appendFileSync(
      nwPaths().cycleLog,
      `[${new Date().toISOString()}] ${message}\n`
    );
  } catch {
    // 로그 실패가 사이클을 막으면 안 된다
  }
}

export function readCycleLogTail(lines = 200): string {
  try {
    const raw = fs.readFileSync(nwPaths().cycleLog, "utf8").trimEnd();
    return raw.split("\n").slice(-lines).join("\n");
  } catch {
    return "";
  }
}
