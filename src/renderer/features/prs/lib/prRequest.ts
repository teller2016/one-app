// PR 섹션 밖(루트 세션)에서 "이 저장소의 새 PR 모달을 이 값으로 열어 달라 / 이 PR 을 머지할 수 있게 띄워 달라"는 요청을 넘기는 통로.
//
// 요청은 먼저 도착하고 섹션은 나중에 마운트된다(섹션 이동 → PrSection 마운트·목록 로드) — `lib/sectionRequest.ts` 의 이유로
// 요청을 담아 두고 섹션이 소비한다. ⚠️ 여기서는 PR 을 만들거나 머지하지 **않는다** — 모달을 채워 열거나 그 PR 을 골라 두기까지만.
import type { PrMergeMethod } from '../../../../shared/types';
import { createSectionRequest } from '../../../lib/sectionRequest';

export type PrRequest =
  | { kind: 'create'; repo: string; head?: string; base?: string; title?: string; body?: string }
  | { kind: 'merge'; repo: string; number: number; method?: PrMergeMethod };

const channel = createSectionRequest<PrRequest>('prs');

/** PR 섹션으로 이동하며 새 PR 모달·머지할 PR 을 띄워 달라고 요청한다 */
export const requestPr = channel.request;
/** 대기 중인 요청을 꺼낸다 (한 번 꺼내면 비워진다 · 30초 지난 것은 버린다) */
export const takePrRequest = channel.take;
/** 섹션이 떠 있는 동안 새 요청을 받는다 — 해제 함수를 돌려준다 */
export const onPrRequest = channel.on;
