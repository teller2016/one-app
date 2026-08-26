// 변경사항 — 워킹트리의 git 상태·파일 diff 조회 + 커밋(전체 일괄) + push.
// "AI 작업 → 변경 확인 → 커밋 → 푸시" 루프의 확인·커밋·푸시 담당
// (커밋은 2026-08 터미널 개편에서 추가 — 우측 커밋 패널의 [커밋] 버튼).
import crypto from 'node:crypto';
import path from 'node:path';
import type {
  ChangedFile,
  ChangedFileKind,
  ChangesCommit,
  ChangesCommitFilesResult,
  ChangesCommitResult,
  ChangesDiffFile,
  ChangesDiffResult,
  ChangesDiffScope,
  ChangesLogEntry,
  ChangesLogResult,
  ChangesMode,
  ChangesPushResult,
  ChangesStatus,
} from '../../../shared/types';
import { runGit as run, unquoteGitPath as unquote } from '../../lib/git';

const DIFF_MAX_BYTES = 512 * 1024; // diff 표시 상한 — 초과분은 잘라내고 truncated 표시
const STATUS_TIMEOUT_MS = 10_000;
const COMMIT_TIMEOUT_MS = 30_000;
const PUSH_TIMEOUT_MS = 60_000;
const UNPUSHED_MAX = 20;
const LOG_MAX = 30; // 커밋 목록 표시 개수

// 드로어가 5초마다 조회하는 화면이라 tick 당 git 프로세스 수가 그대로 비용이 된다.
// 거의 변하지 않는 값(저장소 여부·베이스 브랜치)은 캐시하고, 같은 tick 안에서 두 번
// 뜨던 명령(@{u}..HEAD)은 아주 짧은 창으로 공유한다.
const WORKTREE_TTL_MS = 5 * 60_000; // 경로가 워크트리인 사실은 사실상 안 변한다
const BASE_TTL_MS = 60_000; // main/master 브랜치 존재 여부
const UNPUSHED_TTL_MS = 2_000; // status·log 공유 창 (폴링 주기보다 짧게)

/** 조회 전용 실행 — GIT_OPTIONAL_LOCKS=0 이 붙는다 (이유는 `lib/git.ts` 주석) */
const read = (args: string[], repoPath: string, timeoutMs = STATUS_TIMEOUT_MS) =>
  run(args, repoPath, timeoutMs, { readOnly: true });

const workTreeCache = new Map<string, number>(); // repoPath → 마지막 확인 시각
const baseCache = new Map<string, { at: number; base: string | null }>();
const unpushedCache = new Map<string, { at: number; p: Promise<ChangesCommit[] | null> }>();

/** 커밋·push 직후 — 곧바로 오는 재조회가 캐시된 옛 미푸시 목록을 보지 않게 */
function invalidateRepo(repoPath: string): void {
  unpushedCache.delete(repoPath);
  baseCache.delete(repoPath);
}

/**
 * 저장소(워크트리) 여부. 참일 때만 캐시하고 status 가 실패하면 버린다
 * — 워크트리가 지워지거나 옮겨간 경우를 다음 조회가 다시 판정한다.
 */
async function isWorkTree(repoPath: string): Promise<boolean> {
  const at = workTreeCache.get(repoPath);
  if (at && Date.now() - at < WORKTREE_TTL_MS) return true;
  const r = await read(['rev-parse', '--is-inside-work-tree'], repoPath);
  const ok = r.code === 0 && r.stdout.trim() === 'true';
  if (ok) workTreeCache.set(repoPath, Date.now());
  else workTreeCache.delete(repoPath);
  return ok;
}

/**
 * 미푸시 커밋(`@{u}..HEAD`) — 상태 조회와 커밋 목록이 같은 tick 에 함께 부르는 값이라
 * 진행 중인 Promise 를 공유한다. null = upstream 없음(새 브랜치 — 전부 미푸시로 본다).
 */
