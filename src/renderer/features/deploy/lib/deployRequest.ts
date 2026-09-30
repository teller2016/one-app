// 배포 섹션 밖(⌘K 팔레트)에서 "이 대상 배포 확인 모달을 열어 달라"는 요청을 넘기는 통로.
//
// 요청은 **먼저 도착하고 섹션은 나중에 마운트된다**(섹션 이동 → DeploySection 마운트·목록 로드)
// — `sectionNav.ts` 의 터미널 포커스 요청과 같은 이유로 요청을 담아 두고 섹션이 소비한다.
// ⚠️ 여기서는 배포를 **실행하지 않는다** — 확인 모달(PROD 이름 입력 포함)까지만 연다.
import { navigateSection } from '../../../lib/sectionNav';

export type DeployRequest = { projectId: string; targetId: string };

let pending: DeployRequest | null = null;
const listeners = new Set<() => void>();

/** 배포 섹션으로 이동하며 그 대상의 확인 모달을 열어 달라고 요청한다 */
export function requestDeployConfirm(req: DeployRequest): void {
  pending = req;
  navigateSection('deploy');
  for (const l of listeners) l();
}

/** 대기 중인 요청을 꺼낸다 (한 번 꺼내면 비워진다) */
export function takeDeployRequest(): DeployRequest | null {
  const req = pending;
  pending = null;
  return req;
}

/** 섹션이 떠 있는 동안 새 요청을 받는다 — 해제 함수를 돌려준다 */
export function onDeployRequest(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
