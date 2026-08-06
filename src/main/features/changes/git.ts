// 변경사항 — 워킹트리의 git 상태·파일 diff 조회 + 커밋(전체 일괄) + push.
// "AI 작업 → 변경 확인 → 커밋 → 푸시" 루프의 확인·커밋·푸시 담당
// (커밋은 2026-08 터미널 개편에서 추가 — 우측 커밋 패널의 [커밋] 버튼).
import path from 'node:path';
import type {
  ChangedFile,
  ChangedFileKind,
  ChangesCommit,
  ChangesCommitResult,
  ChangesDiffFile,
  ChangesDiffResult,
  ChangesPushResult,
  ChangesStatus,
} from '../../../shared/types';
import { runGit as run, unquoteGitPath as unquote } from '../../lib/git';

const DIFF_MAX_BYTES = 512 * 1024; // diff 표시 상한 — 초과분은 잘라내고 truncated 표시
const STATUS_TIMEOUT_MS = 10_000;
const COMMIT_TIMEOUT_MS = 30_000;
const PUSH_TIMEOUT_MS = 60_000;
const UNPUSHED_MAX = 20;

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

/** 워킹트리 상태 — 브랜치·ahead/behind·변경 파일 목록(+numstat)·미푸시 커밋 */
export async function getChangesStatus(repoPath: string): Promise<ChangesStatus> {
  const inside = await run(['rev-parse', '--is-inside-work-tree'], repoPath, STATUS_TIMEOUT_MS);
  if (inside.code !== 0 || inside.stdout.trim() !== 'true') {
    return { ok: true, repo: false };
  }

  // --untracked-files=all — 기본값은 새 디렉터리를 통째('dir/')로 묶어 파일별 diff 가 안 된다
  const st = await run(
    ['status', '--porcelain', '--branch', '--untracked-files=all'],
    repoPath,
    STATUS_TIMEOUT_MS
  );
  if (st.code !== 0) {
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

  // 파일별 +/- 줄 수 — HEAD 대비(스테이징 포함). untracked·rename 은 안 잡혀도 무방
  const num = await run(['diff', 'HEAD', '--numstat'], repoPath, STATUS_TIMEOUT_MS);
  if (num.code === 0) {
    const counts = new Map<string, { a: number; d: number }>();
    for (const line of num.stdout.split('\n')) {
      const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
      if (!m || m[1] === '-') continue; // '-' 는 바이너리
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

  // 미푸시 커밋 — upstream 이 있을 때만 (없으면 새 브랜치, 푸시가 -u 로 만든다)
  if (result.upstream) {
    const log = await run(
      ['log', '--pretty=format:%h\t%s', '@{u}..HEAD', '-n', String(UNPUSHED_MAX)],
      repoPath,
      STATUS_TIMEOUT_MS
    );
    if (log.code === 0 && log.stdout.trim()) {
      result.unpushed = log.stdout
        .split('\n')
        .map((line): ChangesCommit | null => {
          const tab = line.indexOf('\t');
          return tab > 0 ? { hash: line.slice(0, tab), subject: line.slice(tab + 1) } : null;
        })
        .filter((c): c is ChangesCommit => !!c);
    }
  }

  return result;
}

/** 파일 하나의 unified diff — 추적 파일은 HEAD 대비, untracked 는 --no-index 로 전체 추가 */
export async function getChangesDiff(
  repoPath: string,
  file: ChangesDiffFile
): Promise<ChangesDiffResult> {
  // 경로 탈출 차단 — untracked 는 절대 경로로 diff 하므로 저장소 안인지 확인 필수
  const abs = path.resolve(repoPath, file.path);
  if (abs !== repoPath && !abs.startsWith(repoPath + path.sep)) {
    return { ok: false, error: '저장소 밖 경로입니다.' };
  }

  const args = file.untracked
    ? ['diff', '--no-color', '--no-index', '--', '/dev/null', abs]
    : [
        'diff',
        '--no-color',
        'HEAD',
        '--',
        file.path,
        ...(file.origPath ? [file.origPath] : []),
      ];
  const r = await run(args, repoPath, STATUS_TIMEOUT_MS);
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
  return { ok: true, diff, binary, truncated };
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

  const hash = await run(['rev-parse', '--short', 'HEAD'], repoPath, STATUS_TIMEOUT_MS);
  return { ok: true, hash: hash.code === 0 ? hash.stdout.trim() : undefined };
}

/** git push — upstream 없으면 -u origin HEAD 로 원격 브랜치를 만들며 푸시 */
export async function pushChanges(repoPath: string): Promise<ChangesPushResult> {
  const up = await run(
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
    repoPath,
    STATUS_TIMEOUT_MS
  );
  const args = up.code === 0 ? ['push'] : ['push', '-u', 'origin', 'HEAD'];
  const r = await run(args, repoPath, PUSH_TIMEOUT_MS);
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
