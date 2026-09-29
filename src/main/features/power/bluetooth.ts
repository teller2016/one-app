// 잠잘 때 블루투스 끄기 — "가방 안" 상태에서만 끄고, 사람이 덮개를 열면 되돌린다.
//
// 배경(2026-09-20 확정, 규칙 문서 참고): 덮개를 닫아 HID 가 끊기면 bluetoothd 가 그 장치들에
// 재연결을 건 채(`HIDProfile::startHIDAutoConnect`) 잠들고, Wi-Fi/BT 콤보 칩이 저전력 진입에
// 실패해(`centaurid` `Controller-S2REntry`) 맥을 깨운다. 깨면 BLE 주소가 바뀌어 처음부터 반복 —
// 하루 200회 넘는 다크웨이크의 원인이다. 잠들기 전에 블루투스를 꺼서 재연결 대상을 없앤다.
//
// ⚠️ **끄는 조건이 이 파일의 핵심이다.** 덮개를 닫고 외부 모니터로 계속 쓰는 클램셸 사용 중에
// 껐다가는 블루투스 키보드·마우스로 맥을 깨울 수 없게 된다. 그래서 "안 쓰는 상태" 를
// 세 조건의 AND 로만 인정한다 — 하나라도 어긋나면 건드리지 않는다.
import { execFile, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { powerMonitor, screen } from 'electron';
import { sendToast } from '../notify/notify';
import { clearBluetoothOff, didWeTurnBluetoothOff, markBluetoothOff } from './store';

/**
 * blueutil 후보 경로.
 * ⚠️ 절대 경로로 찾는다 — GUI 로 뜬 Electron 의 `PATH` 에는 Homebrew 경로가 없어서
 * `blueutil` 이라고만 부르면 설치돼 있어도 ENOENT 가 난다.
 */
const BLUEUTIL_PATHS = [
  '/opt/homebrew/bin/blueutil', // Apple Silicon Homebrew
  '/usr/local/bin/blueutil', // Intel Homebrew
  '/opt/local/bin/blueutil', // MacPorts
];

/** 덮개 상태를 읽는 ioreg — 이것도 PATH 를 믿지 않는다 */
const IOREG = '/usr/sbin/ioreg';

// ⚠️ 잠들기 직전(suspend 핸들러)에 동기로 부르므로 짧게 끊는다. 비동기로 미루면
// 맥이 먼저 잠들어 결과를 못 받는다 — blueutil·ioreg 는 정상이면 수십 ms 다.
const EXEC_TIMEOUT_MS = 3_000;

/** 설치된 blueutil 경로 — 없으면 null (환경설정이 안내 문구를 띄운다) */
export function findBlueutil(): string | null {
  for (const bin of BLUEUTIL_PATHS) {
    try {
      if (fs.existsSync(bin)) return bin;
    } catch {
      // 접근 불가 경로는 다음 후보로
    }
  }
  return null;
}

/** 블루투스 전원 상태 — 켜짐 true / 꺼짐 false / 못 읽음 null */
function readPower(bin: string): boolean | null {
  try {
    const out = execFileSync(bin, ['-p'], {
      timeout: EXEC_TIMEOUT_MS,
      encoding: 'utf8',
    });
    return out.trim() === '1';
  } catch (err) {
    console.warn('[power] 블루투스 상태를 읽지 못했습니다:', err);
    return null;
  }
}

/**
 * 복구 재시도 간격(ms) — ⚠️ **한 번만 시도하면 안 된다.**
 * 2026-09-22 실측: `resume` 직후 첫 시도가 실패했다(평상시 같은 명령은 성공한다). 깨어나는 중에는
 * 블루투스 스택이 아직 준비되지 않는다. 여기서 포기하면 입력장치가 안 돌아온 채 방치된다.
 */
const RESTORE_RETRY_MS = [0, 1_000, 3_000, 7_000];

/** 복구 재시도가 도는 중인가 — resume 과 fullWake 가 연달아 불러 중복 실행되는 것을 막는다 */
let restoring = false;

/** 블루투스 켜기(비동기) — 복구 경로 전용. 잠들기 직전이 아니라 main 을 멈출 이유가 없다 */
function writePowerAsync(bin: string, on: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(bin, ['-p', on ? '1' : '0'], { timeout: EXEC_TIMEOUT_MS }, (err) => {
      if (err) console.warn(`[power] 블루투스를 ${on ? '켜지' : '끄지'} 못했습니다:`, err);
      resolve(!err);
    });
  });
}

