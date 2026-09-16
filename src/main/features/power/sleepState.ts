// 시스템 잠자기 상태 — "잠자기(다크웨이크 포함)" 와 "사용자가 깨운 완전 복귀" 를 가른다.
//
// ⚠️ Electron `powerMonitor` 의 `resume` 은 다크웨이크(덮개 닫힌 채 Wi-Fi/BT·유지관리 사유로 몇 초 깨는 것)
// 에도 발화한다. 그걸 복귀로 보면 폴러들이 다크웨이크마다 깨어나 헛돌고, 2026-09-16 처럼 한 시간에
// 248번 깨는 폭주에선 그 자체가 발열 요인이 된다. 그래서 `suspend` 에 잠자기로 들어간 뒤
// **사람이 깨운 증거**(화면 잠금 해제 · 복귀 뒤 입력 발생)가 있을 때만 깨어난 것으로 본다.
// 상태는 `power:state` 로 broadcast 해 렌더러(`lib/powerState.ts`)와 main 폴러가 참조한다.
import { app, powerMonitor } from 'electron';
import type { PowerState } from '../../../shared/types';
import { broadcast } from '../../lib/broadcast';
import { reportSleepCycle } from './wakeReport';

/** 복귀 뒤 입력 감지 주기 — 다크웨이크는 몇 초 만에 다시 잠들어 `suspend` 가 이 타이머를 걷어낸다 */
const ACTIVITY_PROBE_MS = 5_000;

let asleep = false;
let sleptAt: number | null = null; // 이번 사이클이 시작된(처음 잠든) 시각 — 보고 구간의 시작
let resumedAt = 0; // 마지막 resume 시각 — 그 뒤에 생긴 입력만 "깨운 것" 으로 인정
let probeTimer: ReturnType<typeof setInterval> | null = null;
const subs = new Set<(state: PowerState) => void>();

/** 지금 잠자기(다크웨이크 포함) 중인가 — main 폴러(근태·VPN 감시)가 틱을 건너뛸 때 본다 */
export function isSystemAsleep(): boolean {
  return asleep;
}

/** 상태 변화 구독 (main 안). 해제 함수를 반환한다 */
export function onPowerState(cb: (state: PowerState) => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}

function setAsleep(next: boolean): void {
  if (asleep === next) return;
  asleep = next;
  const state: PowerState = { asleep: next };
  broadcast('power:state', state);
  for (const cb of subs) {
    try {
      cb(state);
    } catch (err) {
      console.error('[power] 상태 리스너 오류:', err);
    }
  }
}

function cancelProbe(): void {
  if (probeTimer) clearInterval(probeTimer);
  probeTimer = null;
}

/** 잠자기 진입 — 다크웨이크에서 다시 잠들 때도 온다. 사이클 시작 시각은 처음 것만 남긴다 */
function onSuspend(): void {
  cancelProbe();
  if (!asleep) sleptAt = Date.now();
  setAsleep(true);
}

/**
 * 깨어남(다크웨이크 포함) — 바로 복귀로 보지 않고, resume 이후 사용자 입력이 있었는지 살핀다.
 * `getSystemIdleTime` 은 마지막 입력 이후 초 — 덮개를 닫기 직전의 타이핑이 잡히지 않게 resume 시각과 비교한다
 */
function onResume(): void {
  if (!asleep) return;
  resumedAt = Date.now();
  cancelProbe();
  const check = () => {
    const inputAt = Date.now() - powerMonitor.getSystemIdleTime() * 1000;
    if (inputAt > resumedAt) fullWake();
  };
  check();
  if (asleep) probeTimer = setInterval(check, ACTIVITY_PROBE_MS);
}

/** 완전 복귀 — 상태를 풀고 직전 사이클을 집계해 폭주면 알린다 */
function fullWake(): void {
  cancelProbe();
  const since = sleptAt;
  sleptAt = null;
  setAsleep(false);
  if (since !== null) void reportSleepCycle(since, Date.now());
}

/**
 * 감시 시작 — `powerMonitor` 는 app ready 뒤에만 쓸 수 있어 whenReady 뒤에 건다.
 * 화면 잠금 해제는 사람이 한 일이 확실하니 즉시 복귀로 본다.
 */
export function startPowerWatch(): void {
  void app.whenReady().then(() => {
    powerMonitor.on('suspend', onSuspend);
    powerMonitor.on('resume', onResume);
    powerMonitor.on('unlock-screen', () => {
      if (asleep) fullWake();
    });
  });
}
