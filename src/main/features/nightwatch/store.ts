// Nightwatch 설정·티켓 원장 저장 — 데이터는 전부 userData/nightwatch/ 아래 (비밀 없음, 평문 JSON)
// Jira 자격증명은 환경설정 공용(settings/store.ts getJiraApiConfig)이라 여기서 다루지 않는다.
import type {
  NightwatchConfig,
  NightwatchTicket,
} from "../../../shared/types";
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

// 분석 대상 저장소는 프로젝트 레지스트리(features/projects) 참조 — 여기엔 목록이 없다
const DEFAULT_CONFIG: NightwatchConfig = {
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

const clamp = (n: unknown, min: number, max: number, fallback: number) => {
  const v = Number(n);
  return Number.isFinite(v)
    ? Math.min(max, Math.max(min, Math.round(v)))
    : fallback;
};

// 명시적 구성 — 스프레드를 쓰면 구버전 config.json 의 잔존 키(repos·scopePath·jql 등)가
// status.config 로 새어 나가므로 필드를 하나씩 채운다
export function getNightwatchConfig(): NightwatchConfig {
  const saved = readJson<Partial<NightwatchConfig>>(nwPaths().config) ?? {};
  return {
    claudeConfigDir:
      typeof saved.claudeConfigDir === "string" && saved.claudeConfigDir.trim()
        ? saved.claudeConfigDir.trim()
        : DEFAULT_CONFIG.claudeConfigDir,
    timeoutMinutes: clamp(saved.timeoutMinutes, 5, 120, DEFAULT_CONFIG.timeoutMinutes),
  };
}

/** 렌더러 입력을 정제해 저장 — 형식이 깨진 값은 기존값 유지 */
export function saveNightwatchConfig(
  input: Partial<NightwatchConfig>
): NightwatchConfig {
  const prev = getNightwatchConfig();
  const next: NightwatchConfig = {
    claudeConfigDir:
      typeof input.claudeConfigDir === "string" && input.claudeConfigDir.trim()
        ? input.claudeConfigDir.trim()
        : prev.claudeConfigDir,
    timeoutMinutes: clamp(input.timeoutMinutes, 5, 120, prev.timeoutMinutes),
  };
  writeJson(nwPaths().config, next);
  return next;
}

export type NwStateTicket = Omit<NightwatchTicket, "key" | "report" | "prompt">;
export type NwState = {
  tickets: Record<string, NwStateTicket>;
  // "<프로젝트키>:<말머리>" → 마지막 선택 저장소 id (분석 시 기본 선택용)
  repoDefaults: Record<string, string>;
  // 후보에서 숨김 처리한 티켓 키 (분석 불필요 — 해결되면 자동 정리)
  hiddenTickets: string[];
};

export function loadNwState(): NwState {
  const raw = readJson<Partial<NwState>>(nwPaths().state);
  return {
    tickets: raw?.tickets ?? {},
    repoDefaults: raw?.repoDefaults ?? {},
    hiddenTickets: raw?.hiddenTickets ?? [],
  };
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
