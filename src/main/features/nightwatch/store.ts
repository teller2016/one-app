// Nightwatch 설정·티켓 원장 저장 — 데이터는 전부 userData/nightwatch/ 아래 (비밀 없음, 평문 JSON)
// Jira 자격증명은 환경설정 공용(settings/store.ts getJiraApiConfig)이라 여기서 다루지 않는다.
import type {
  NightwatchConfig,
  NightwatchRepo,
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

const proj = (rel: string) => path.join(os.homedir(), "projects", rel);

// 팀 표준 저장소 배치 기준 기본 목록 — 설정 UI 에서 자유롭게 추가·삭제
const DEFAULT_REPOS: NightwatchRepo[] = [
  {
    id: "bbj-store",
    name: "babybonjuk store",
    path: proj("babybonjuk/babybonjuk-metacommerce-vue-store"),
  },
  {
    id: "bbj-admin",
    name: "babybonjuk admin",
    path: proj("babybonjuk/babybonjuk-metacommerce-vue-admin"),
  },
  {
    id: "bbj-api",
    name: "babybonjuk api",
    path: proj("babybonjuk/babybonjuk-metacommerce-api"),
  },
  {
    id: "mc-store",
    name: "metacommerce store",
    path: proj("metacommerce/metacommerce-fe-store"),
  },
  {
    id: "mc-admin",
    name: "metacommerce admin",
    path: proj("metacommerce/metacommerce-fe-admin"),
  },
  {
    id: "mc-be",
    name: "metacommerce be",
    path: proj("metacommerce/metacommerce-be"),
  },
  {
    id: "gmc-store",
    name: "global store",
    path: proj("global-metacommerce/global-metacommerce-fe-store"),
  },
  {
    id: "gmc-admin",
    name: "global admin",
    path: proj("global-metacommerce/global-metacommerce-fe-admin"),
  },
  {
    id: "gmc-be",
    name: "global be",
    path: proj("global-metacommerce/global-metacommerce-be"),
  },
];

const DEFAULT_CONFIG: NightwatchConfig = {
  repos: DEFAULT_REPOS,
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

/** repos 입력 정제 — 경로 없는 행 제거, 이름 없으면 폴더명, id 없으면 생성 */
function sanitizeRepos(input: unknown): NightwatchRepo[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter(
      (r): r is Partial<NightwatchRepo> =>
        !!r && typeof r === "object" && typeof r.path === "string" && !!r.path.trim()
    )
    .map((r) => {
      const repoPath = (r.path as string).trim();
      return {
        id:
          typeof r.id === "string" && r.id
            ? r.id
            : `repo-${Math.random().toString(36).slice(2, 8)}`,
        name:
          typeof r.name === "string" && r.name.trim()
            ? r.name.trim()
            : path.basename(repoPath),
        path: repoPath,
      };
    });
}

export function getNightwatchConfig(): NightwatchConfig {
  const saved = readJson<Partial<NightwatchConfig>>(nwPaths().config) ?? {};
  const repos = sanitizeRepos(saved.repos);
  return {
    ...DEFAULT_CONFIG,
    ...saved,
    // 구버전(scopePath 단일) 설정이거나 목록이 비면 기본 목록으로
    repos: repos.length ? repos : DEFAULT_REPOS,
  };
}

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
  const repos = sanitizeRepos(input.repos);
  const next: NightwatchConfig = {
    repos: repos.length ? repos : prev.repos,
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
};

export function loadNwState(): NwState {
  const raw = readJson<Partial<NwState>>(nwPaths().state);
  return {
    tickets: raw?.tickets ?? {},
    repoDefaults: raw?.repoDefaults ?? {},
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
