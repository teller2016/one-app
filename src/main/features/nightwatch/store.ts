// Nightwatch 설정·티켓 원장 저장 — 데이터는 전부 userData/nightwatch/ 아래 (비밀 없음, 평문 JSON)
// Jira 자격증명은 환경설정 공용(settings/store.ts getJiraApiConfig)이라 여기서 다루지 않는다.
import type {
  NightwatchAutoConfig,
  NightwatchAutoState,
  NightwatchConfig,
  NightwatchTicket,
} from "../../../shared/types";
import { todayKey } from "../../../shared/date";
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
    autoState: path.join(base, "auto-state.json"),
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

// 자동 순회 기본값 — 끄고 시작한다. maxPerDay 0 = 무제한(후보가 소진되면 알아서 멈춘다)
// repoIds 빈 배열 = 대상 제한 없음(설정 전 기존 사용자는 지금까지와 같이 전체 프로젝트가 대상)
const DEFAULT_AUTO: NightwatchAutoConfig = {
  enabled: false,
  model: "opus",
  maxPerDay: 0,
  repoIds: [],
};

// 분석 대상 저장소는 프로젝트 레지스트리(features/projects) 참조 — 여기엔 목록이 없다
const DEFAULT_CONFIG: NightwatchConfig = {
  claudeConfigDir: path.join(os.homedir(), ".claude"),
  timeoutMinutes: 40,
  auto: DEFAULT_AUTO,
};

// claude CLI --model 에 넘길 별칭 형식 (engine 의 sanitizeAnalyzeOpts 와 같은 기준)
const MODEL_RE = /^[A-Za-z0-9._-]{1,64}$/;

/** 자동 순회 설정 정제 — 형식이 깨진 값은 이전값(없으면 기본값) 유지 */
function sanitizeAuto(
  input: Partial<NightwatchAutoConfig> | undefined,
  prev: NightwatchAutoConfig
): NightwatchAutoConfig {
  const model =
    input?.model === null
      ? null
      : typeof input?.model === "string" && MODEL_RE.test(input.model.trim())
        ? input.model.trim()
        : input?.model === undefined
          ? prev.model
          : // 빈 문자열은 "CLI 기본" 선택 — null 로 정규화한다
            null;
  return {
    enabled:
      typeof input?.enabled === "boolean" ? input.enabled : prev.enabled,
    model,
    maxPerDay: clamp(input?.maxPerDay, 0, 50, prev.maxPerDay),
    repoIds: Array.isArray(input?.repoIds)
      ? [
          ...new Set(
            input.repoIds.filter(
              (id): id is string => typeof id === "string" && id.trim().length > 0
            )
          ),
        ]
      : prev.repoIds,
  };
}

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
    auto: sanitizeAuto(saved.auto, DEFAULT_AUTO),
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
    auto: sanitizeAuto(input.auto, prev.auto),
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

/**
 * 원장을 방금 읽어 고친 뒤 곧바로 저장한다 — 짧은 read-modify-write 한 단위.
 *
 * ⚠️ 오래 걸리는 작업(미션은 수십 분)이 시작 때 읽은 state 스냅샷을 들고 있다가
 * 종료 시 `saveNwState(state)` 로 통째로 저장하면, 그 사이의 숨김·삭제·자동 정리가
 * 전부 되돌아간다(lost update — 2026-08-31 감사에서 확인). 장기 작업의 종료 기록은
 * 스냅샷 저장이 아니라 반드시 이 함수로 쓸 것. mutate 는 동기 함수여야 한다
 * (await 를 끼우면 다시 같은 병이 된다).
 */
export function updateNwState<T>(mutate: (state: NwState) => T): T {
  const state = loadNwState();
  const result = mutate(state);
  saveNwState(state);
  return result;
}

// ── 자동 순회 진행 상태 ──────────────────────────────────────────────────
// ⚠️ 메모리에만 두면 안 된다 — 앱 재시작이 하루 상한과 '오늘 건너뛴 티켓' 기억을
// 지워버려, 저장소를 못 정한 티켓에 매 tick 마다 선택 미션을 다시 태운다.
const EMPTY_AUTO_STATE = (): NightwatchAutoState => ({
  date: todayKey(),
  count: 0,
  skipped: [],
});

/** 오늘의 자동 순회 상태 — 저장된 날짜가 어제면 빈 상태로 시작한다 */
export function loadAutoState(): NightwatchAutoState {
  const raw = readJson<Partial<NightwatchAutoState>>(nwPaths().autoState);
  const today = todayKey();
  if (!raw || raw.date !== today) return EMPTY_AUTO_STATE();
  return {
    date: today,
    count: typeof raw.count === "number" && raw.count > 0 ? Math.floor(raw.count) : 0,
    skipped: Array.isArray(raw.skipped)
      ? raw.skipped.filter((k): k is string => typeof k === "string")
      : [],
    lastCheckAt: typeof raw.lastCheckAt === "string" ? raw.lastCheckAt : undefined,
    lastPick: typeof raw.lastPick === "string" ? raw.lastPick : null,
    lastError: typeof raw.lastError === "string" ? raw.lastError : null,
  };
}

export function saveAutoState(state: NightwatchAutoState) {
  writeJson(nwPaths().autoState, state);
}

// 사이클 로그 상한 — 이 로그는 tail 로만 읽히는데 로테이션이 없어 앱을 쓰는 내내
// 무한히 자랐다. 상한을 넘으면 뒤쪽 절반만 남긴다(읽는 쪽은 마지막 200줄뿐이다).
const CYCLE_LOG_MAX_BYTES = 256 * 1024;

export function appendCycleLog(message: string) {
  try {
    ensureNwDirs();
    const file = nwPaths().cycleLog;
    fs.appendFileSync(file, `[${new Date().toISOString()}] ${message}\n`);
    if (fs.statSync(file).size > CYCLE_LOG_MAX_BYTES) {
      const raw = fs.readFileSync(file, "utf8");
      // 줄 경계에서 자른다 — 첫 줄이 반토막 나면 tail 이 깨진 문자열을 보여준다
      const cut = raw.indexOf("\n", Math.floor(raw.length / 2));
      fs.writeFileSync(file, cut >= 0 ? raw.slice(cut + 1) : raw, "utf8");
    }
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
