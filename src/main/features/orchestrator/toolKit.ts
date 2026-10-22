// 루트 세션 MCP 도구 공용 — 결과 포맷 · 탭 상태 해석 · 대상에서 빼는 세션 · 회사 저장소 판정. 도구 파일들이 함께 쓴다.
import path from 'node:path';
import type { TerminalSessionInfo, TerminalWorkspace } from '../../../shared/types';
import { registeredFemcStack } from '../../lib/femc';
import { listProjects } from '../projects/store';
import { completeLines, dockShellId, fileSize, readRange } from '../terminal';
import { getRootSessionId } from './store';

export type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

export const json = (value: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
});
export const fail = (message: string): ToolResult => ({ content: [{ type: 'text', text: message }], isError: true });

export const READ = { readOnlyHint: true, openWorldHint: false } as const;

/** 도구 결과의 시각 — 없으면 null */
export const iso = (ms?: number) => (ms ? new Date(ms).toISOString() : null);

/**
 * 대화 기록 꼬리의 완성된 줄 — 꼬리 첫 조각(줄 중간)은 버린다. whole = 파일 처음부터 읽었다.
 * 파일이 없거나 못 읽으면 던진다(호출부가 '못 읽음'으로 다룬다).
 */
export function readTailLines(file: string, bytes: number): { lines: string[]; whole: boolean } {
  const size = fileSize(file);
  const start = Math.max(0, size - bytes);
  let text = readRange(file, start, size);
  if (start > 0) text = text.slice(text.indexOf('\n') + 1);
  return { lines: completeLines(text).lines, whole: start === 0 };
}

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

export const samePath = (a: string, b: string) => path.resolve(a) === path.resolve(b);

/** 그 워크스페이스에 걸린 Jira 프로젝트 키 */
export function jiraKeysOf(ws: TerminalWorkspace): string[] {
  return listProjects()
    .filter((p) => p.jiraProjectKey && samePath(p.localPath, ws.repoPath))
    .map((p) => p.jiraProjectKey);
}

/** 회사(FEMC) 저장소인가 — femc 에 등록돼 있거나 Jira 키가 걸려 있다. 새 세션은 여기서만 연다(기획 결정) */
export const isCompanyWorkspace = (ws: TerminalWorkspace) => !!registeredFemcStack(ws.repoPath) || jiraKeysOf(ws).length > 0;

/**
 * 탭 순서 — 워크트리 경로 → 사용자가 정한 세션 id 순서. 정본은 렌더러(localStorage `terminal:tabOrder`)라 바뀔 때마다
 * `orchestrator:tab-orders` 로 받아 둔다(메모리만 — 앱을 켜면 렌더러가 처음 그릴 때 다시 보낸다).
 */
let tabOrders: Record<string, string[]> = {};

export function setTabOrders(next: unknown): void {
  if (!next || typeof next !== 'object') return;
  const out: Record<string, string[]> = {};
  for (const [cwd, ids] of Object.entries(next as Record<string, unknown>)) {
    if (Array.isArray(ids)) out[cwd] = ids.filter((x): x is string => typeof x === 'string');
  }
  tabOrders = out;
}

/**
 * 그 세션이 자기 워크트리 탭바의 몇 번째인가(1부터) — "두 번째 세션" 같은 말을 풀 때. 셸 탭도 센다(사용자 눈에 보이는 순서).
 * 렌더러 orderTabSessions 와 같은 규칙: 정한 순서에 있는 것이 앞, 없는 것(새로 연 것)은 뒤에 만든 순서대로.
 * @param sessions 모든 세션(만든 순서 — listSessions)
 */
export function tabIndexOf(sessionId: string, sessions: Pick<TerminalSessionInfo, 'id' | 'cwd'>[]): number | null {
  const me = sessions.find((s) => s.id === sessionId);
  if (!me) return null;
  const rank = new Map((tabOrders[me.cwd] ?? []).map((id, i) => [id, i]));
  const at = (id: string) => rank.get(id) ?? Number.MAX_SAFE_INTEGER;
  const row = sessions.filter((s) => s.cwd === me.cwd).sort((a, b) => at(a.id) - at(b.id));
  return row.findIndex((s) => s.id === sessionId) + 1;
}
