// 워크트리 만들기 — femc-worktree 스킬의 `femc-wt.sh setup` 을 그대로 부른다(2단계, 2026-10-22).
//
// 원앱의 addWorktree(workspaces/git.ts)는 `git worktree add` 만 한다. FEMC 저장소의 워크트리는 그것만으로 일을 못 한다 —
// gitignore 된 .env·.claude 산출물·swagger 캐시·node_modules·claude 계정의 폴더 신뢰·MCP 항목까지 메인 체크아웃과 맞춰야 한다.
// 그 동작의 정본은 스크립트(`~/.claude/skills/femc-worktree/scripts/femc-wt.sh`)라 따로 구현하지 않고 부른다.
// 브랜치 판정(로컬 → origin 추적 → base 에서 새로)·base(FEMC resolve_base_branch)도 스크립트가 한다. 멱등 — 이미 있으면 빠진 것만 채운다.
// ⚠️ GUI 앱의 PATH 는 빈약하다 — node·npm·python3·rsync 를 찾게 로그인 셸(`zsh -lc`)로 띄운다(agents.ts 와 같은 방식).
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { shQuote } from '../../lib/util';

export const WT_SCRIPT = path.join(os.homedir(), '.claude', 'skills', 'femc-worktree', 'scripts', 'femc-wt.sh');

/** node_modules 를 새로 설치해야 하면(lockfile 이 다름) 수 분 걸린다 — 그보다 넉넉히 */
const SETUP_TIMEOUT_MS = 8 * 60_000;
/** 돌려줄 출력 꼬리 — 실패 원인은 끝에 있다 */
const OUTPUT_TAIL_CHARS = 2_000;

/**
 * 새 워크트리 위치 — `${FEMC_WT_ROOT:-~/projects/worktrees}/<워크스페이스 이름>/<브랜치의 / 를 ->`.
 * 스크립트의 기본(저장소 폴더 이름 — `babybonjuk-metacommerce-vue-store`) 대신 **워크스페이스 이름**(`FO-BBJ`) 아래에 둔다 —
 * 사용자가 쓰던 워크트리 배치(`~/projects/worktrees/FO-BBJ/…`)와 한 폴더에 모이게(2026-10-22 사용자 결정). 스크립트엔 `--path` 로 넘긴다.
 */
export function worktreePathFor(workspaceName: string, branch: string): string {
  const root = process.env.FEMC_WT_ROOT || path.join(os.homedir(), 'projects', 'worktrees');
  const folder = workspaceName.trim().replace(/[\s/]+/g, '-') || 'workspace';
  return path.join(root, folder, branch.replace(/\//g, '-'));
}

export type SetupResult =
  | { ok: true; path: string; warnings: string[] }
  | { ok: false; error: string; output: string };

/** 워크트리를 만들고(또는 채우고) 메인 체크아웃과 같은 상태로 — 경로를 명시해 스크립트와 원앱의 계산이 어긋나지 않게 한다 */
export function setupWorktree(input: { repoPath: string; workspaceName: string; branch: string; base?: string }): Promise<SetupResult> {
  if (!fs.existsSync(WT_SCRIPT)) {
    return Promise.resolve({
      ok: false,
      error: `femc-worktree 스킬 스크립트가 없습니다: ${WT_SCRIPT}`,
      output: '',
    });
  }
  const target = worktreePathFor(input.workspaceName, input.branch);
  const cmd = [
    'bash',
    shQuote(WT_SCRIPT),
    'setup',
    shQuote(input.branch),
    '--repo',
    shQuote(input.repoPath),
    '--path',
    shQuote(target),
    ...(input.base ? ['--base', shQuote(input.base)] : []),
  ].join(' ');
  return new Promise((resolve) => {
    execFile(
      '/bin/zsh',
      ['-lc', cmd],
      { timeout: SETUP_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, cwd: input.repoPath },
      (err, stdout, stderr) => {
        const out = `${String(stdout)}${String(stderr)}`;
        const tail = out.length > OUTPUT_TAIL_CHARS ? `…${out.slice(-OUTPUT_TAIL_CHARS)}` : out;
        if (err) {
          const fail = /\[FAIL\] (.+)/.exec(String(stderr))?.[1];
          const killed = (err as NodeJS.ErrnoException & { killed?: boolean }).killed;
          resolve({
            ok: false,
            error: fail ?? (killed ? `${SETUP_TIMEOUT_MS / 60_000}분 안에 끝나지 않아 멈췄습니다.` : err.message),
            output: tail,
          });
          return;
        }
        if (!fs.existsSync(target)) {
          resolve({ ok: false, error: `스크립트는 끝났지만 워크트리 폴더가 없습니다: ${target}`, output: tail });
          return;
        }
        const warnings = [...String(stdout).matchAll(/\[WARN\] (.+)/g)].map((m) => m[1].trim());
        resolve({ ok: true, path: target, warnings });
      },
    );
  });
}