/** 블루투스 전원 켜기/끄기 — 성공 여부를 돌려준다 */
function writePower(bin: string, on: boolean): boolean {
  try {
    execFileSync(bin, ['-p', on ? '1' : '0'], { timeout: EXEC_TIMEOUT_MS });
    return true;
  } catch (err) {
    console.warn(`[power] 블루투스를 ${on ? '켜지' : '끄지'} 못했습니다:`, err);
    return false;
  }
}

/**
 * 덮개가 닫혀 있는가 — 닫힘 true / 열림 false / 알 수 없음 null.
 *
 * ⚠️ `AppleClamshellCausesSleep` 이라는 비슷한 키가 같은 출력에 함께 나온다. 키 이름을
 * 따옴표까지 붙여 정확히 맞춘다 — 부분 일치로 읽으면 엉뚱한 값을 덮개 상태로 착각한다.
 */
export function isLidClosed(): boolean | null {
  try {
    const out = execFileSync(IOREG, ['-r', '-k', 'AppleClamshellState', '-d', '4'], {
      timeout: EXEC_TIMEOUT_MS,
      encoding: 'utf8',
    });
    const m = out.match(/"AppleClamshellState"\s*=\s*(Yes|No)/);
    return m ? m[1] === 'Yes' : null;
  } catch (err) {
    console.warn('[power] 덮개 상태를 읽지 못했습니다:', err);
    return null;
  }
}

/**
 * 외부 모니터가 하나라도 붙어 있는가.
 * 덮개를 닫고도 맥이 깨어 있으려면(클램셸) 외부 디스플레이가 반드시 있어야 하므로,
 * 이 값이 참이면 "책상에서 쓰는 중" 으로 본다. 덮개를 닫으면 내장 디스플레이는 목록에서
 * 빠지므로 개수가 아니라 **외부가 있는지**로 판정한다.
 */
function hasExternalDisplay(): boolean {
  try {
    return screen.getAllDisplays().some((d) => !d.internal);
  } catch (err) {
    // 판정 실패는 "쓰는 중" 쪽으로 — 끄지 않는 편이 안전하다
    console.warn('[power] 디스플레이 목록을 읽지 못했습니다:', err);
    return true;
  }
}

export type UnattendedVerdict = { unattended: boolean; reason: string };

/**
 * 지금이 "아예 안 쓰는 상태" 인가 — 덮개 닫힘 · 외부 모니터 없음 · 배터리 전원, 셋 다 참일 때만.
 * 하나라도 어긋나면 이유를 담아 거절한다(로그로 어느 조건에 걸렸는지 보인다).
 */
export function judgeUnattended(): UnattendedVerdict {
  if (!powerMonitor.isOnBatteryPower()) {
    return { unattended: false, reason: 'AC 전원 연결됨' };
  }
  if (hasExternalDisplay()) {
    return { unattended: false, reason: '외부 모니터 연결됨' };
  }
  const lid = isLidClosed();
  if (lid !== true) {
    return { unattended: false, reason: lid === null ? '덮개 상태 불명' : '덮개 열림' };
  }
  return { unattended: true, reason: '덮개 닫힘 · 외부 모니터 없음 · 배터리' };
}

/**
 * 잠들기 직전 — 조건이 맞고 블루투스가 **켜져 있을 때만** 끈다.
 * 원래 꺼져 있었다면 아무것도 하지 않는다(깨어날 때 멋대로 켜지 않기 위해).
 */
