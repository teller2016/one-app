// 시스템 잠자기 상태(렌더러 쪽) — main `features/power` 가 broadcast 하는 `power:state` 를 한 번만 구독해
// 폴러들이 공유한다. 잠자기(덮개 닫힘 뒤 다크웨이크 포함) 동안 `usePolling` 이 틱을 건너뛰고,
// 사용자가 깨운 완전 복귀에 즉시 따라잡는 근거가 된다.
//
// 폰(MO)·구 preload 에는 `power` 브리지가 없다 — 그때는 항상 깨어 있는 것으로 본다.
// (폰은 맥이 잠들면 WS 자체가 끊기고 복귀 신호도 못 받아, 멈추면 영영 안 풀린다)
import type { PowerState } from '../../shared/types';

let asleep = false;
let bound = false;
const wakeSubs = new Set<() => void>();

function bind(): void {
  if (bound) return;
  bound = true;
  window.oneApp?.power?.onState((state: PowerState) => {
    const wasAsleep = asleep;
    asleep = state.asleep;
    if (wasAsleep && !asleep) for (const cb of [...wakeSubs]) cb();
  });
}

/** 지금 시스템이 잠자기(다크웨이크 포함) 중인가 */
export function isSystemAsleep(): boolean {
  bind();
  return asleep;
}

/** 완전 복귀(잠자기 → 깨어남) 신호 구독. 해제 함수를 반환한다 */
export function onSystemWake(cb: () => void): () => void {
  bind();
  wakeSubs.add(cb);
  return () => {
    wakeSubs.delete(cb);
  };
}
