// 재부팅 복원의 순수 규칙 — claude 실행 인자에서 실행기(claude·femc)를 가리고, 다시 띄울 명령을 조립한다.
// 기록은 resume.ts, 복원(다시 띄우기)은 pty.ts restoreSessions 가 한다.
// ⚠️ 테스트(resumeCommand.test.ts)가 node-pty 없이 돌도록 pty·claudeFiles 를 import 하지 않는다.
import { shQuote } from '../../lib/util';
import type { PersistedResume } from './sessions-store';

// femc 는 claude 에 플러그인·설정을 `~/.femc/generations/<세대>/stacks/<스택>/…` 경로로 넘긴다(2026-10-06 실측:
// `claude --agent metacommerce-orchestrator --plugin-dir ~/.femc/generations/g-…/stacks/vue/plugin --settings …`).
// 프롬프트 본문에 같은 글자가 섞여도 오판하지 않게 **플래그 값 자리**만 본다.
const FEMC_FLAG_RE = /--(?:plugin-dir|settings)[ =]\S*\/\.femc\//;
const FEMC_STACK_RE = /\/\.femc\/generations\/[^/\s]+\/stacks\/([^/\s]+)\//;
const SKIP_PERMISSIONS_RE = /(?:^|\s)--dangerously-skip-permissions(?:\s|$)/;
// 도구를 막는 플래그 — resumeCommand 는 이걸 되살리지 않으므로 그대로 이어 띄우면 권한이 넓어진다
const RESTRICTED_TOOLS_RE = /(?:^|\s)--(?:disallowedTools|disallowed-tools)(?:[\s=]|$)/;

/**
 * 재부팅 뒤 되살려도 되는 claude 인가 — **도구를 막고 띄운 claude**(`--disallowedTools`)는 아니다.
 * 다시 띄우는 명령(resumeCommand)은 계정·권한 생략만 잇고 그 제한은 잇지 못해, 막아 둔 편집·셸이 풀린 채
 * 살아난다. 지휘만 하는 루트 세션(features/orchestrator)이 그렇게 뜬다 — 루트는 직접 다시 연다.
 */
export const isRevivable = (args: string): boolean => !RESTRICTED_TOOLS_RE.test(args);

/**
 * 실행 중인 claude 의 인자(`ps -o args=`)로 무엇이 띄웠는지 가린다.
 * `ps` 는 argv 를 공백으로 이어 붙여 주므로 인자를 복원하지 않고, 경로·플래그가 있는지만 본다.
 */
export function detectLauncher(args: string): Pick<PersistedResume, 'launcher' | 'stack' | 'skipPermissions'> {
  if (FEMC_FLAG_RE.test(args)) {
    const stack = FEMC_STACK_RE.exec(args)?.[1];
    return stack ? { launcher: 'femc', stack } : { launcher: 'femc' };
  }
  return { launcher: 'claude', skipPermissions: SKIP_PERMISSIONS_RE.test(args) };
}

/**
 * 재부팅 뒤 다시 띄울 명령 — pty.ts 가 `launchShellCommand` 로 감싸 tmux new-session 에 넘긴다.
 *
 * - 사용자의 `claude`·`femc` 는 **계정을 묻는 셸 함수**다(~/.zshrc). `command` 로 실행 파일을 직접 부르고
 *   그 함수가 하던 일(CLAUDE_CONFIG_DIR 지정)을 여기서 한다 — Jira [작업] 실행 명령(jira/work.ts)과 같은 우회.
 * - `--resume <id>` 는 선택기 없이 그 대화를 바로 연다(id 없는 `--resume` 만 선택기). 대화 파일이 없으면
 *   (메시지를 보낸 적 없음) 이어갈 것이 없어 resume 없이 새로 띄운다.
 * - femc 는 `femc run` 으로 — `femc --resume` 은 첫 인자가 플래그라 **메뉴로 빠진다**. `run` 은 나머지 인자를
 *   메뉴 없이 claude 로 넘기고 **지금 설치된 세대**의 플러그인으로 다시 조립한다(옛 세대 경로를 재생하지 않는다).
 *   `--dangerously-skip-permissions` 는 femc 가 스스로 붙인다.
 * - claude 를 띄운 위치가 세션 위치와 다르면 그리로 옮겨서 — 재개는 대화를 만든 폴더에서 해야 찾는다.
 */
export function resumeCommand(
  r: PersistedResume,
  opts: { sessionCwd: string; hasTranscript: boolean }
): string {
  const parts = [`CLAUDE_CONFIG_DIR=${shQuote(r.configDir)}`];
  if (r.launcher === 'femc') {
    parts.push('FEMC_SKIP_UPDATE_CHECK=1', 'command femc run');
    if (r.stack) parts.push('--stack', shQuote(r.stack));
  } else {
    parts.push('command claude');
    if (r.skipPermissions) parts.push('--dangerously-skip-permissions');
  }
  if (opts.hasTranscript) parts.push('--resume', shQuote(r.sessionId));
  const command = parts.join(' ');
  return r.cwd === opts.sessionCwd ? command : `cd ${shQuote(r.cwd)} && ${command}`;
}
