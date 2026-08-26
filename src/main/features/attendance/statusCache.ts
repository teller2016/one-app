// 근태 조회 결과 캐시.
// 조회 한 번이 헤드리스 브라우저를 띄우는 비싼 왕복(수십 초)인데, 위젯은 마운트마다
// 조회한다 — 특히 폰(MO)은 탭을 오갈 때마다 새로 마운트된다.
//
// ⚠️ 값만 들고 있는 모듈이다 — 조회 함수를 여기서 부르지 않는다.
// (찍기 경로인 `attend.ts` 가 무효화를 부르므로, 조회까지 알면 import 가 순환한다)
import type { AttendanceResult } from '../../../shared/types';

const TTL_MS = 90_000;

let cache: { at: number; p: Promise<AttendanceResult> } | null = null;

/** 유효한 캐시(진행 중인 조회 포함) — 없으면 null */
export function getCachedAttendance(): Promise<AttendanceResult> | null {
  if (!cache) return null;
  if (Date.now() - cache.at >= TTL_MS) {
    cache = null;
    return null;
  }
  return cache.p;
}

/** 조회를 캐시에 건다 — 실패한 결과는 스스로 빠진다 (다음 조회가 다시 시도하도록) */
export function cacheAttendance(p: Promise<AttendanceResult>): Promise<AttendanceResult> {
  cache = { at: Date.now(), p };
  void p.then(
    (r) => {
      if (!r.ok && cache?.p === p) cache = null;
    },
    () => {
      if (cache?.p === p) cache = null;
    },
  );
  return p;
}

/**
 * 캐시 무효화 — 출/퇴근을 찍었으면 캐시된 시각은 곧바로 옛것이다.
 * 위젯·트레이·리마인더 어느 경로로 찍든 걸리도록 `runAttendance` 안에서 부른다.
 */
export function invalidateAttendance(): void {
  cache = null;
}
