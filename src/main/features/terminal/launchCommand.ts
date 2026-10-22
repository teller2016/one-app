// 새 세션의 claude·femc 명령에 계정을 직접 싣는다 — 순수 규칙(launchCommand.test.ts). 비동기 준비(계정·스택 조회)는 launch.ts.
//
// 사용자의 `claude`·`femc` 는 **계정을 묻는 셸 함수**다(~/.zshrc `_claude_pick_account` — Personal/Team 을 read 로 묻고
// `CLAUDE_CONFIG_DIR` 을 정한다). 앱이 띄운 탭은 그 질문에 멈춰 있었다(Jira [작업]·루트 세션만 우회하고 있었다).
// 그래서 명령 **첫 낱말이 맨 `claude`·`femc`** 이면 함수가 하던 일을 앱이 대신 한다(Jira [작업] femcCommand 와 같은 우회):
//   claude → `CLAUDE_CONFIG_DIR=<계정> command claude --dangerously-skip-permissions …`  (함수가 늘 붙이는 플래그 그대로)
//   femc   → `CLAUDE_CONFIG_DIR=<계정> command femc run … [--stack <s>]`               (메뉴·스택 선택 창을 건너뛴다)
// 이미 `command …`·`CLAUDE_CONFIG_DIR=…` 로 시작하는 명령(Jira [작업]·루트·재부팅 복원)과 그 밖의 명령은 그대로 둔다.
import { shQuote } from '../../lib/util';

const SKIP_PERMISSIONS = '--dangerously-skip-permissions';

/** 계정을 물을 명령인가 — 첫 낱말이 맨 `claude`·`femc` 일 때만 */
export function accountAgentOf(command: string): 'claude' | 'femc' | null {
  const m = /^(claude|femc)(?=\s|$)/.exec(command.trim());
  return m ? (m[1] as 'claude' | 'femc') : null;
}

const hasToken = (rest: string, token: string) => new RegExp(`(^|\\s)${token}(\\s|=|$)`).test(rest);

/**
 * 계정을 실은 실행 명령 — 바꿀 명령이 아니면 그대로.
 * @param stack femc 에 넘길 스택(모르면 null — femc 가 묻는다). femc 를 `run` 으로 띄울 때만, 명령에 `--stack` 이 없을 때만 붙인다.
 */
export function withClaudeAccount(command: string, o: { configDir: string; stack?: string | null }): string {
  const raw = command.trim();
  const agent = accountAgentOf(raw);
  if (!agent) return command;
  const env = `CLAUDE_CONFIG_DIR=${shQuote(o.configDir)}`;
  const rest = raw.slice(agent.length).trim();
  if (agent === 'claude') {
    const flags = hasToken(rest, SKIP_PERMISSIONS) ? rest : [SKIP_PERMISSIONS, rest].filter(Boolean).join(' ');
    return `${env} command claude ${flags}`;
  }
  // femc — 인자가 없거나 플래그로 시작하면 메뉴(Run/Resume/Git…)로 빠진다(femc.mjs) → `run` 으로 바로 claude.
  // 하위 명령(doctor·setup …)·프롬프트로 시작하면 그대로 둔다
  const args = !rest || rest.startsWith('-') ? ['run', rest].filter(Boolean).join(' ') : rest;
  const isRun = /^run(\s|$)/.test(args);
  const stack = isRun && o.stack && !hasToken(args, '--stack') ? ` --stack ${shQuote(o.stack)}` : '';
  return `${env} command femc ${args}${stack}`;
}
