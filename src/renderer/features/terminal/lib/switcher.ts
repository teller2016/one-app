// ⌘⇧P Claude 세션 전환 — 저장소별 묶음·정렬·검색 (순수 함수 — switcher.test.ts)
import type { TerminalOverviewItem } from '../../../../shared/types';

/** 탭 점과 같은 기준 — 입력 대기 = 주황 · 작업 중 = 초록(`working` — busy 는 한 프레임에도 켜진다) · 쉬는 중 */
export type Phase = 'wait' | 'run' | 'idle';
export const PHASES: Phase[] = ['wait', 'run', 'idle'];
export const PHASE_LABEL: Record<Phase, string> = {
  wait: '입력 대기',
  run: '작업 중',
  idle: '쉬는 중',
};
export const phaseOf = (s: TerminalOverviewItem): Phase =>
  s.status === 'waiting' ? 'wait' : s.working ? 'run' : 'idle';

/** 큰 글씨 한 줄 — 작업 제목, 없으면 첫 요청, 그것도 없으면(첫 메시지 전) 탭 이름 */
export const headline = (s: TerminalOverviewItem) => s.title ?? s.firstPrompt ?? s.tabTitle;

/** 브랜치 칩을 달 것인가 — 기본 브랜치(main/master)는 줄마다 반복될 뿐이라 생략 */
export const showBranch = (b: string | null): b is string =>
  !!b && b !== 'main' && b !== 'master';

/** 공백으로 나눈 모든 조각이 들어 있으면 일치 (대소문자 무시) — ⌘P 팔레트와 같은 규칙 */
export function matches(s: TerminalOverviewItem, q: string): boolean {
  if (!q) return true;
  const hay = [s.title, s.firstPrompt, s.lastPrompt, s.workspace?.name, s.branch, s.tabTitle]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((t) => hay.includes(t));
}

/** 급한 순 — 상태(입력 대기 → 작업 중 → 쉬는 중), 같으면 최근 활동 */
const urgency = (a: TerminalOverviewItem, b: TerminalOverviewItem) =>
  PHASES.indexOf(phaseOf(a)) - PHASES.indexOf(phaseOf(b)) || b.activityAt - a.activityAt;

export type SessionGroup = {
  /** 워크스페이스 id — 워크스페이스 밖이면 '' ('기타') */
  key: string;
  workspace: TerminalOverviewItem['workspace'];
  sessions: TerminalOverviewItem[];
};

/**
 * 저장소별 묶음 — 묶음 안은 급한 순, 묶음끼리는 **가장 급한 세션** 기준으로 같은 규칙.
 * 등록된 워크스페이스 밖의 세션('기타')은 맨 아래.
 */
export function groupSessions(items: TerminalOverviewItem[]): SessionGroup[] {
  const byKey = new Map<string, SessionGroup>();
  for (const s of items) {
    const key = s.workspace?.id ?? '';
    let g = byKey.get(key);
    if (!g) {
      g = { key, workspace: s.workspace, sessions: [] };
      byKey.set(key, g);
    }
    g.sessions.push(s);
  }
  const groups = [...byKey.values()];
  for (const g of groups) g.sessions.sort(urgency);
  return groups.sort(
    (a, b) => Number(!a.key) - Number(!b.key) || urgency(a.sessions[0], b.sessions[0]),
  );
}

/** 상태별 세션 수 — 검색줄 오른쪽 요약 */
export function phaseCounts(items: TerminalOverviewItem[]): Record<Phase, number> {
  const out: Record<Phase, number> = { wait: 0, run: 0, idle: 0 };
  for (const s of items) out[phaseOf(s)] += 1;
  return out;
}