function unpushedCommits(repoPath: string): Promise<ChangesCommit[] | null> {
  const hit = unpushedCache.get(repoPath);
  if (hit && Date.now() - hit.at < UNPUSHED_TTL_MS) return hit.p;
  const p = read(
    ['log', '--no-color', '--pretty=format:%h\t%s', '@{u}..HEAD', '-n', String(LOG_MAX)],
    repoPath
  ).then((r) =>
    r.code !== 0
      ? null
      : r.stdout
          .split('\n')
          .map((line): ChangesCommit | null => {
            const tab = line.indexOf('\t');
            return tab > 0
              ? { hash: line.slice(0, tab), subject: line.slice(tab + 1) }
              : null;
          })
          .filter((c): c is ChangesCommit => !!c)
  );
  unpushedCache.set(repoPath, { at: Date.now(), p });
  return p;
}

/** porcelain v1 의 XY 코드 → 표시용 종류 (스테이징 여부는 구분하지 않는다) */
function kindOf(x: string, y: string): ChangedFileKind {
  if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D'))
    return 'conflict';
  if (x === 'R' || y === 'R') return 'renamed';
  if (x === 'A' || y === 'A' || x === '?') return 'added';
  if (x === 'D' || y === 'D') return 'deleted';
  return 'modified';
}

/** `## main...origin/main [ahead 1, behind 2]` 형태의 브랜치 헤더 파싱 */
function parseBranchHeader(line: string): {
  branch?: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
} {
  const body = line.slice(3); // '## ' 제거
  if (body.startsWith('No commits yet')) return { branch: body.replace('No commits yet on ', '') };
  const m = /^(.+?)(?:\.\.\.(\S+))?(?: \[(.+)\])?$/.exec(body);
  if (!m) return {};
  const out: ReturnType<typeof parseBranchHeader> = { branch: m[1], upstream: m[2] };
  if (m[3]) {
    out.ahead = Number(/ahead (\d+)/.exec(m[3])?.[1] ?? 0);
    out.behind = Number(/behind (\d+)/.exec(m[3])?.[1] ?? 0);
  } else if (m[2]) {
    out.ahead = 0;
    out.behind = 0;
  }
  return out;
}

/** name-status 의 상태 글자 → 표시용 종류 (R100 처럼 유사도 점수가 붙는다) */
function kindOfLetter(s: string): ChangedFileKind {
  const c = s[0];
  if (c === 'A' || c === 'C') return 'added'; // copy 는 새 파일이 생긴 것과 같다
  if (c === 'D') return 'deleted';
  if (c === 'R') return 'renamed';
  if (c === 'U') return 'conflict';
  return 'modified';
}

/**
 * main/master 중 실제로 있는 로컬 브랜치 (둘 다 없으면 null).
 * ⚠️ `rev-parse --verify` 는 브랜치 하나씩만 볼 수 있어 최대 2회 스폰이었다 —
 * `for-each-ref` 는 한 번에 본다. 브랜치 생성·삭제가 잦지 않아 짧게 캐시한다.
 */
async function existingBaseBranch(repoPath: string): Promise<string | null> {
  const hit = baseCache.get(repoPath);
  if (hit && Date.now() - hit.at < BASE_TTL_MS) return hit.base;
  const r = await read(
    ['for-each-ref', '--format=%(refname:short)', 'refs/heads/main', 'refs/heads/master'],
    repoPath
  );
  const names = r.code === 0 ? r.stdout.split('\n').map((l) => l.trim()) : [];
  const base = names.includes('main') ? 'main' : names.includes('master') ? 'master' : null;
  baseCache.set(repoPath, { at: Date.now(), base });
  return base;
}

/**
 * 비교 베이스 브랜치 — 현재 브랜치가 그것이면 null
 * (자기 자신과의 비교는 의미가 없다).
 */
async function resolveBaseBranch(
  repoPath: string,
  current?: string
): Promise<string | null> {
  const base = await existingBaseBranch(repoPath);
  return base && base !== current ? base : null;
}

