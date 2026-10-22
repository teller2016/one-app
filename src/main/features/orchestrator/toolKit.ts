// 루트 세션 MCP 도구 공용 — 결과 포맷 · 탭 상태 해석 · 대상에서 빼는 세션. tools.ts·terminalTools.ts 가 함께 쓴다.
import type { TerminalSessionInfo } from '../../../shared/types';
import { dockShellId } from '../terminal';
import { getRootSessionId } from './store';

export type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

export const json = (value: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
});
export const fail = (message: string): ToolResult => ({ content: [{ type: 'text', text: message }], isError: true });

export const READ = { readOnlyHint: true, openWorldHint: false } as const;

export const NO_SESSION = '그런 세션이 없습니다 — list_sessions·list_terminals 로 id 를 다시 확인하세요.';

export type WorkerState = 'working' | 'waiting_input' | 'idle';

/**
 * 탭 상태 — claude 가 직접 남긴 상태(sessions/<pid>.json)가 있으면 그것, 없으면 원앱 휴리스틱.
 * claude 의 idle(입력란 앞)은 다음 지시를 받을 수 있는 자리라 waiting_input 이다(overview.ts stateOf 와 같은 해석).
 * 셸 탭은 휴리스틱상 입력 대기가 없어 working(출력이 이어지는 중)·idle 만 나온다.
 */
export function stateOf(s: Pick<TerminalSessionInfo, 'status' | 'working'>, claudeStatus?: string): WorkerState {
  if (claudeStatus === 'busy') return 'working';
  if (claudeStatus === 'idle' || claudeStatus === 'waiting') return 'waiting_input';
  if (s.working || s.status === 'busy') return 'working';
  return s.status === 'waiting' ? 'waiting_input' : 'idle';
}

/** 루트가 손대지 않는 세션 — 루트 자신·독 패널의 개인 셸 */
export const excludedIds = () => new Set([getRootSessionId(), dockShellId()].filter((v): v is string => !!v));
