// 세션 pane 안에서 돌고 있는 명령 — 루트 세션이 'run dev 가 어느 탭에서 도나'를 본다(orchestrator list_terminals).
//
// `ps` 한 번으로 전 세션을 훑어 pane 셸 아래 **셸이 아닌 가장 가까운 자손들**의 실행 인자를 돌려준다
// (프리셋 `npm run dev` → `npm run dev` · 손으로 친 `pnpm dev` → 그 명령 · claude 탭 → claude 실행 인자).
// claude 찾기(claudeFiles.ts)의 `ps` 는 pid 만 읽는 잦은 경로라 따로 둔다 — 여기는 루트가 물을 때만 돈다.
// 순수 부분은 processes.test.ts.
import { execFile } from 'node:child_process';

export type ProcRow = { pid: number; ppid: number; args: string };

/** 셸 프로세스 — 이 아래를 더 내려가 본다(`-zsh`·`/bin/zsh -il`·`zsh -ic '…'`) */
const SHELL_RE = /^-?(?:\S*\/)?(?:zsh|bash|sh|fish|dash)(?:\s|$)/;
const MAX_ARGS = 160;

/** `ps -A -o pid=,ppid=,args=` 출력 → 행 */
export function parsePs(stdout: string): ProcRow[] {
  const rows: ProcRow[] = [];
  for (const line of stdout.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (m) rows.push({ pid: Number(m[1]), ppid: Number(m[2]), args: m[3].trim() });
  }
  return rows;
}

/** pane 셸(root) 아래에서 셸이 아닌 가장 가까운 자손들의 명령 — 셸은 건너뛰고 그 아래를 본다. 없으면 빈 배열 */
export function foregroundCommands(rows: ProcRow[], root: number): string[] {
  const kids = new Map<number, ProcRow[]>();
  for (const r of rows) {
    const list = kids.get(r.ppid) ?? [];
    list.push(r);
    kids.set(r.ppid, list);
  }
  const out: string[] = [];
  const queue = [...(kids.get(root) ?? [])];
  for (let guard = 0; queue.length && guard < 200; guard += 1) {
    const r = queue.shift() as ProcRow;
    if (SHELL_RE.test(r.args)) {
      queue.push(...(kids.get(r.pid) ?? []));
      continue;
    }
    out.push(r.args.length > MAX_ARGS ? `${r.args.slice(0, MAX_ARGS)}…` : r.args);
  }
  return out;
}

/** 여러 세션의 지금 명령 — `ps` 는 한 번만. 실패하면 빈 맵 */
export function sessionCommands(roots: Map<string, number>): Promise<Map<string, string[]>> {
  return new Promise((resolve) => {
    execFile(
      '/bin/ps',
      ['-A', '-o', 'pid=,ppid=,args='],
      { timeout: 3000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        const out = new Map<string, string[]>();
        if (err) return resolve(out);
        const rows = parsePs(String(stdout));
        for (const [id, root] of roots) out.set(id, foregroundCommands(rows, root));
        resolve(out);
      },
    );
  });
}