export function powerOffForSleep(): void {
  const bin = findBlueutil();
  if (!bin) {
    console.warn('[power] blueutil 이 없어 블루투스를 끄지 못했습니다 (brew install blueutil)');
    return;
  }
  const verdict = judgeUnattended();
  if (!verdict.unattended) {
    console.log(`[power] 블루투스 유지 — ${verdict.reason}`);
    return;
  }
  if (readPower(bin) !== true) return; // 이미 꺼져 있거나 못 읽음 → 건드리지 않는다
  // ⚠️ 기록을 **먼저** 남긴다. 끄고 나서 기록하면, 끄기 명령이 타임아웃으로 강제 종료됐는데
  // 전원 변경은 이미 들어간 경우 "꺼짐 + 기록 없음"이 되어 복구 경로가 영영 켜지 않는다
  // (BT 키보드·마우스 먹통). 기록 저장이 실패하면 끄지 않는다 — 켜진 채가 안전한 쪽이다.
  try {
    markBluetoothOff();
  } catch (err) {
    console.warn('[power] 블루투스 기록을 남기지 못해 끄지 않습니다:', err);
    return;
  }
  if (!writePower(bin, false)) {
    // 실패로 보고됐어도 실제로 꺼졌을 수 있다 — 다시 읽어 확실히 켜져 있을 때만 기록을 지운다
    if (readPower(bin) === true) clearBluetoothOff();
    return;
  }
  console.log(`[power] 블루투스를 껐습니다 — ${verdict.reason}`);
}

/** 복구 실패 토스트는 한 장만 — 다음 시도 결과가 같은 자리를 교체한다 */
const TOAST_KEY = 'power-bluetooth-restore';

/**
 * 복귀 — **우리가 끈 경우에만** 되돌린다. 사용자가 직접 꺼둔 블루투스를 켜지 않기 위해
 * 플래그를 근거로 삼는다.
 *
 * ⚠️ 실패하면 플래그를 남긴다 — 다음 기회(완전 복귀·다음 실행)에 다시 시도해야 한다.
 * 입력장치가 안 돌아온 채 조용히 넘어가면 사용자가 원인을 알 수 없다.
 */
export function restoreAfterWake(why: string): void {
  if (restoring || !didWeTurnBluetoothOff()) return;
  const bin = findBlueutil();
  if (!bin) {
    // blueutil 이 사라졌다면 되돌릴 방법이 없다 — 플래그만 정리하고 알린다
    clearBluetoothOff();
    sendToast({
      title: '블루투스를 되돌리지 못했습니다',
      message: 'blueutil 을 찾을 수 없습니다. 제어센터에서 직접 켜 주세요.',
      variant: 'fail',
      sticky: true,
      dedupeKey: TOAST_KEY,
    });
    return;
  }
  restoring = true;
  void attemptRestore(bin, why, 0);
}

/** 한 번 시도하고, 실패하면 간격을 늘려 다시 — 전부 실패해야 사용자에게 알린다 */
async function attemptRestore(bin: string, why: string, attempt: number): Promise<void> {
  // 그 사이 다른 경로가 되돌렸으면(플래그 삭제) 더 볼 것 없다
  if (!didWeTurnBluetoothOff()) {
    restoring = false;
    return;
  }
  if (await writePowerAsync(bin, true)) {
    clearBluetoothOff();
    restoring = false;
    const tried = attempt > 0 ? ` · ${attempt + 1}번째 시도` : '';
    console.log(`[power] 블루투스를 다시 켰습니다 (${why}${tried})`);
    return;
  }
  const next = attempt + 1;
  if (next < RESTORE_RETRY_MS.length) {
    setTimeout(() => void attemptRestore(bin, why, next), RESTORE_RETRY_MS[next]);
    return;
  }
  // 플래그는 남긴다 — 다음 복귀·다음 실행이 한 번 더 시도한다
  restoring = false;
  sendToast({
    title: '블루투스를 다시 켜지 못했습니다',
    message: `${RESTORE_RETRY_MS.length}번 시도했지만 실패했습니다. 제어센터에서 직접 켜 주세요.`,
    variant: 'fail',
    sticky: true,
    dedupeKey: TOAST_KEY,
  });
}

/**
 * 깨어남 직후 — 덮개가 **열렸을 때만** 되돌린다.
 *
 * ⚠️ 덮개가 닫힌 채 깬 것은 다크웨이크다. 거기서 블루투스를 켜면 재연결 루프가 되살아나
 * 이 기능이 막으려던 깨어남 폭주를 그대로 재현한다.
 */
export function restoreIfLidOpened(): void {
  if (!didWeTurnBluetoothOff()) return; // 파일 캐시라 싸다 — ioreg 는 껐을 때만 부른다
  if (isLidClosed() !== false) return;
  restoreAfterWake('덮개 열림');
}
