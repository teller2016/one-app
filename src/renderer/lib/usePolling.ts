// 주기 폴링·시계 틱 공용 훅 — 섹션마다 반복하던 setInterval useEffect 를 단일화
import { useEffect, useState } from 'react';

/**
 * 마운트 시 1회 실행(immediate) 후 intervalMs 마다 반복 호출.
 * fn 참조가 바뀌면 인터벌이 재시작되므로 useCallback 으로 안정화해서 넘긴다.
 */
export function usePolling(
  fn: () => void,
  intervalMs: number,
  {
    enabled = true,
    immediate = true,
  }: { enabled?: boolean; immediate?: boolean } = {},
) {
  useEffect(() => {
    if (!enabled) return;
    if (immediate) fn();
    const id = setInterval(fn, intervalMs);
    return () => clearInterval(id);
  }, [fn, intervalMs, enabled, immediate]);
}

/** "n분 전" 등 시간 표시 갱신용 리렌더 틱 — intervalMs 마다 값이 1씩 증가 */
export function useTick(intervalMs: number, enabled = true): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled]);
  return tick;
}
