// 워크스페이스의 git worktree 조회·생성·제거 + 브랜치 목록.
// 워크트리 목록의 진실은 항상 git(`worktree list --porcelain`)이다 — 자체 저장 없음.
import fs from 'node:fs';
import path from 'node:path';
import type {
  WorkspaceBranches,
  WorktreeActionResult,
  WorktreeInfo,
} from '../../../shared/types';
import { runGit as run } from '../../lib/git';

const LIST_TIMEOUT_MS = 10_000;
// worktree add 는 체크아웃을 포함해 큰 저장소에서 수십 초가 걸릴 수 있다
const ADD_TIMEOUT_MS = 120_000;
const REMOVE_TIMEOUT_MS = 30_000;

/** `git worktree list --porcelain` 파싱 — 첫 항목이 주(main) 워크트리다 */
async function parseWorktrees(
  repoPath: string
): Promise<Omit<WorktreeInfo, 'dirty' | 'additions' | 'deletions'>[]> {
  const r = await run(['worktree', 'list', '--porcelain'], repoPath, LIST_TIMEOUT_MS);
  if (r.code !== 0) throw new Error(r.stderr || 'git worktree list 실패');

  const out: Omit<WorktreeInfo, 'dirty' | 'additions' | 'deletions'>[] = [];
  let cur: (typeof out)[number] | null = null;
  for (const line of r.stdout.split('\n')) {
    if (line.startsWith('worktree ')) {
      cur = {
        path: line.slice('worktree '.length),
        isMain: out.length === 0,
        locked: false,
        missing: false,
      };
      out.push(cur);
    } else if (!cur) {
      continue;
    } else if (line.startsWith('HEAD ')) {
      cur.head = line.slice('HEAD '.length, 'HEAD '.length + 8);
    } else if (line.startsWith('branch ')) {
      cur.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    } else if (line.startsWith('locked')) {
      cur.locked = true;
    } else if (line.startsWith('prunable')) {
      cur.missing = true;
    }
  }
  return out;
}

/** 검증용 경량 조회 — 워크트리 경로 목록만 (changes 대상 해석이 쓴다) */
export async function worktreePaths(repoPath: string): Promise<string[]> {
  return (await parseWorktrees(repoPath)).map((w) => w.path);
}

/** 워크트리 목록 + 워크트리별 미커밋 변경량(LNB 의 +N −M 표시용) */
export async function listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
  const bare = await parseWorktrees(repoPath);
  return Promise.all(
    bare.map(async (w): Promise<WorktreeInfo> => {
      // prunable(디렉터리 삭제됨)이거나 실제로 폴더가 없으면 상태 조회가 실패한다
      if (w.missing || !fs.existsSync(w.path)) {
        return { ...w, missing: true, dirty: false, additions: 0, deletions: 0 };
      }
      const [st, num] = await Promise.all([
        run(['status', '--porcelain', '--untracked-files=all'], w.path, LIST_TIMEOUT_MS),
        run(['diff', 'HEAD', '--numstat'], w.path, LIST_TIMEOUT_MS),
      ]);
      let additions = 0;
      let deletions = 0;
      if (num.code === 0) {
        for (const line of num.stdout.split('\n')) {
          const m = /^(\d+)\t(\d+)\t/.exec(line); // '-' 는 바이너리 — 합계 제외
          if (!m) continue;
          additions += Number(m[1]);
          deletions += Number(m[2]);
        }
      }
      return {
        ...w,
        dirty: st.code === 0 && st.stdout.trim().length > 0,
        additions,
        deletions,
      };
    })
  );
}

/** 워크트리 생성 — createBranch 면 -b 로 새 브랜치, 아니면 기존 브랜치 체크아웃 */
export async function addWorktree(
  repoPath: string,
  opts: { parentDir: string; dirName: string; branch: string; createBranch: boolean; baseRef?: string }
): Promise<WorktreeActionResult> {
  const parentDir = opts.parentDir.trim();
  const dirName = opts.dirName.trim();
  const branch = opts.branch.trim();
  if (!parentDir || !dirName || !branch) {
    return { ok: false, error: '위치·폴더 이름·브랜치는 필수입니다.' };
  }
  // 폴더 이름에 경로 구분자가 들어오면 부모 폴더 밖으로 벗어날 수 있다
  if (dirName.includes('/') || dirName.includes('\\') || dirName === '.' || dirName === '..') {
    return { ok: false, error: '폴더 이름에 경로 구분자를 쓸 수 없습니다.' };
  }
  if (!path.isAbsolute(parentDir) || !fs.existsSync(parentDir)) {
    return { ok: false, error: '위치 폴더가 존재하지 않습니다.' };
  }
  const target = path.join(parentDir, dirName);
  if (fs.existsSync(target)) {
    return { ok: false, error: `이미 존재하는 폴더입니다: ${target}` };
  }

  const args = opts.createBranch
    ? ['worktree', 'add', target, '-b', branch, ...(opts.baseRef ? [opts.baseRef] : [])]
    : ['worktree', 'add', target, branch];
  const r = await run(args, repoPath, ADD_TIMEOUT_MS);
  if (r.code !== 0) {
    // "already checked out"·"already exists" 등 — git 의 사유를 그대로 보여준다
    return { ok: false, error: r.stderr || 'git worktree add 실패' };
  }
  return { ok: true, path: target };
}

/** 워크트리 제거 — 주 워크트리는 불가, 등록된 워크트리인지 호출부(ipc)가 검증한다 */
export async function removeWorktree(
  repoPath: string,
  worktreePath: string,
  force: boolean
): Promise<WorktreeActionResult> {
  const args = ['worktree', 'remove', ...(force ? ['--force'] : []), worktreePath];
  const r = await run(args, repoPath, REMOVE_TIMEOUT_MS);
  if (r.code !== 0) {
    return { ok: false, error: r.stderr || 'git worktree remove 실패' };
  }
  return { ok: true };
}

/** 브랜치 목록 — 워크트리 생성 모달의 베이스 브랜치 선택용 (로컬 + 원격) */
export async function listBranches(repoPath: string): Promise<WorkspaceBranches> {
  const [refs, cur] = await Promise.all([
    run(
      ['for-each-ref', 'refs/heads', 'refs/remotes', '--format=%(refname)'],
      repoPath,
      LIST_TIMEOUT_MS
    ),
    run(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath, LIST_TIMEOUT_MS),
  ]);
  if (refs.code !== 0) {
    return { ok: false, locals: [], remotes: [], error: refs.stderr || 'git for-each-ref 실패' };
  }
  const locals: string[] = [];
  const remotes: string[] = [];
  for (const line of refs.stdout.split('\n')) {
    if (!line) continue;
    if (line.startsWith('refs/heads/')) {
      locals.push(line.slice('refs/heads/'.length));
    } else if (line.startsWith('refs/remotes/')) {
      const name = line.slice('refs/remotes/'.length);
      // `origin/HEAD` 는 기본 브랜치를 가리키는 별칭 — 실제 브랜치가 아니다
      if (!name.endsWith('/HEAD')) remotes.push(name);
    }
  }
  return {
    ok: true,
    current: cur.code === 0 ? cur.stdout.trim() : undefined,
    locals,
    remotes,
  };
}
