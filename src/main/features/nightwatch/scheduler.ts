// Nightwatch 스케줄러 — 앱이 살아 있는 동안 주기적으로 엔진을 깨운다.
// 게이트 판단(감시 on/off·시간창·유휴·상한)은 전부 엔진이 하므로 tick 은 호출만 한다.
import { runCycleOnce } from "./engine";
import { appendCycleLog } from "./store";

const TICK_MS = 60_000;

let timer: ReturnType<typeof setInterval> | null = null;

export function startNightwatchScheduler() {
  if (timer) return;
  timer = setInterval(() => {
    runCycleOnce(false).catch((e) => {
      appendCycleLog(
        `tick 오류: ${e instanceof Error ? e.message : String(e)}`
      );
    });
  }, TICK_MS);
}
