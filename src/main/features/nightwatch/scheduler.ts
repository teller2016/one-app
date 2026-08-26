// Nightwatch 자동 순회 스케줄러 — 설정의 `auto.enabled` 가 켜져 있는 동안 주기적으로
// 미처리 후보를 확인해 **한 건씩** 분석을 시작한다.
//
// 시각 스케줄은 없다(토글이 곧 스위치). 켜두면 계속 돌고, 후보는 분석 이력이 생기면
// 목록에서 빠지므로(engine 의 listCandidates) 다 소화하면 조용히 대기하다가 새 티켓이
// 생기면 다시 집는다 — 같은 티켓을 반복 분석하는 경로는 구조적으로 없다.
//
// 사람이 저장소를 골라주지 않으므로 3단 폴백으로 정한다:
//   ① 학습값(repoDefaults — 같은 프로젝트·말머리로 지난번 고른 저장소)
//   ② claude 경량 호출(mission 의 pickRepoWithClaude)
//   ③ Jira 프로젝트 키가 일치하는 프로젝트가 정확히 하나일 때
// 셋 다 실패하면 그 티켓은 **오늘 하루** 건너뛴다(auto-state 의 skipped) — 매 tick 마다
// 같은 티켓에 선택 미션을 다시 태우면 비용만 쓴다.
//
// ⚠️ 세 폴백 모두 설정의 **분석 대상 저장소(auto.repoIds)** 게이트를 통과해야 한다
// (빈 배열이면 제한 없음). ②의 후보 목록만 좁히면 ①의 학습값이 그 게이트를 우회한다 —
// 한 번 잘못 고른 저장소가 repoDefaults 에 굳으면 계속 그리로 가므로 게이트는
// usableRepoId() 한 곳에 둔다. 수동 [분석]은 이 게이트와 무관하다.
import { getJiraApiConfig } from "../settings/store";
import { findProjectsByJiraKey, getProject, listProjects } from "../projects/store";
import { analyzeTicket, isAnalysisActive, listCandidates } from "./engine";
import { ensureClaudeBin, pickRepoWithClaude } from "./mission";
import type { RepoPickCandidate } from "./mission";
import {
  appendCycleLog,
  getNightwatchConfig,
  loadAutoState,
  nwPaths,
  saveAutoState,
} from "./store";
import type { NightwatchAutoState, NightwatchCandidate } from "../../../shared/types";
import fs from "node:fs";
import path from "node:path";

const TICK_MS = 5 * 60 * 1000;
// 한 tick 에서 저장소 선택을 시도할 후보 수 상한 — 학습값이 없는 티켓이 줄줄이 있을 때
// claude 호출이 무제한으로 이어지지 않게 막는다(못 정한 티켓은 오늘 skipped 로 빠진다).
const PICK_ATTEMPTS_PER_TICK = 3;
// 자동 선택을 받아들이는 최소 신뢰도 — 이하면 "모르겠다"로 보고 다음 폴백으로 넘긴다
const PICK_MIN_CONFIDENCE = 0.5;

let timer: ReturnType<typeof setInterval> | null = null;
// tick 재진입 방지 — 후보 조회(Jira REST)와 저장소 선택(claude 호출 최대 3분)이
// tick 주기보다 길어질 수 있다. 분석 자체는 던져 두고 빠지므로 이 구간만 보호한다.
let ticking = false;

/** 진행 상태 갱신 — 부분 필드만 덮어쓰고 즉시 저장 (재시작해도 오늘 기억이 남는다) */
function patchAutoState(patch: Partial<NightwatchAutoState>) {
  const state = loadAutoState();
  saveAutoState({ ...state, ...patch });
}

const jiraKeyOf = (ticketKey: string) => ticketKey.split("-")[0];

/**
 * 자동 순회가 이 저장소를 쓸 수 있는지 — 설정의 분석 대상이고, 레지스트리에 있고,
 * 실제 git 작업 트리인지까지. `allowed` 가 비어 있으면 대상 제한이 없다는 뜻이다.
 */
function usableRepoId(
  repoId: string | null | undefined,
  allowed: Set<string>
): string | null {
  if (!repoId) return null;
  if (allowed.size > 0 && !allowed.has(repoId)) return null;
  const project = getProject(repoId);
  if (!project) return null;
  return fs.existsSync(path.join(project.localPath, ".git")) ? repoId : null;
}

