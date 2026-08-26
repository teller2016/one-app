// git 실행 공통 유틸 — changes(상태·diff·커밋·push)와 workspaces(워크트리)가 공용.
// headless 실행이라 인증 프롬프트가 뜰 수 없으므로 GIT_TERMINAL_PROMPT=0 으로
// 즉시 실패시키고, 타임아웃을 이중 안전망으로 둔다.
import { execFile } from 'node:child_process';

const GIT = '/usr/bin/git';

export type GitRunResult = { code: number; stdout: string; stderr: string };

/**
 * git 실행 — 실패해도 reject 하지 않고 exit code 로 준다 (호출부가 판정)
 *
 * `readOnly` 는 조회 전용 명령(status·diff·log…)에 붙인다. `GIT_OPTIONAL_LOCKS=0` 이 붙어
 * git 이 인덱스 갱신 같은 '선택적' 쓰기를 건너뛴다 — 변경사항 드로어가 5초마다 도는 탓에
 * 매 tick `.git/index` 를 다시 쓰고, 사용자의 커밋·에이전트의 git 작업과 index.lock 을
 * 두고 경합하던 것을 막는다. (커밋·push 가 잡는 필수 락에는 영향이 없는 변수지만,
 * 의도를 분명히 하려고 조회 경로에만 건다)
 */
export const runGit = (
  args: string[],
  cwd: string,
  timeoutMs: number,
  { readOnly = false }: { readOnly?: boolean } = {}
): Promise<GitRunResult> =>
  new Promise((resolve) => {
    execFile(
      GIT,
      // core.quotepath=false — 한글 경로가 옥탈 이스케이프("\354…")로 깨지지 않게
      ['-C', cwd, '-c', 'core.quotepath=false', ...args],
      {
        timeout: timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          ...(readOnly ? { GIT_OPTIONAL_LOCKS: '0' } : {}),
        },
      },
      (err, stdout, stderr) => {
        const code = err
          ? typeof (err as { code?: unknown }).code === 'number'
            ? ((err as { code: number }).code)
            : 1
          : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr).trim() });
      }
    );
  });

/** porcelain 경로 dequote — quotepath=false 여도 탭·따옴표 등은 여전히 "…" 로 감싼다 */
export function unquoteGitPath(p: string): string {
  if (!p.startsWith('"') || !p.endsWith('"')) return p;
  const inner = p.slice(1, -1);
  const bytes: number[] = [];
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c !== '\\') {
      bytes.push(...Buffer.from(c, 'utf8'));
      continue;
    }
    const n = inner[++i];
    if (n >= '0' && n <= '7') {
      bytes.push(parseInt(inner.slice(i, i + 3), 8));
      i += 2;
    } else if (n === 't') bytes.push(9);
    else if (n === 'n') bytes.push(10);
    else bytes.push(...Buffer.from(n ?? '', 'utf8'));
  }
  return Buffer.from(bytes).toString('utf8');
}
