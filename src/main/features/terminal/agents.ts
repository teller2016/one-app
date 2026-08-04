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

/** 세션 생성 시 자동 실행할 명령 — 'shell' 은 null */
export function agentCommand(id: TerminalAgentId): string | null {
  return AGENTS.find((a) => a.id === id)?.command ?? null;
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
