// 결재 섹션 밖(루트 세션)에서 "이 결재 폼을 이 값으로 채워 열어 달라"는 요청을 넘기는 통로.
//
// 요청은 먼저 도착하고 섹션은 나중에 마운트될 수 있다 — 배포의 `deployRequest.ts` 와 같은 이유로 요청을 담아 두고 섹션이 소비한다.
// ⚠️ 여기서는 작성하지 **않는다** — 폼을 채워 보여 주기까지만. [작성 시작]·그룹웨어 창의 [상신]은 사용자가 누른다
// (휴가는 자동화가 근태신청을 서버에 저장하므로 특히 사용자 클릭 없이 돌면 안 된다 — approval 규칙).
// 단독판(One App Lite)은 섹션 이동기가 없어 navigateSection 이 아무 일도 하지 않는다 — 루트 세션도 없으니 요청이 오지 않는다.
import type { ApprovalFormFill } from '../../../../shared/types';
import { navigateSection } from '../../../lib/sectionNav';

let pending: ApprovalFormFill | null = null;
const listeners = new Set<() => void>();

/** 결재 섹션으로 이동하며 그 폼을 이 값으로 채워 열어 달라고 요청한다 */
export function requestApprovalForm(fill: ApprovalFormFill): void {
  pending = fill;
  navigateSection('approval');
  for (const l of listeners) l();
}

/** 대기 중인 요청을 꺼낸다 (한 번 꺼내면 비워진다) */
export function takeApprovalRequest(): ApprovalFormFill | null {
  const req = pending;
  pending = null;
  return req;
}

/** 섹션이 떠 있는 동안 새 요청을 받는다 — 해제 함수를 돌려준다 */
export function onApprovalRequest(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
