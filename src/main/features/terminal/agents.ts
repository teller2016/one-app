// 에이전트 정의 + 설치 감지 — 세션 생성 시 자동 실행할 CLI 목록.
// 감지는 로그인 셸(zsh -lc)의 PATH 해석을 빌려 1회 캐시한다
// (nightwatch mission.ts 의 detectClaudeBin 패턴을 일반화 — 기능 간 참조 규칙상 복제).
import { execFile } from 'node:child_process';
import type { TerminalAgentId, TerminalAgentInfo } from '../../../shared/types';
import { TERMINAL_AGENT_NAMES } from '../../../shared/types';

type AgentDef = {
  id: TerminalAgentId;
  command: string | null; // null = 자동 실행 없음 (순수 셸)
};

const AGENTS: AgentDef[] = [
  { id: 'shell', command: null },
  { id: 'claude', command: 'claude' },
  { id: 'femc', command: 'femc' },
  { id: 'codex', command: 'codex' },
  { id: 'gemini', command: 'gemini' },
];

/**
 * 세션 생성 시 자동 실행할 명령 — 'shell' 은 null.
 *
 * ⚠️ `env -u TMUX -u TMUX_PANE` 로 감싸는 이유 — **Claude Code 는 `TMUX` 환경변수가 있으면
 * 트루컬러를 포기하고 256색 팔레트로 폴백한다**(2026-08-06 실측). 그러면 시작 로고가 브랜드
 * 코랄(`#d77757`) 대신 팔레트 174번(`#d78787`)으로 나와 **분홍빛으로 보인다** — 출력 바이트에
 * `38;2;…`(트루컬러) 가 하나도 없고 `38;5;174` 만 온다. `FORCE_COLOR=3` 으로는 바뀌지 않았고,
 * `TERM` 을 `xterm-256color` 로 바꿔도 그대로였다. **`TMUX` 를 지운 경우에만** 트루컬러가 나왔다.
 * 우리 tmux 는 사용자에게 보이지 않는 영속화 백엔드(prefix None·status off)라 에이전트가 그
 * 안에 있음을 알 이유가 없고, 지워도 tmux 세션·pane 동작에는 영향이 없다(실측).
 * 감지 경로(`detectAgents`)는 원시 `command` 를 그대로 쓰므로 이 래핑의 영향을 받지 않는다.
 */
export function agentCommand(id: TerminalAgentId): string | null {
  const command = AGENTS.find((a) => a.id === id)?.command;
  return command ? `env -u TMUX -u TMUX_PANE ${command}` : null;
}

let cached: Promise<TerminalAgentInfo[]> | null = null;

/** 에이전트 후보 목록 (설치 감지 포함) — 첫 호출에서 감지 후 캐시 */
export function listAgents(): Promise<TerminalAgentInfo[]> {
  if (!cached) cached = detectAgents();
  return cached;
}

function detectAgents(): Promise<TerminalAgentInfo[]> {
  const commands = AGENTS.flatMap((a) => (a.command ? [a.command] : []));
  // 감지 전체를 zsh 1회 호출로 — 명령마다 로그인 셸을 띄우면 rc 로딩이 배로 걸린다
  const script = commands
    .map((c) => `print -r -- "${c}=$(whence -p ${c})"`)
    .join('; ');
  return new Promise((resolve) => {
    execFile('/bin/zsh', ['-lc', script], { timeout: 10_000 }, (_err, stdout) => {
      const installed = new Set<string>();
      for (const line of String(stdout).split('\n')) {
        const eq = line.indexOf('=');
        if (eq > 0 && line.slice(eq + 1).trim()) installed.add(line.slice(0, eq));
      }
      resolve(
        AGENTS.map((a) => ({
          id: a.id,
          name: TERMINAL_AGENT_NAMES[a.id],
          installed: !a.command || installed.has(a.command),
        }))
      );
    });
  });
}