/**
 * 티켓 하나의 분석 저장소 결정 — 3단 폴백. 정하지 못하면 null.
 * claude 호출은 학습값이 없을 때만 타므로 이미 다뤄본 조합에는 비용이 들지 않는다.
 */
async function resolveRepoId(
  candidate: NightwatchCandidate,
  claudeConfigDir: string,
  allowed: Set<string>
): Promise<{ repoId: string; how: string } | null> {
  // ① 학습값 (분석 대상에서 뺀 저장소를 가리키면 무시하고 다음 폴백으로 넘어간다)
  const learned = usableRepoId(candidate.suggestedRepoId, allowed);
  if (learned) return { repoId: learned, how: "학습값" };

  // ② claude 에게 고르게 한다 (분석 대상이면서 로컬 경로가 있는 프로젝트만 후보로)
  const projects = listProjects().filter(
    (p) => p.localPath.trim() && (allowed.size === 0 || allowed.has(p.id))
  );
  const pickCandidates: RepoPickCandidate[] = projects.map((p) => ({
    id: p.id,
    name: p.name,
    jiraProjectKey: p.jiraProjectKey,
    localPath: p.localPath,
  }));
  if (pickCandidates.length > 0) {
    const pick = await pickRepoWithClaude({
      ticket: {
        key: candidate.key,
        summary: candidate.summary,
        // 후보 목록에는 본문이 없다 — 제목·타입·상태로만 판단한다(본문까지 받으려면
        // 티켓 상세를 따로 조회해야 해서, 분류에 필요한 최소 정보로 맞췄다)
        description: `issueType: ${candidate.issueType}\nstatus: ${candidate.status}\npriority: ${candidate.priority ?? "-"}`,
      },
      candidates: pickCandidates,
      claudeConfigDir,
      cwd: nwPaths().base, // 저장소가 정해지기 전이라 어떤 작업 트리에도 들어가지 않는다
    });
    // 모델이 목록에 없는 id 를 낼 수 있으므로 레지스트리·분석 대상으로 다시 검증한다
    const picked = usableRepoId(pick?.repoId, allowed);
    if (picked && (pick?.confidence ?? 0) >= PICK_MIN_CONFIDENCE) {
      return {
        repoId: picked,
        how: `claude 선택 (${Math.round((pick?.confidence ?? 0) * 100)}%${
          pick?.reason ? ` — ${pick.reason}` : ""
        })`,
      };
    }
    if (pick) {
      appendCycleLog(
        `자동 선택 보류: ${candidate.key} — 신뢰도 ${Math.round(
          pick.confidence * 100
        )}%${pick.reason ? ` (${pick.reason})` : ""}`
      );
    }
  }

  // ③ Jira 프로젝트 키가 일치하는 프로젝트가 정확히 하나일 때만
  const byKey = findProjectsByJiraKey(jiraKeyOf(candidate.key)).filter((p) =>
    usableRepoId(p.id, allowed)
  );
  if (byKey.length === 1) return { repoId: byKey[0].id, how: "Jira 키 일치" };

  return null;
}

