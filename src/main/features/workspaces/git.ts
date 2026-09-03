// 워크스페이스의 git worktree 조회·생성·제거 + 브랜치 목록.
// 워크트리 목록의 진실은 항상 git(`worktree list --porcelain`)이다 — 자체 저장 없음.
// git 저장소가 아닌 **일반 폴더** 워크스페이스는 그 폴더 하나를 유일한 항목으로 합성한다
// (`plain: true`) — LNB 트리·세션 배치·알림 라벨·변경사항 대상 해석이 전부 이 목록만 보므로
// 여기서 한 번 처리하면 나머지는 손대지 않아도 된다.
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

/**
 * git 저장소가 아닌 일반 폴더인가 — 폴더는 있고 `.git` 이 없다.
 * `worktree list` 가 실패한 **뒤에만** 부른다(성공했으면 저장소다 — 하위 폴더도 성공한다).
 * `.git` 이 있는데 실패했으면 진짜 git 오류(손상·권한)라 일반 폴더로 위장하지 않는다.
 */
function isPlainDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory() && !fs.existsSync(path.join(p, '.git'));
  } catch {
    return false; // 폴더 자체가 없다 — 삭제된 워크스페이스
  }
}

/** `git worktree list --porcelain` 파싱 — 첫 항목이 주(main) 워크트리다 */
async function parseWorktrees(
  repoPath: string
): Promise<Omit<WorktreeInfo, 'dirty' | 'additions' | 'deletions'>[]> {
  const r = await run(['worktree', 'list', '--porcelain'], repoPath, LIST_TIMEOUT_MS);
  if (r.code !== 0) {
    // 일반 폴더 워크스페이스 — 폴더 자체가 유일한 항목 (경로는 저장된 값 그대로:
    // 렌더러가 세션 cwd·선택 폴백에 쓰는 repoPath 와 문자열이 같아야 매칭된다)
    if (isPlainDir(repoPath)) {
      return [{ path: repoPath, isMain: true, locked: false, missing: false, plain: true }];
    }
    throw new Error(r.stderr || 'git worktree list 실패');
  }

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

/**
 * 경량 목록 — 경로·브랜치·존재 여부만. **워크트리마다 도는 `git status`·`git diff` 를
 * 건너뛴다**(저장소당 `worktree list` 1회로 끝난다).
 *
 * LNB 는 10초마다 전 워크스페이스의 목록을 새로 받는데, ±변경량이 실제로 화면에 있는
 * 곳은 **펼친 워크스페이스의 워크트리 행뿐**이다. 접힌 워크스페이스는 세션 수 집계에
 * 경로만 필요하므로(cwd 대조) 이쪽을 쓴다 — 큰 저장소에서 `status --untracked-files=all`
 * 은 폴링으로 돌리기엔 무겁다.
 */
export async function listWorktreesBrief(repoPath: string): Promise<WorktreeInfo[]> {
  const bare = await parseWorktrees(repoPath);
  return bare.map((w) => ({
    ...w,
    missing: w.missing || !fs.existsSync(w.path),
    // 조회하지 않은 값 — 이 목록을 쓰는 화면(접힌 워크스페이스)에는 표시가 없다
    dirty: false,
    additions: 0,
    deletions: 0,
  }));
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
      // 일반 폴더는 status·diff 가 없다 — 실패할 git 을 두 번 띄우지 않는다
      if (w.plain) return { ...w, dirty: false, additions: 0, deletions: 0 };
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

  // --no-track: 베이스가 원격(origin/main 등)이면 git 이 그걸 추적 브랜치로 잡는다 —
  // 그러면 자기 이름의 원격 브랜치로 푸시해도 @{u}(origin/main) 대비 커밋이 남아
  // '푸시할 커밋'이 영영 사라지지 않는다 (추적은 첫 푸시의 -u origin HEAD 가 잡는다)
  const args = opts.createBranch
    ? ['worktree', 'add', '--no-track', target, '-b', branch, ...(opts.baseRef ? [opts.baseRef] : [])]
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
