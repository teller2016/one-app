// 터미널 세션 안에서 도는 claude 찾기 + 대화 기록 파일 읽기 — 채팅 보기(chat.ts)와 세션 현황(overview.ts)이 공유한다.
//
// 화면을 긁어 추측하지 않는다 — claude 는 실행 중인 프로세스마다 `$CLAUDE_CONFIG_DIR/sessions/<pid>.json`
// (`{pid, sessionId, cwd, status, …}`)을 두고, 대화를 `$CLAUDE_CONFIG_DIR/projects/<cwd>/<sessionId>.jsonl` 에
// 줄 단위로 남긴다(2026-10-01 실측, Claude Code 2.1.x). 그래서
//   세션 pane 셸 pid → 자손 프로세스 중 sessions/<pid>.json 이 있는 것 → sessionId → jsonl
// 순으로 **추측 없이** 이어진다. 계정이 여럿(`~/.claude`·`~/.claude-team` — CLAUDE_CONFIG_DIR 셸 함수)이라
// 홈의 `.claude*` 폴더를 전부 후보로 본다.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sessionRootPid } from './pty';

export type ClaudeProcess = {
  pid: number;
  configDir: string;
  sessionId: string;
  cwd: string;
  /** 대화 파일 — 아직 없을 수 있다(첫 메시지 전) */
  file: string;
  /** claude 가 남긴 상태 — 'busy' · 'idle' · 'waiting'(터미널에서 답 대기) */
  status?: string;
};

let configDirsCache: { at: number; dirs: string[] } | null = null;

/** claude 설정 폴더 후보 — 홈의 `.claude`·`.claude-*` 중 sessions/ 가 있는 것 (1분 캐시) */
function configDirs(): string[] {
  if (configDirsCache && Date.now() - configDirsCache.at < 60_000) return configDirsCache.dirs;
  const home = os.homedir();
  const dirs = new Set<string>();
  if (process.env.CLAUDE_CONFIG_DIR) dirs.add(process.env.CLAUDE_CONFIG_DIR);
  try {
    for (const name of fs.readdirSync(home)) {
      if (name === '.claude' || name.startsWith('.claude-')) dirs.add(path.join(home, name));
    }
  } catch {
    // 홈을 못 읽으면 후보 없음
  }
  const list = [...dirs].filter((d) => fs.existsSync(path.join(d, 'sessions')));
  configDirsCache = { at: Date.now(), dirs: list };
  return list;
}

/** 프로세스 트리(ppid → 자식 pid 들) — `ps` 한 번. 실패하면 null */
function processTree(): Promise<Map<number, number[]> | null> {
  return new Promise((resolve) => {
    execFile('/bin/ps', ['-A', '-o', 'pid=,ppid='], { timeout: 3000 }, (err, stdout) => {
      if (err) return resolve(null);
      const children = new Map<number, number[]>();
      for (const line of String(stdout).split('\n')) {
        const [pid, ppid] = line.trim().split(/\s+/).map(Number);
        if (!pid || Number.isNaN(ppid)) continue;
        const arr = children.get(ppid) ?? [];
        arr.push(pid);
        children.set(ppid, arr);
      }
      resolve(children);
    });
  });
}

/** 뿌리 pid 의 자손(자신 포함, 가까운 순) — 트리를 못 얻었으면 뿌리만 */
function descendantsOf(root: number, children: Map<number, number[]> | null): number[] {
  if (!children) return [root];
  const out: number[] = [];
  const queue = [root];
  while (queue.length && out.length < 200) {
    const p = queue.shift() as number;
    out.push(p);
    queue.push(...(children.get(p) ?? []));
  }
  return out;
}

type SessionMeta = { sessionId?: string; cwd?: string; status?: string };

function readMeta(configDir: string, pid: number): SessionMeta | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(configDir, 'sessions', `${pid}.json`), 'utf8')) as SessionMeta;
  } catch {
    return null;
  }
}

/** `/Users/me/a.b` → `-Users-me-a-b` — claude 의 projects 폴더 이름 규칙(영숫자 외 전부 '-') */
const projectSlug = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, '-');

/** 대화 파일 경로 — 아직 없으면(첫 메시지 전) 생길 자리를 돌려준다. 생기면 증분 읽기가 0 바이트부터 따라간다 */
function transcriptFile(configDir: string, sessionId: string, cwd: string): string {
  const direct = path.join(configDir, 'projects', projectSlug(cwd), `${sessionId}.jsonl`);
  if (fs.existsSync(direct)) return direct;
  // 이름 규칙이 바뀌었을 때의 안전망 — projects 아래를 한 단계만 훑는다
  try {
    for (const dir of fs.readdirSync(path.join(configDir, 'projects'))) {
      const f = path.join(configDir, 'projects', dir, `${sessionId}.jsonl`);
      if (fs.existsSync(f)) return f;
    }
  } catch {
    // projects 가 없다
  }
  return direct;
}

/** 그 pid 가 claude 면 메타를 다시 읽는다 — `/clear`·`/resume` 으로 sessionId 가 바뀌면 따라 바뀐다 */
export function resolveFromPid(pid: number, configDir: string): ClaudeProcess | null {
  const meta = readMeta(configDir, pid);
  if (!meta?.sessionId || !meta.cwd) return null;
  const file = transcriptFile(configDir, meta.sessionId, meta.cwd);
  return { pid, configDir, sessionId: meta.sessionId, cwd: meta.cwd, file, status: meta.status };
}

/** 뿌리 pid 아래에서 가장 가까운 claude */
function findUnder(root: number, children: Map<number, number[]> | null): ClaudeProcess | null {
  const dirs = configDirs();
  for (const pid of descendantsOf(root, children)) {
    for (const dir of dirs) {
      const found = resolveFromPid(pid, dir);
      if (found) return found;
    }
  }
  return null;
}

/** 터미널 세션 하나의 claude — 없으면(셸만 남음·다른 에이전트) null */
export async function findClaude(termId: string): Promise<ClaudeProcess | null> {
  const root = await sessionRootPid(termId);
  if (!root) return null;
  return findUnder(root, await processTree());
}

/**
 * 여러 세션의 claude 를 한 번에 — `ps` 는 한 번만 돈다(세션 수만큼 돌리지 않는다).
 * @param roots 터미널 세션 id → pane 셸 pid
 */
export async function findClaudeMany(roots: Map<string, number>): Promise<Map<string, ClaudeProcess>> {
  const out = new Map<string, ClaudeProcess>();
  if (!roots.size) return out;
  const children = await processTree();
  for (const [termId, root] of roots) {
    const found = findUnder(root, children);
    if (found) out.set(termId, found);
  }
  return out;
}

export const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// ── 대화 파일 읽기 ──

/** 파일 크기 — 아직 없으면 0 (첫 메시지 전) */
export function fileSize(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

export function readRange(file: string, start: number, end: number): string {
  if (end <= start) return '';
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(end - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

/** 마지막 줄바꿈까지만 완성된 줄 — 나머지(쓰는 중인 줄)는 다음 주기로 */
export function completeLines(text: string): { lines: string[]; used: number } {
  const lastNl = text.lastIndexOf('\n');
  if (lastNl < 0) return { lines: [], used: 0 };
  const done = text.slice(0, lastNl + 1);
  return { lines: done.split('\n'), used: Buffer.byteLength(done, 'utf8') };
}
