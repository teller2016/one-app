// 워크스페이스 LNB·프리셋 공용 헬퍼 — 선택 상태 타입·이니셜·색 인덱스·프리셋 스코프.
// (TerminalSection·WorkspaceNav·SessionTabs·TerminalView 가 함께 쓴다)
import type { IconName } from '../../../components/Icon';
import type {
  TerminalAgentId,
  TerminalPreset,
  TerminalSessionInfo,
  WorktreeInfo,
} from '../../../../shared/types';

/**
 * LNB 선택 상태 — 워크트리 하나 또는 '기타 세션'(어느 워크트리에도 안 속한 세션 묶음).
 * 상단 탭바는 이 선택에 속한 세션들만 보여준다.
 */
export type WorkspaceSelection =
  | { kind: 'worktree'; wsId: string; path: string }
  | { kind: 'other' };

/** 두 선택이 같은가 — 탭 목록·활성 표시 비교용 */
export function sameSelection(
  a: WorkspaceSelection | null,
  b: WorkspaceSelection | null
): boolean {
  if (!a || !b) return a === b;
  if (a.kind === 'other' || b.kind === 'other') return a.kind === b.kind;
  return a.wsId === b.wsId && a.path === b.path;
}

/**
 * 이름 이니셜 — 워크스페이스 타일·축소 패널 타일 공용.
 * Superset 타일과 같은 첫 글자 1자 + 대문자 (2026-08-06 사용자 요청).
 * Array.from — 서로게이트 쌍(이모지 등)이 반 글자로 잘리지 않게.
 */
export function initials(title: string): string {
  const t = title.trim();
  if (!t) return '?';
  return (Array.from(t)[0] ?? '?').toUpperCase();
}

/** 워크스페이스 타일 색 — 이름 해시로 차트 팔레트(--chart-1t~10t) 중 하나를 고정 배정 */
export function colorIndex(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return (Math.abs(h) % 10) + 1; // 1..10
}

/** 타일에 실제로 칠할 색 인덱스 — 사용자가 지정한 색 우선, 없으면 이름 해시 */
export function tileColor(ws: { name: string; color?: number }): number {
  return ws.color ?? colorIndex(ws.name);
}

/** 경로 마지막 폴더명 — 워크트리 표시명(주 워크트리는 'local') */
export function worktreeName(wt: WorktreeInfo): string {
  if (wt.isMain) return 'local';
  const segs = wt.path.split('/').filter(Boolean);
  return segs[segs.length - 1] ?? wt.path;
}

/** 세션이 이 워크트리 소속인가 — 시작 cwd 정확 일치 기준 */
export function sessionsOf(
  sessions: TerminalSessionInfo[],
  worktreePath: string
): TerminalSessionInfo[] {
  return sessions.filter((s) => s.cwd === worktreePath);
}

/**
 * 프리셋 바에 보일 프리셋 — 숨김(pinned:false) 제외 + 스코프 필터.
 * 전역(workspaceIds 없음)은 어디서나, 지정 프리셋은 그 워크스페이스에서만.
 */
export function presetsForWorkspace(
  presets: TerminalPreset[],
  wsId: string | null
): TerminalPreset[] {
  return presets.filter(
    (p) =>
      p.pinned !== false &&
      (!p.workspaceIds || (wsId !== null && p.workspaceIds.includes(wsId)))
  );
}

/**
 * 프리셋 명령의 실행 파일명 → 에이전트 id — 상태 휴리스틱(waiting 알림)이
 * 에이전트 세션 기준이라, claude 프리셋 등은 에이전트로 태깅해 생성한다.
 * 앞의 `VAR=값` 환경 지정(JAVA_HOME=… ./gradlew 류)은 건너뛴다.
 */
export function agentIdFromCommand(command: string): TerminalAgentId {
  const bin =
    command
      .trim()
      .split(/\s+/)
      .find((w) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) ?? '';
  const name = bin.split('/').pop() ?? '';
  const agents: TerminalAgentId[] = ['claude', 'femc', 'codex', 'gemini'];
  return agents.find((a) => a === name) ?? 'shell';
}

/** 프리셋 칩 아이콘 — claude 는 ✳(Superset 무드), 나머지는 터미널 글리프 */
export function presetIcon(p: TerminalPreset): IconName {
  return agentIdFromCommand(p.command) === 'claude' ? 'asterisk' : 'terminal';
}
