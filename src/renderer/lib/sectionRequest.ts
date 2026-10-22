// 섹션 밖(⌘P 팔레트·루트 세션)에서 "그 섹션으로 가서 이 화면을 띄워 달라"는 요청을 넘기는 통로 — 배포·PR·결재·일정이 같은 틀을 쓴다.
//
// 요청은 **먼저 도착하고 섹션은 나중에 마운트된다**(섹션 이동 → 마운트·목록 로드) — `sectionNav.ts` 의 터미널 포커스 요청과 같은 이유로
// 담아 두고 섹션이 준비되면 꺼낸다(`take`). 섹션이 이미 떠 있으면 구독(`on`)으로 받는다.
// ⚠️ 오래 묵은 요청은 버린다 — 섹션이 끝내 꺼내지 못한 요청(목록 로드 실패 등)이 한참 뒤 그 섹션을 손으로 열 때 튀어나오지 않게.
import { navigateSection } from './sectionNav';

/** 이만큼 지난 요청은 꺼내지 않는다 — 섹션 이동·목록 로드에는 넉넉하고, 사용자가 잊었을 만큼은 아니게 */
export const SECTION_REQUEST_TTL_MS = 30_000;

export type SectionRequest<T> = {
  /** 그 섹션으로 이동하며 요청을 남긴다 */
  request: (value: T) => void;
  /** 대기 중인 요청을 꺼낸다 (한 번 꺼내면 비워진다 · 묵은 것은 null) */
  take: () => T | null;
  /** 섹션이 떠 있는 동안 새 요청을 받는다 — 해제 함수를 돌려준다 */
  on: (fn: () => void) => () => void;
};

export function createSectionRequest<T>(sectionId: string): SectionRequest<T> {
  let pending: { value: T; at: number } | null = null;
  const listeners = new Set<() => void>();
  return {
    request(value) {
      pending = { value, at: Date.now() };
      navigateSection(sectionId);
      for (const l of listeners) l();
    },
    take() {
      const p = pending;
      pending = null;
      return p && Date.now() - p.at <= SECTION_REQUEST_TTL_MS ? p.value : null;
    },
    on(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}