async function tick() {
  if (ticking) return;
  const cfg = getNightwatchConfig();
  if (!cfg.auto.enabled) return;

  // 진행 중(또는 대기열)이면 아무것도 하지 않는다 — 자동은 한 번에 한 건이고,
  // 사용자가 수동으로 넣은 분석과 경합하지 않는다.
  if (isAnalysisActive()) return;

  const state = loadAutoState();
  if (cfg.auto.maxPerDay > 0 && state.count >= cfg.auto.maxPerDay) return;
  if (!getJiraApiConfig()) {
    patchAutoState({ lastCheckAt: new Date().toISOString(), lastError: "Jira 연동 미설정" });
    return;
  }
  if (!(await ensureClaudeBin())) {
    patchAutoState({
      lastCheckAt: new Date().toISOString(),
      lastError: "claude 바이너리를 찾을 수 없음",
    });
    return;
  }

  // 설정에서 고른 분석 대상 저장소 — 비어 있으면 제한 없음(등록된 프로젝트 전체가 대상)
  const allowed = new Set(cfg.auto.repoIds);
  if (allowed.size > 0 && !listProjects().some((p) => allowed.has(p.id))) {
    // 대상으로 고른 프로젝트가 레지스트리에서 전부 사라진 경우 — 무제한으로 되돌리지 않는다
    // (그러면 일부러 뺀 저장소가 조용히 다시 대상이 된다)
    patchAutoState({
      lastCheckAt: new Date().toISOString(),
      lastError: "분석 대상 저장소가 프로젝트 목록에 없습니다",
    });
    return;
  }

  ticking = true;
  try {
    const list = await listCandidates();
    if (!list.ok || !list.candidates) {
      patchAutoState({
        lastCheckAt: new Date().toISOString(),
        lastError: list.error ?? "후보 조회 실패",
      });
      return;
    }
    const skipped = new Set(loadAutoState().skipped);
    // 해결된 티켓은 자동 대상이 아니다 — 후보에 남아 있는 건 직접 추가(pinned)한 티켓뿐이고,
    // 이미 끝난 일에 무인으로 미션 비용을 쓸 이유가 없다(수동 [분석]으로는 언제든 가능).
    const targets = list.candidates.filter(
      (c) => !skipped.has(c.key) && !c.resolved
    );
    if (targets.length === 0) {
      patchAutoState({ lastCheckAt: new Date().toISOString(), lastError: null });
      return;
    }

    for (const candidate of targets.slice(0, PICK_ATTEMPTS_PER_TICK)) {
      // 저장소 선택은 분류라 haiku 고정(mission 의 PICK_MODEL) — 설정 모델은 분석 본편에만 쓴다
      const resolved = await resolveRepoId(candidate, cfg.claudeConfigDir, allowed);
      if (!resolved) {
        // 오늘은 이 티켓을 다시 시도하지 않는다 (수동 [분석]으로는 언제든 가능)
        const cur = loadAutoState();
        saveAutoState({
          ...cur,
          skipped: [...cur.skipped, candidate.key],
          lastCheckAt: new Date().toISOString(),
        });
        appendCycleLog(
          `자동 건너뜀: ${candidate.key} — 분석 저장소를 정하지 못했습니다 (오늘 재시도 없음)`
        );
        continue;
      }

      // 분석은 던져 두고 빠진다 — 미션은 최대 timeoutMinutes 라 await 하면
      // 이 tick 이 그 시간만큼 붙잡힌다(다음 tick 은 isAnalysisActive 로 알아서 쉰다).
      const started = loadAutoState();
      saveAutoState({
        ...started,
        count: started.count + 1,
        lastCheckAt: new Date().toISOString(),
        lastPick: `${candidate.key} → ${resolved.how}`,
        lastError: null,
      });
      appendCycleLog(
        `자동 시작: ${candidate.key} (${resolved.how}, 오늘 ${started.count + 1}건${
          cfg.auto.maxPerDay > 0 ? `/${cfg.auto.maxPerDay}` : ""
        })`
      );
      void analyzeTicket(candidate.key, resolved.repoId, {
        model: cfg.auto.model,
      }).then((res) => {
        if (!res.ok) appendCycleLog(`자동 시작 실패: ${res.output}`);
      });
      return; // 한 tick 에 한 건만 시작한다
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    appendCycleLog(`자동 순회 오류: ${message}`);
    patchAutoState({ lastCheckAt: new Date().toISOString(), lastError: message });
  } finally {
    ticking = false;
  }
}

/**
 * 타이머 가동 여부 재평가 — 자동 순회를 꺼 두면 인터벌 자체를 없앤다.
 * 설정을 저장할 때(`nightwatch:config:save`) 다시 불러 준다 — 그래야 재시작 없이 켜고 끌 수 있다.
 */
export function refreshNightwatchSchedule(opts?: { immediate?: boolean }): void {
  const enabled = getNightwatchConfig().auto.enabled;
  if (enabled && !timer) {
    timer = setInterval(() => void tick(), TICK_MS);
    appendCycleLog("자동 순회 켜짐");
    // 사용자가 방금 켠 경우엔 바로 한 번 확인한다 — 5분을 기다리면 켜진 건지 알 수 없다.
    // 반대로 앱 부팅 경로에서는 즉시 돌리지 않는다(켜 둔 채 앱을 열자마자 미션이 뜨면 놀란다).
    if (opts?.immediate) void tick();
  } else if (!enabled && timer) {
    clearInterval(timer);
    timer = null;
    appendCycleLog("자동 순회 꺼짐");
  }
}

/** 자동 순회 스케줄러 시작 (앱 ready 후 1회) */
export function startNightwatchScheduler(): void {
  refreshNightwatchSchedule();
}

/** 앱 종료 시 타이머 해제 */
export function stopNightwatchScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
