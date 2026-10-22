// PR 섹션 밖(루트 세션)에서 "이 저장소의 새 PR 모달을 이 값으로 열어 달라 / 이 PR 을 머지할 수 있게 띄워 달라"는 요청을 넘기는 통로.
//
// 요청은 먼저 도착하고 섹션은 나중에 마운트된다(섹션 이동 → PrSection 마운트·목록 로드) — 배포의 `deployRequest.ts` 와 같은 이유로
// 요청을 담아 두고 섹션이 소비한다. ⚠️ 여기서는 PR 을 만들거나 머지하지 **않는다** — 모달을 채워 열거나 그 PR 을 골라 두기까지만.
import type { PrMergeMethod } from '../../../../shared/types';
import { navigateSection } from '../../../lib/sectionNav';

export type PrRequest =
  | { kind: 'create'; repo: string; head?: string; base?: string; title?: string; body?: string }
  | { kind: 'merge'; repo: string; number: number; method?: PrMergeMethod };

let pending: PrRequest | null = null;
const listeners = new Set<() => void>();

/** PR 섹션으로 이동하며 새 PR 모달·머지할 PR 을 띄워 달라고 요청한다 */
export function requestPr(req: PrRequest): void {
  pending = req;
  navigateSection('prs');
  for (const l of listeners) l();
}

/** 대기 중인 요청을 꺼낸다 (한 번 꺼내면 비워진다) */
export function takePrRequest(): PrRequest | null {
  const req = pending;
  pending = null;
  return req;
}

/** 섹션이 떠 있는 동안 새 요청을 받는다 — 해제 함수를 돌려준다 */
export function onPrRequest(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
