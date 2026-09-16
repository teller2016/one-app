// 주기 폴링·시계 틱 공용 훅 — 섹션마다 반복하던 setInterval useEffect 를 단일화
import { useEffect, useState } from 'react';
import { isSystemAsleep, onSystemWake } from './powerState';

// 창이 활성(보임+포커스)일 때만 기본 주기로 돌고, 백그라운드에선 이 배수만큼 느슨하게.
// 메일 위젯에서 확립한 활성 30초/유휴 3분 비율을 전 폴러 공통으로 승격(2026-08-07).
const IDLE_FACTOR = 6;

const isWindowActive = (): boolean =>
  document.visibilityState === 'visible' && document.hasFocus();

/**
 * 마운트 시 1회 실행(immediate) 후 intervalMs 마다 반복 호출.
 * 창이 백그라운드(가려짐·포커스 아웃)면 주기를 IDLE_FACTOR 배로 늘리고,
 * 창 복귀 시 마지막 실행이 intervalMs 보다 오래됐으면 즉시 1회 따라잡는다.
 * 시스템 잠자기(덮개 닫힘 뒤 다크웨이크 포함) 중엔 틱을 건너뛰고, 완전 복귀에 즉시 따라잡는다.
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
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastRun = Date.now(); // immediate=false 여도 "주기는 지금부터"로 취급

    const run = () => {
      lastRun = Date.now();
      fn();
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        // 잠자기 중(다크웨이크 포함)엔 건너뛴다 — 창은 가려져 있어도 타이머는 다크웨이크마다 돈다.
        // 완전 복귀는 onSystemWakeUp 이 따라잡는다 (lib/powerState.ts, main features/power)
        if (!isSystemAsleep()) run();
        schedule();
      }, isWindowActive() ? intervalMs : intervalMs * IDLE_FACTOR);
    };

    if (immediate) run();
    schedule();

    // 창 복귀 — 밀린 폴링을 즉시 따라잡고 촘촘한 주기로 재개
    const onWake = () => {
      if (!isWindowActive()) return;
      if (Date.now() - lastRun >= intervalMs) run();
      schedule();
    };
    // 시스템 완전 복귀 — 창이 보이면(포커스가 아니어도) 밀린 폴링을 따라잡는다
    const onSystemWakeUp = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastRun >= intervalMs) run();
      schedule();
    };
    window.addEventListener('focus', onWake);
    document.addEventListener('visibilitychange', onWake);
    const offSystemWake = onSystemWake(onSystemWakeUp);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', onWake);
      document.removeEventListener('visibilitychange', onWake);
      offSystemWake();
    };
  }, [fn, intervalMs, enabled, immediate]);
}

/**
 * "n분 전" 등 시간 표시 갱신용 리렌더 틱 — intervalMs 마다 값이 1씩 증가.
 * 창이 안 보일 땐 멈추고(숨은 화면 리렌더는 낭비), 다시 보이면 즉시 1회 증가해 따라잡는다.
 */
export function useTick(intervalMs: number, enabled = true): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let id: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (id === undefined) id = setInterval(() => setTick((t) => t + 1), intervalMs);
    };
    const stop = () => {
      if (id !== undefined) {
        clearInterval(id);
        id = undefined;
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        setTick((t) => t + 1);
        start();
      } else stop();
    };
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [intervalMs, enabled]);
  return tick;
}
