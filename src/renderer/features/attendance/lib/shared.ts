// 근태 정보 렌더러 공유 스토어 — attendance:fetch 는 호출마다 headless puppeteer 를
// 구동하므로, 위젯이 조회한 최신 결과를 다른 화면(홈 대시보드)이 재사용한다.
// (useSyncExternalStore 규약: subscribe + 스냅샷 getter)
import type { AttendanceInfo } from '../../../../shared/types';

export type AttendanceSnapshot = {
  info: AttendanceInfo | null;
  error: string;
  loading: boolean;
};

let snapshot: AttendanceSnapshot = { info: null, error: '', loading: true };
const listeners = new Set<() => void>();

/** 위젯이 조회·찍기 결과를 반영할 때 호출 — 구독자(홈 카드)에 즉시 전파 */
export function publishAttendance(next: Partial<AttendanceSnapshot>) {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((l) => l());
}

export function getAttendanceSnapshot(): AttendanceSnapshot {
  return snapshot;
}

export function subscribeAttendance(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