/** 베이스 브랜치와의 분기점(merge-base) 해시 — 실패 시 null */
async function mergeBaseOf(repoPath: string, base: string): Promise<string | null> {
  const r = await read(['merge-base', base, 'HEAD'], repoPath);
  return r.code === 0 ? r.stdout.trim() : null;
}

/**
 * 분기점 대비 변경 파일 목록 — 커밋된 것 + 워킹트리 변경을 한 번에.
 * (untracked 는 diff 에 안 잡히므로 호출부가 porcelain 결과에서 합친다)
 */
async function branchFiles(
  repoPath: string,
  mergeBase: string
): Promise<ChangedFile[] | null> {
  const ns = await read(['diff', '--no-color', '--name-status', '-M', mergeBase], repoPath);
  if (ns.code !== 0) return null;
  const files: ChangedFile[] = [];
  for (const line of ns.stdout.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const st = parts[0];
    const isRename = st[0] === 'R' || st[0] === 'C';
    files.push({
      path: unquote(isRename ? (parts[2] ?? '') : (parts[1] ?? '')),
      origPath: isRename ? unquote(parts[1] ?? '') : undefined,
      kind: kindOfLetter(st),
      untracked: false,
    });
  }
  return files;
}

/** 워킹트리 상태 — 브랜치·ahead/behind·변경 파일 목록(+numstat)·미푸시 커밋 */
export async function getChangesStatus(
  repoPath: string,
  mode: ChangesMode = 'work'
): Promise<ChangesStatus> {
  if (!(await isWorkTree(repoPath))) return { ok: true, repo: false };

  const branchMode = mode === 'branch';
  // status·베이스 브랜치·numstat 은 서로 독립이다 — 순서대로 기다릴 이유가 없다.
  // (branch 모드의 numstat 은 분기점을 알아야 해서 아래에서 따로 돈다)
  const [st, baseBranch, numWork] = await Promise.all([
    // --untracked-files=all — 기본값은 새 디렉터리를 통째('dir/')로 묶어 파일별 diff 가 안 된다
    read(['status', '--porcelain', '--branch', '--untracked-files=all'], repoPath),
    existingBaseBranch(repoPath),
    branchMode ? Promise.resolve(null) : read(['diff', 'HEAD', '--numstat'], repoPath),
  ]);
  if (st.code !== 0) {
    // 워크트리가 사라졌을 수도 있다 — 다음 조회가 다시 판정하도록 캐시를 버린다
    workTreeCache.delete(repoPath);
    return { ok: false, repo: true, error: st.stderr || 'git status 실패' };
  }

  const result: ChangesStatus = { ok: true, repo: true, files: [] };
  const files = result.files as ChangedFile[];
  for (const line of st.stdout.split('\n')) {
    if (!line) continue;
    if (line.startsWith('## ')) {
      Object.assign(result, parseBranchHeader(line));
      continue;
    }
    const x = line[0];
    const y = line[1];
    let rest = line.slice(3);
    let origPath: string | undefined;
    // rename/copy 는 `old -> new` — 표시·diff 는 새 경로 기준
    const arrow = rest.indexOf(' -> ');
    if (arrow >= 0 && (x === 'R' || x === 'C' || y === 'R' || y === 'C')) {
      origPath = unquote(rest.slice(0, arrow));
      rest = rest.slice(arrow + 4);
    }
    files.push({
      path: unquote(rest),
      origPath,
      kind: kindOf(x, y),
      untracked: x === '?',
    });
  }

  // 베이스 브랜치(main/master) — branch 모드 전환 가능 여부를 UI 가 이 값으로 판단한다
  // (현재 브랜치가 곧 베이스면 비교 대상이 없다)
  if (baseBranch && baseBranch !== result.branch) result.baseBranch = baseBranch;

  // branch 모드 — 파일 목록을 분기점(merge-base) 대비로 교체.
  // untracked 는 diff 에 안 잡히므로 porcelain 에서 찾은 것을 뒤에 보탠다.
  let num = numWork;
  if (branchMode) {
    if (!result.baseBranch) {
      return {
        ok: false,
        repo: true,
        error: '베이스 브랜치(main/master)가 없거나 지금 그 브랜치에 있습니다.',
      };
    }
    const mb = await mergeBaseOf(repoPath, result.baseBranch);
    if (!mb) {
      return {
        ok: false,
        repo: true,
        error: `${result.baseBranch} 와의 분기점을 찾을 수 없습니다.`,
      };
    }
    // 파일 목록과 +/- 줄 수는 같은 기준(분기점)을 볼 뿐 서로 독립이다
    const [bf, numBranch] = await Promise.all([
      branchFiles(repoPath, mb),
      read(['diff', mb, '--numstat'], repoPath),
    ]);
    if (!bf) return { ok: false, repo: true, error: 'git diff 실패' };
    result.files = [...bf, ...files.filter((f) => f.untracked)];
    num = numBranch;
  }
  const outFiles = result.files as ChangedFile[];

  // 파일별 +/- 줄 수 — work 는 HEAD, branch 는 분기점 대비. untracked·rename 은 안 잡혀도 무방
  if (num && num.code === 0) {
    const counts = new Map<string, { a: number; d: number }>();
    for (const line of num.stdout.split('\n')) {
      const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
      if (!m || m[1] === '-') continue; // '-' 는 바이너리
      counts.set(unquote(m[3]), { a: Number(m[1]), d: Number(m[2]) });
    }
    for (const f of outFiles) {
      const c = counts.get(f.path);
      if (c) {
        f.additions = c.a;
        f.deletions = c.d;
      }
    }
  }

  // 미푸시 커밋 — upstream 이 있을 때만 (없으면 새 브랜치, 푸시가 -u 로 만든다).
  // 목록 조회(getCommitLog)와 같은 명령을 공유한다.
  if (result.upstream) {
    const commits = await unpushedCommits(repoPath);
    if (commits?.length) result.unpushed = commits.slice(0, UNPUSHED_MAX);
  }

  return result;
}

