// femc(FEMC 하네스 런처) 설정 읽기 — 스택 목록·저장소가 등록 때 선언한 스택.
// femc CLI(`bin/femc.mjs` 의 readStacks·registeredStackOf)와 **같은 파일**을 본다(2026-10-22 실측):
//   ~/.femc/runtime-active.json 의 current.id = 지금 세대 → ~/.femc/generations/<세대>/stacks/<스택>/ · config.json(projects[이름].stack)
//   ~/.femc/config.local.json 의 projects[이름].scopes[*].path = 이 기기에 등록한 저장소 경로
// ⚠️ 등록 경로 **밖**(예: `~/projects/worktrees/…` 워크트리)은 femc 가 스택을 못 정해 실행할 때마다 선택 창을 띄운다 —
//    그래서 원앱은 아는 스택을 `--stack` 으로 넘긴다(terminal/femcStack.ts femcStackFor).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isInsidePath } from './util';

const femcHome = () => process.env.FEMC_STATE_HOME || path.join(os.homedir(), '.femc');

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** 지금 세대 폴더 — femc 가 설치되지 않았거나 읽지 못하면 null */
function generationDir(): string | null {
  const id = readJson<{ current?: { id?: string } }>(path.join(femcHome(), 'runtime-active.json'))?.current?.id;
  return id ? path.join(femcHome(), 'generations', id) : null;
}

/** 고를 수 있는 스택 id(예: jsp·react·vue) — femc 가 없으면 빈 배열 */
export function femcStacks(): string[] {
  const gen = generationDir();
  if (!gen) return [];
  try {
    return fs
      .readdirSync(path.join(gen, 'stacks'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

type LocalConfig = { projects?: Record<string, { scopes?: Record<string, { path?: string | null }> }> };
type SharedConfig = { projects?: Record<string, { stack?: string }> };

/** 등록된 저장소 경로 안이면 그 프로젝트가 선언한 스택 — femc 의 registeredStackOf 와 같은 판정 */
export function registeredFemcStack(cwd: string): string | null {
  const gen = generationDir();
  if (!gen) return null;
  const local = readJson<LocalConfig>(path.join(femcHome(), 'config.local.json'));
  const shared = readJson<SharedConfig>(path.join(gen, 'config.json'));
  if (!local?.projects || !shared?.projects) return null;
  for (const [name, entry] of Object.entries(local.projects)) {
    for (const scope of Object.values(entry?.scopes ?? {})) {
      if (typeof scope?.path !== 'string' || !isInsidePath(scope.path, cwd)) continue;
      const declared = shared.projects[name]?.stack;
      if (typeof declared === 'string') return declared;
    }
  }
  return null;
}
