import { useEffect } from 'react';
import type { AppOpenRequest } from '../../../../shared/types';
import { requestDeployConfirm } from '../../deploy';

/** 요청 종류 → 그 기능의 공개 요청 함수(화면을 채워 열기까지만 — 실행은 사용자가 그 화면에서) */
function dispatch(req: AppOpenRequest): void {
  switch (req.kind) {
    case 'deploy':
      // ⌘P 팔레트와 같은 길 — 배포 섹션으로 가서 확인 모달(커밋 미리보기·PROD 이름 입력)을 연다
      requestDeployConfirm({ projectId: req.projectId, targetId: req.targetId });
      break;
  }
}

/**
 * 루트 세션이 보낸 '기능 화면 열기' 요청을 받는다(main `orchestrator/openRequest.ts` → `app:open-request`).
 * App 셸에 한 번만 마운트한다. 화면에는 아무것도 그리지 않는다.
 */
export function RootOpenRequests() {
  useEffect(() => window.oneApp?.orchestrator?.onOpenRequest(dispatch), []);
  return null;
}
