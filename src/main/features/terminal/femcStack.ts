// femc 스택 고르기 — 새 femc 세션에 넘길 `--stack`. 등록 경로 밖(워크트리)에서 femc 가 매번 스택 선택 창을 띄우던 것을 막는다
// (2026-10-21 실측 — Jira [작업]·루트 세션의 새 세션이 같은 판정을 쓴다).
//
// 순서: ① 그 위치가 femc 등록 경로 안이면 등록 때 선언한 스택(lib/femc.ts) — femc 는 등록 경로에서 선언과 다른 스택을 받으면
//       실행을 거부한다(verifyStackCwd) ② 그 저장소(워크스페이스)에서 마지막으로 쓴 스택 — 재부팅 복원 기록이 femc claude 의 실행
//       인자에서 읽은 값을 `femc-stacks.json` 에 위치별로 남긴다(세션을 닫아도 남는다). 지금 femc 에 없는 스택은 버린다
//       ③ 그 워크스페이스 주 저장소의 등록 선언 ④ 모름(null).
import { femcStacks, registeredFemcStack } from '../../lib/femc';
import { readUserJson, writeUserJson } from '../../lib/store';
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

/** 새 femc 세션의 스택 — 등록 선언 → 그 위치의 저장소에서 마지막으로 쓴 것 → 주 저장소의 등록 선언 → 모르면 null */
export async function femcStackFor(cwd: string): Promise<string | null> {
  const declared = registeredFemcStack(cwd);
  if (declared) return declared;
  const known = new Set(femcStacks());
  // femc 를 못 읽으면(세대 폴더 없음) 기록을 걸러 낼 기준이 없다 — 그대로 믿는다
  const usable = (stack: string) => known.size === 0 || known.has(stack);
  const seen = readUserJson<Seen>(FILE, {});
  // 지금 떠 있는 femc 세션의 기록도 후보 — 이 기록이 생기기 전부터 돌던 세션
  for (const p of listPersisted()) {
    const r = p.resume;
    if (r?.launcher === 'femc' && r.stack && !seen[r.cwd]) seen[r.cwd] = { stack: r.stack, at: p.createdAt };
  }
  if (seen[cwd] && usable(seen[cwd].stack)) return seen[cwd].stack;
  const here = await sessionLocation(cwd);
  if (here) {
    // 최근 것부터 — 같은 워크스페이스의 첫 기록에서 멈춘다(위치마다 git 조회라 다 볼 이유가 없다)
    const recent = Object.entries(seen)
      .filter(([, v]) => usable(v.stack))
      .sort((a, b) => b[1].at - a[1].at);
    for (const [where, v] of recent) {
      if ((await sessionLocation(where))?.wsId === here.wsId) return v.stack;
    }
  }
  // 워크트리는 등록 경로 밖이다 — 그 워크스페이스(주 저장소)의 등록 선언을 본다
  const repo = here ? listWorkspaces().find((w) => w.id === here.wsId)?.repoPath : undefined;
  return repo ? registeredFemcStack(repo) : null;
}
