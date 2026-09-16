// 잠자기 사이클 보고 — 완전 복귀 때 한 번 `pmset -g log` 를 읽어 직전 사이클을 집계하고,
// 폭주(다크웨이크 과다·발열 비상)면 sticky 토스트로 알린다. 규칙은 wakeLog.ts.
import { execFile } from 'node:child_process';
import { sendToast } from '../notify/notify';
import {
  MIN_REPORT_CYCLE_MS,
  formatDuration,
  formatWakeStormToast,
  judgeWakeStorm,
  summarizeSleepCycle,
} from './wakeLog';

/** 토스트는 한 장만 — 다음 사이클 결과가 같은 자리를 교체한다 */
const TOAST_KEY = 'power-wake-storm';
// ⚠️ 로그가 14MB 를 넘고(2026-09-17 실측, 부팅 뒤 며칠치) 읽는 데 2.4초 걸린다 — 기본 maxBuffer(1MB)면
// 잘려 실패하고, 다크웨이크마다 돌리면 그 자체가 부하다. 그래서 sleepState 가 완전 복귀에서만 부른다
const PMSET_MAX_BUFFER = 64 * 1024 * 1024;
const PMSET_TIMEOUT_MS = 30_000;

function readPmsetLog(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'pmset',
      ['-g', 'log'],
      { maxBuffer: PMSET_MAX_BUFFER, timeout: PMSET_TIMEOUT_MS },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    );
  });
}

/**
 * [sinceMs, untilMs] 잠자기 사이클을 집계해 폭주면 알린다. 짧은 잠자기는 건너뛴다.
 * 실패(pmset 없음·타임아웃)는 경고 로그만 — 곁가지라 기능을 막지 않는다.
 */
export async function reportSleepCycle(sinceMs: number, untilMs: number): Promise<void> {
  if (untilMs - sinceMs < MIN_REPORT_CYCLE_MS) return;
  let text: string;
  try {
    text = await readPmsetLog();
  } catch (err) {
    console.warn('[power] pmset 로그를 읽지 못했습니다:', err);
    return;
  }
  const summary = summarizeSleepCycle(text, sinceMs, untilMs);
  const verdict = judgeWakeStorm(summary);
  console.log(
    `[power] 잠자기 ${formatDuration(summary.durationMs)}: 다크웨이크 ${summary.darkWakes}회` +
      `${summary.lidClosed ? ' · 덮개 닫힘' : ''}${summary.thermal ? ' · 발열 비상' : ''}` +
      ` · 배터리 ${summary.batteryStart ?? '?'}%→${summary.batteryEnd ?? '?'}%` +
      ` → ${verdict.storm ? `폭주(${verdict.reason})` : '정상'}`,
  );
  if (!verdict.storm) return;
  sendToast({
    ...formatWakeStormToast(summary),
    variant: 'fail',
    sticky: true,
    dedupeKey: TOAST_KEY,
  });
}
