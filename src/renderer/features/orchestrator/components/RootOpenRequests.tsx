import { useEffect } from 'react';
import type { AppOpenRequest } from '../../../../shared/types';
import { requestDeployConfirm } from '../../deploy';
import { requestApprovalForm } from '../../approval';
import { requestPr } from '../../prs';
import { requestScheduleFill } from '../../schedule';

/** 요청 종류 → 그 기능의 공개 요청 함수(화면을 채워 열기까지만 — 실행은 사용자가 그 화면에서) */
function dispatch(req: AppOpenRequest): void {
  switch (req.kind) {
    case 'deploy':
      // ⌘P 팔레트와 같은 길 — 배포 섹션으로 가서 확인 모달(커밋 미리보기·PROD 이름 입력)을 연다
      requestDeployConfirm({ projectId: req.projectId, targetId: req.targetId });
      break;
    case 'pr-create':
      // PR 섹션의 그 저장소 탭으로 가서 새 PR 모달을 채워 연다 — [PR 생성]은 사용자가
      requestPr({ kind: 'create', repo: req.repo, head: req.head, base: req.base, title: req.title, body: req.body });
      break;
    case 'pr-merge':
      // 그 PR 을 골라 상세 패널을 띄운다 — [머지](와 주요 브랜치 이름 입력 확인)는 사용자가
      requestPr({ kind: 'merge', repo: req.repo, number: req.number, method: req.method });
      break;
    case 'approval':
      // 결재 섹션의 그 폼을 채워 연다 — [작성 시작]·그룹웨어 창의 [상신]은 사용자가(휴가는 작성이 근태신청을 서버에 저장한다)
      requestApprovalForm(req.fill);
      break;
    case 'schedule':
      // 일정 등록 섹션의 작업 기록에 덧붙인다 — [일정 등록]·[노션에 기록]은 사용자가
      requestScheduleFill(req.fill);
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
