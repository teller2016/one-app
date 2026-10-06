// 세션 상태 → 표시 — 탭 점·LNB·⌘⇧P 가 같은 기준으로 그린다 (2026-10-06 대기를 '확인 전'·'입력 대기'로 나눔)
import { useEffect } from 'react';
import { isUnseenWait, SEEN_DWELL_MS, type TerminalSessionInfo } from '../../../../shared/types';
import { useWindowActive } from '../../../lib/usePolling';

/**
 * 작업 중 = 초록 펄스 · 확인 전(끝났는데 아직 안 봄) = 연두 · 입력 대기(보고 내 차례) = 주황 · 쉬는 중.
 * ⚠️ 탭 점의 작업 중은 예전대로 `busy` 를 본다(LNB 스피너만 `working`).
 */
export type SessionDot = 'run' | 'fresh' | 'wait' | 'idle';

export const SESSION_DOT_LABEL: Record<SessionDot, string> = {
  run: '작업 중',
  fresh: '확인 전',
  wait: '입력 대기',
  idle: '유휴',
};

export function sessionDot(s: Pick<TerminalSessionInfo, 'status' | 'seen'>): SessionDot {
  if (s.status === 'busy') return 'run';
  if (s.status === 'waiting') return isUnseenWait(s) ? 'fresh' : 'wait';
  return 'idle';
}

/**
 * 화면에 올라온 '확인 전' 세션을 확인함으로 올린다 — 포커스된 창에 `SEEN_DWELL_MS` 넘게 보였을 때.
 * 메인 창(터미널 섹션이 활성일 때)과 팝아웃이 각자 자기 화면 세션을 넘긴다. 판정 결과는 main 이 들고
 * 모든 창·폰에 방송한다(`pty.markSessionSeen`). 보는 중에 끝난 세션도 같은 길로 곧 확인함이 된다.
 */
export function useMarkSeen(
  sessions: TerminalSessionInfo[],
  shownIds: readonly string[],
  enabled: boolean,
): void {
  const focused = useWindowActive(); // 뒤에 깔린 창에 떠 있던 세션은 본 것이 아니다
  // 기다릴 대상만 문자열 키로 — 다른 세션의 상태 방송마다 타이머가 다시 걸리지 않게
  const key =
    enabled && focused
      ? shownIds.filter((id) => sessions.some((s) => s.id === id && isUnseenWait(s))).join('\n')
      : '';
  useEffect(() => {
    if (!key) return;
    const t = setTimeout(() => {
      for (const id of key.split('\n')) window.oneApp?.terminal?.markSeen?.(id);
    }, SEEN_DWELL_MS);
    return () => clearTimeout(t);
  }, [key]);
}