/**
 * 파일 하나의 unified diff.
 * 기본: 추적 파일은 HEAD 대비, untracked 는 --no-index 로 전체 추가.
 * scope.mode='branch': 분기점(merge-base) 대비 · scope.commit: 그 커밋 한 건의 변경.
 */
export async function getChangesDiff(
  repoPath: string,
  file: ChangesDiffFile,
  scope?: ChangesDiffScope,
  /**
   * 호출부가 이미 갖고 있는 diff 의 해시. 내용이 그대로면 본문 없이 `unchanged` 만 돌려준다
   * — 5초 폴링이 바뀌지도 않은 512KB 를 매번 실어 나르던 것을 없앤다.
   */
  knownHash?: string
): Promise<ChangesDiffResult> {
  // 경로 탈출 차단 — untracked 는 절대 경로로 diff 하므로 저장소 안인지 확인 필수
  const abs = path.resolve(repoPath, file.path);
  if (abs !== repoPath && !abs.startsWith(repoPath + path.sep)) {
    return { ok: false, error: '저장소 밖 경로입니다.' };
  }

  // full: 전체 파일을 context 로 포함 — 분할 뷰가 '변경 전 파일 | 변경 후 파일'이 된다.
  // (untracked 는 --no-index /dev/null 이라 원래 전체가 온다)
  const ctx = scope?.full ? ['-U1000000'] : [];
  let args: string[];
  if (scope?.commit) {
    // 커밋 한 건의 변경 — --format= 으로 커밋 헤더를 억제해 diff 만 받는다
    args = [
      'show',
      '--no-color',
      '--format=',
      '-M',
      ...ctx,
      scope.commit,
      '--',
      file.path,
      ...(file.origPath ? [file.origPath] : []),
    ];
  } else if (file.untracked) {
    args = ['diff', '--no-color', '--no-index', '--', '/dev/null', abs];
  } else {
    let ref = 'HEAD';
    if (scope?.mode === 'branch') {
      const base = await resolveBaseBranch(repoPath);
      const mb = base ? await mergeBaseOf(repoPath, base) : null;
      if (!mb) return { ok: false, error: '베이스 브랜치 분기점을 찾을 수 없습니다.' };
      ref = mb;
    }
    args = [
      'diff',
      '--no-color',
      ...ctx,
      ref,
      '--',
      file.path,
      ...(file.origPath ? [file.origPath] : []),
    ];
  }
  const r = await read(args, repoPath);
  // --no-index 는 두 파일이 다르면 exit 1 — 실패가 아니다
  if (r.code !== 0 && !(file.untracked && r.code === 1)) {
    return { ok: false, error: r.stderr || 'git diff 실패' };
  }

  let diff = r.stdout;
  const binary = /^Binary files /m.test(diff);
  let truncated = false;
  if (Buffer.byteLength(diff, 'utf8') > DIFF_MAX_BYTES) {
    diff = Buffer.from(diff, 'utf8').subarray(0, DIFF_MAX_BYTES).toString('utf8');
    truncated = true;
  }

  // 잘라낸 뒤의 최종 본문으로 해시한다 — 화면에 실제로 가는 내용과 1:1 이어야 한다
  const hash = crypto.createHash('sha1').update(diff).digest('hex');
  if (knownHash && knownHash === hash) {
    return { ok: true, hash, unchanged: true, binary, truncated };
  }
  return { ok: true, diff, binary, truncated, hash };
}

