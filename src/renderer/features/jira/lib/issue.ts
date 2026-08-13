import type { JiraIssue } from '../../../../shared/types';
import { isDoneStatus } from '../../../../shared/types';

/**
 * 해결 상태 판별 — 판정 자체는 `shared/types.ts` 의 `isDoneStatus`(main 과 공용)에 있다.
 * 여기서는 목록 행 객체를 그대로 넘길 수 있게 감싸기만 한다.
 */
export const isDone = (it: Pick<JiraIssue, 'status' | 'statusCategory'>) =>
  isDoneStatus(it.status, it.statusCategory);

/** 상태 → 뱃지 색 (해야 할 일=회색, 진행 중=노랑, 해결=초록) — 내 이슈·주간 탭 공용 */
export const statusBadgeVariant = (
  it: Pick<JiraIssue, 'status' | 'statusCategory'>,
): 'ok' | 'busy' | 'idle' =>
  isDone(it) ? 'ok' : it.statusCategory === 'indeterminate' ? 'busy' : 'idle';
