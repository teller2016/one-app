// 결재 기능 공개 API — 다른 기능(루트 세션 오케스트레이터)은 내부 파일이 아니라 여기서 import 한다.
// ⚠️ main.ts 의 `registerApprovalIpc`(./ipc)는 진입점이 직접 가져가는 파일이라 여기 싣지 않는다.
// 작성(run*Draft)은 내보내지 않는다 — 루트 세션은 폼을 채워 열기까지만 하고 작성은 사용자가 폼에서 시작한다.
export { approvalLockOwner } from './lock';
export { getExpendDefaults, getOvertimeDefaults, getVacationDefaults, getWorkerDept } from './store';
export { fetchVacationStatus } from './vacation';