/** 최근 커밋 목록 — 미푸시 여부 포함 (커밋 섹션용) */
export async function getCommitLog(repoPath: string): Promise<ChangesLogResult> {
  // %p = 축약 부모 해시들(공백 구분) — 2개 이상이면 머지 커밋.
  // 미푸시 집합(@{u}..HEAD)은 상태 조회와 공유한다 — 드로어가 둘을 같은 tick 에 부른다.
  const [r, up] = await Promise.all([
    read(
      ['log', '--no-color', '--pretty=format:%h\t%ct\t%p\t%s', '-n', String(LOG_MAX)],
      repoPath
    ),
    unpushedCommits(repoPath),
  ]);
  // 커밋이 하나도 없는 저장소는 log 자체가 실패한다 — 빈 목록으로
  if (r.code !== 0) return { ok: true, commits: [] };

  // upstream 이 없으면(새 브랜치) 전부 미푸시
  const noUpstream = up === null;
  const unpushed = new Set((up ?? []).map((c) => c.hash));

  const commits = r.stdout
    .split('\n')
    .filter(Boolean)
    .map((line): ChangesLogEntry | null => {
      const [hash, ct, parents, ...rest] = line.split('\t');
      if (!hash || !ct) return null;
      return {
        hash,
        subject: rest.join('\t'),
        date: Number(ct),
        unpushed: noUpstream || unpushed.has(hash),
        isMerge: (parents ?? '').trim().split(' ').filter(Boolean).length > 1,
      };
    })
    .filter((c): c is ChangesLogEntry => !!c);
  return { ok: true, commits };
}

