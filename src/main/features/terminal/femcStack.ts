// femc 스택 고르기 — 새 femc 세션에 넘길 `--stack`. 등록 경로 밖(워크트리)에서 femc 가 매번 스택 선택 창을 띄우던 것을 막는다
// (2026-10-21 실측 — Jira [작업]·루트 세션의 새 세션이 같은 판정을 쓴다).
//
// 순서: ① 그 저장소(워크스페이스)에서 마지막으로 쓴 스택 — 재부팅 복원 기록이 femc claude 의 실행 인자에서 읽은 값을
//       `femc-stacks.json` 에 위치별로 남긴다(세션을 닫아도 남는다) ② femc 에 등록 때 선언한 스택(lib/femc.ts) ③ 모름(null).
import { readUserJson, writeUserJson } from '../../lib/store';
import { registeredFemcStack } from '../../lib/femc';
import { listWorkspaces } from '../workspaces/store';
import { sessionLocation } from './location';
import { listPersisted } from './sessions-store';

const FILE = 'femc-stacks.json';
/** 위치 → 마지막으로 본 스택·시각. 오래된 것까지 다 들고 있을 이유는 없다 — 위치 50곳 */
const KEEP = 50;

type Seen = Record<string, { stack: string; at: number }>;

/** 재개 정보를 적을 때 함께 — 그 위치에서 femc 가 이 스택으로 돌았다 */
export function rememberFemcStack(cwd: string, stack: string): void {
  const seen = readUserJson<Seen>(FILE, {});
  if (seen[cwd]?.stack === stack && Date.now() - seen[cwd].at < 60 * 60_000) return; // 같은 값은 한 시간에 한 번만 다시 쓴다
  seen[cwd] = { stack, at: Date.now() };
  const kept = Object.entries(seen)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, KEEP);
  writeUserJson(FILE, Object.fromEntries(kept));
}

/** 새 femc 세션의 스택 — 그 위치의 저장소에서 마지막으로 쓴 것 → 등록 선언 → 모르면 null */
export async function femcStackFor(cwd: string): Promise<string | null> {
  const seen = readUserJson<Seen>(FILE, {});
  // 지금 떠 있는 femc 세션의 기록도 후보 — 이 기록이 생기기 전부터 돌던 세션
  for (const p of listPersisted()) {
    const r = p.resume;
    if (r?.launcher === 'femc' && r.stack && !seen[r.cwd]) seen[r.cwd] = { stack: r.stack, at: p.createdAt };
  }
  if (seen[cwd]) return seen[cwd].stack;
  const here = await sessionLocation(cwd);
  if (here) {
    let best: { stack: string; at: number } | null = null;
    for (const [where, v] of Object.entries(seen)) {
      if (best && v.at <= best.at) continue;
      const loc = await sessionLocation(where);
      if (loc?.wsId === here.wsId) best = v;
    }
    if (best) return best.stack;
  }
  const declared = registeredFemcStack(cwd);
  if (declared) return declared;
  // 워크트리는 등록 경로 밖이다 — 그 워크스페이스(주 저장소)의 등록 선언을 본다
  const repo = here ? listWorkspaces().find((w) => w.id === here.wsId)?.repoPath : undefined;
  return repo ? registeredFemcStack(repo) : null;
}