/** 커밋 한 건의 변경 파일 목록 (+/- 줄 수 포함) — 커밋 섹션에서 클릭했을 때 */
export async function getCommitFiles(
  repoPath: string,
  hash: string
): Promise<ChangesCommitFilesResult> {
  // 목록과 +/- 줄 수는 서로 독립 — 함께 돌린다
  const [ns, num] = await Promise.all([
    read(['show', '--no-color', '--format=', '--name-status', '-M', hash], repoPath),
    read(['show', '--no-color', '--format=', '--numstat', hash], repoPath),
  ]);
  if (ns.code !== 0) return { ok: false, error: ns.stderr || 'git show 실패' };

  const files: ChangedFile[] = [];
  for (const line of ns.stdout.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const st = parts[0];
    const isRename = st[0] === 'R' || st[0] === 'C';
    files.push({
      path: unquote(isRename ? (parts[2] ?? '') : (parts[1] ?? '')),
      origPath: isRename ? unquote(parts[1] ?? '') : undefined,
      kind: kindOfLetter(st),
      untracked: false,
    });
  }

  // +/- 줄 수 — rename 은 경로 표기가 달라 안 잡혀도 무방 (work 모드와 같은 원칙)
  if (num.code === 0) {
    const counts = new Map<string, { a: number; d: number }>();
    for (const line of num.stdout.split('\n')) {
      const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
      if (!m || m[1] === '-') continue;
      counts.set(unquote(m[3]), { a: Number(m[1]), d: Number(m[2]) });
    }
    for (const f of files) {
      const c = counts.get(f.path);
      if (c) {
        f.additions = c.a;
        f.deletions = c.d;
      }
    }
  }
  return { ok: true, files };
}

/** 전체 일괄 커밋 — git add -A 후 commit. 변경이 없으면 실패로 알린다 */
export async function commitChanges(
  repoPath: string,
  message: string
): Promise<ChangesCommitResult> {
  const msg = message.trim();
  if (!msg) return { ok: false, error: '커밋 메시지를 입력하세요.' };

  const add = await run(['add', '-A'], repoPath, COMMIT_TIMEOUT_MS);
  if (add.code !== 0) {
    return { ok: false, error: add.stderr || 'git add 실패' };
  }

  // -m 을 여러 번 주면 문단으로 나뉜다 — 첫 줄/본문을 살리려면 통째로 한 번에
  const commit = await run(['commit', '-m', msg], repoPath, COMMIT_TIMEOUT_MS);
  if (commit.code !== 0) {
    // "nothing to commit" 도 여기로 온다 — stderr 가 비면 stdout 에 사유가 있다
    return {
      ok: false,
      error: commit.stderr || commit.stdout.trim().split('\n').pop() || 'git commit 실패',
    };
  }

  invalidateRepo(repoPath); // 곧바로 오는 재조회가 커밋 전의 미푸시 목록을 보지 않게
  const hash = await read(['rev-parse', '--short', 'HEAD'], repoPath);
  return { ok: true, hash: hash.code === 0 ? hash.stdout.trim() : undefined };
}

/** git push — upstream 이 없거나 다른 이름의 브랜치를 추적하면 -u origin HEAD 로 바로잡으며 푸시 */
export async function pushChanges(repoPath: string): Promise<ChangesPushResult> {
  const [head, up] = await Promise.all([
    read(['rev-parse', '--abbrev-ref', 'HEAD'], repoPath),
    read(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], repoPath),
  ]);
  const branch = head.code === 0 ? head.stdout.trim() : '';
  const upstream = up.code === 0 ? up.stdout.trim() : '';
  // upstream 이 다른 이름을 가리키면(--no-track 이전에 만든 워크트리 브랜치가 origin/main 을
  // 추적) 그냥 push 는 @{u}..HEAD 가 안 비어 '푸시할 커밋'이 영영 남는다 — -u 로 바로잡는다
  const tracksSameName =
    !!upstream && !!branch && upstream.split('/').slice(1).join('/') === branch;
  const args = tracksSameName ? ['push'] : ['push', '-u', 'origin', 'HEAD'];
  const r = await run(args, repoPath, PUSH_TIMEOUT_MS);
  invalidateRepo(repoPath); // 전송으로 미푸시 목록이 비었다 — 캐시를 남기면 잠깐 옛 값이 보인다
  // git push 는 성공해도 진행 로그를 stderr 로 쓴다 — 성공·실패 공통으로 합쳐 담는다
  const output = [r.stdout.trim(), r.stderr].filter(Boolean).join('\n');
  if (r.code !== 0) {
    return {
      ok: false,
      output,
      error: r.stderr.split('\n').slice(-3).join('\n') || 'git push 실패',
    };
  }
  return { ok: true, output };
}
