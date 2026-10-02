// 잠잘 때 무선(블루투스·Wi-Fi) 끄기 공통 흐름 — "가방 안" 일 때만 끄고, 사람이 덮개를 열면 되돌린다.
//
// 장치별 차이(무슨 명령으로 읽고 쓰는지)는 드라이버(bluetooth.ts·wifi.ts)가 맡고, 여기에는 둘이
// 똑같이 지켜야 하는 순서만 둔다 — 끄기: 조건 판정 → 켜져 있을 때만 → **기록 먼저** → 끄기,
// 되돌리기: **우리가 끈 것만** · 다크웨이크가 아니라 **덮개가 열렸을 때만** · 재시도하며 켜기.
import { execFile, execFileSync, type ChildProcess } from 'node:child_process';
import { sendToast } from '../notify/notify';
import { clearRadioOff, didWeTurnRadioOff, markRadioOff, type RadioKind } from './store';
import { isLidClosed, type UnattendedVerdict } from './unattended';

// ⚠️ 잠들기 직전(suspend 핸들러)에 동기로 부르므로 짧게 끊는다. 비동기로 미루면
// 맥이 먼저 잠들어 결과를 못 받는다 — blueutil·networksetup 은 정상이면 수십 ms 다.
export const EXEC_TIMEOUT_MS = 3_000;

/**
 * 복구 재시도 간격(ms) — ⚠️ **한 번만 시도하면 안 된다.**
 * 2026-09-22 실측: `resume` 직후 블루투스 첫 시도가 실패했다(평상시 같은 명령은 성공한다). 깨어나는
 * 중에는 무선 스택이 아직 준비되지 않는다. 여기서 포기하면 장치가 안 돌아온 채 방치된다.
 */
const RESTORE_RETRY_MS = [0, 1_000, 3_000, 7_000];

/** 무선 전원을 읽고 쓰는 명령 — 드라이버가 그때그때 찾아 돌려준다 */
export interface RadioCommand {
  bin: string;
  readArgs: string[];
  /** 읽은 출력 해석 — 켜짐 true / 꺼짐 false / 모름 null */
  parse(stdout: string): boolean | null;
  writeArgs(on: boolean): string[];
  /**
   * 쓰고 나서 다시 읽어 확인할지 — 종료 코드를 믿을 수 없는 명령용.
   * (`networksetup -setairportpower` 는 엉뚱한 인자에도 exit 0 이다)
   */
  verifyWrite?: boolean;
}

export interface RadioDriver {
  kind: RadioKind;
  /** 로그·토스트에 쓰는 이름 — '블루투스' · 'Wi-Fi' (둘 다 '를' 이 붙는다) */
  label: string;
  /** 명령을 찾는다 — 도구가 없거나 장치를 못 찾으면 null */
  locate(): RadioCommand | null;
  /** 끄려는데 명령이 없을 때 남길 경고 */
  missingLog: string;
  /** 되돌리려는데 명령이 없을 때 토스트 본문 */
  missingToast: string;
}

export interface RadioSwitch {
  /**
   * 잠들기 직전 — 조건이 맞고 켜져 있을 때만 끈다.
   * 판정(`judgeUnattended` — ioreg 동기 실행)은 호출부가 한 번 해서 장치마다 나눠 준다.
   */
  powerOffForSleep(verdict: UnattendedVerdict): void;
  /**
   * 잠들기 시작 — 진행 중인 복구(재시도 타이머·켜기 명령)를 거둔다. 토글과 무관하게 부른다.
   * ⚠️ 안 거두면 덮개를 열었다 곧 다시 닫았을 때 남은 재시도가 다음 다크웨이크에서 장치를 켜고(재연결 루프·
   * ARP 연쇄 재현), 잠들기와 엇갈린 켜기 결과가 방금 남긴 "껐다" 기록을 지워 아침에 복구가 안 된다.
   */
  cancelRestore(): void;
  /** 복귀 — 우리가 끈 경우에만 되돌린다 */
  restoreAfterWake(why: string): void;
  /** 깨어남 직후 — 덮개가 열렸을 때만 되돌린다 */
  restoreIfLidOpened(): void;
}

export function createRadioSwitch(d: RadioDriver): RadioSwitch {
  /** 복구 재시도가 도는 중인가 — resume 과 fullWake 가 연달아 불러 중복 실행되는 것을 막는다 */
  let restoring = false;
  /** 복구 세대 — cancelRestore 가 올린다. 늦게 끝난 시도는 자기 세대가 아니면 아무것도 하지 않는다 */
  let restoreGen = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** 진행 중인 켜기 명령 — 잠들기 시작하면 죽인다(잠든 뒤에 켜지지 않게) */
  let inflight: ChildProcess | null = null;
  /** 복구 실패 토스트는 장치마다 한 장만 — 다음 시도 결과가 같은 자리를 교체한다 */
  const toastKey = `power-${d.kind}-restore`;

  /** 전원 상태 — 켜짐 true / 꺼짐 false / 못 읽음 null */
  function readPower(cmd: RadioCommand): boolean | null {
    try {
      const out = execFileSync(cmd.bin, cmd.readArgs, {
        timeout: EXEC_TIMEOUT_MS,
        encoding: 'utf8',
      });
      return cmd.parse(out);
    } catch (err) {
      console.warn(`[power] ${d.label} 상태를 읽지 못했습니다:`, err);
      return null;
    }
  }

  /** 전원 켜기/끄기 — 성공 여부를 돌려준다 */
  function writePower(cmd: RadioCommand, on: boolean): boolean {
    try {
      execFileSync(cmd.bin, cmd.writeArgs(on), { timeout: EXEC_TIMEOUT_MS });
    } catch (err) {
      console.warn(`[power] ${d.label}를 ${on ? '켜지' : '끄지'} 못했습니다:`, err);
      return false;
    }
    if (!cmd.verifyWrite || readPower(cmd) === on) return true;
    console.warn(`[power] ${d.label}를 ${on ? '켜는' : '끄는'} 명령은 성공했지만 상태가 바뀌지 않았습니다`);
    return false;
  }

  /** 켜기(비동기) — 복구 경로 전용. 잠들기 직전이 아니라 main 을 멈출 이유가 없다 */
  function writePowerAsync(cmd: RadioCommand, on: boolean): Promise<boolean> {
    return new Promise((resolve) => {
      const child = execFile(cmd.bin, cmd.writeArgs(on), { timeout: EXEC_TIMEOUT_MS }, (err) => {
        if (inflight === child) inflight = null;
        if (err) {
          console.warn(`[power] ${d.label}를 ${on ? '켜지' : '끄지'} 못했습니다:`, err);
          resolve(false);
          return;
        }
        if (!cmd.verifyWrite) {
          resolve(true);
          return;
        }
        // 확인 읽기는 동기지만 짧다(수십 ms) — 복구 경로라 잠들기 직전 제약도 없다
        resolve(readPower(cmd) === on);
      });
      inflight = child;
    });
  }

  /**
   * 잠들기 직전 — 조건이 맞고 **켜져 있을 때만** 끈다.
   * 원래 꺼져 있었다면 아무것도 하지 않는다(깨어날 때 멋대로 켜지 않기 위해).
   */
  function powerOffForSleep(verdict: UnattendedVerdict): void {
    // 판정이 먼저다 — 책상(AC·외부 모니터) 상태에서는 장치 찾기 명령도 돌릴 필요가 없다
    if (!verdict.unattended) {
      console.log(`[power] ${d.label} 유지 — ${verdict.reason}`);
      return;
    }
    const cmd = d.locate();
    if (!cmd) {
      console.warn(`[power] ${d.missingLog}`);
      return;
    }
    if (readPower(cmd) !== true) return; // 이미 꺼져 있거나 못 읽음 → 건드리지 않는다
    // ⚠️ 기록을 **먼저** 남긴다. 끄고 나서 기록하면, 끄기 명령이 타임아웃으로 강제 종료됐는데
    // 전원 변경은 이미 들어간 경우 "꺼짐 + 기록 없음"이 되어 복구 경로가 영영 켜지 않는다
    // (BT 키보드·마우스 먹통 · Wi-Fi 끊김). 기록 저장이 실패하면 끄지 않는다 — 켜진 채가 안전한 쪽이다.
    try {
      markRadioOff(d.kind);
    } catch (err) {
      console.warn(`[power] ${d.label} 기록을 남기지 못해 끄지 않습니다:`, err);
      return;
    }
    if (!writePower(cmd, false)) {
      // 실패로 보고됐어도 실제로 꺼졌을 수 있다 — 다시 읽어 확실히 켜져 있을 때만 기록을 지운다
      if (readPower(cmd) === true) clearRadioOff(d.kind);
      return;
    }
    console.log(`[power] ${d.label}를 껐습니다 — ${verdict.reason}`);
  }

  /**
   * 복귀 — **우리가 끈 경우에만** 되돌린다. 사용자가 직접 꺼둔 장치를 켜지 않기 위해
   * 플래그를 근거로 삼는다.
   *
   * ⚠️ 실패하면 플래그를 남긴다 — 다음 기회(완전 복귀·다음 실행)에 다시 시도해야 한다.
   * 장치가 안 돌아온 채 조용히 넘어가면 사용자가 원인을 알 수 없다.
   */
  function restoreAfterWake(why: string): void {
    if (restoring || !didWeTurnRadioOff(d.kind)) return;
    const cmd = d.locate();
    if (!cmd) {
      // 명령이 사라졌다면 되돌릴 방법이 없다 — 플래그만 정리하고 알린다
      clearRadioOff(d.kind);
      sendToast({
        title: `${d.label}를 되돌리지 못했습니다`,
        message: d.missingToast,
        variant: 'fail',
        sticky: true,
        dedupeKey: toastKey,
      });
      return;
    }
    restoring = true;
    void attemptRestore(cmd, why, 0, restoreGen);
  }

  function cancelRestore(): void {
    restoreGen++;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    inflight?.kill();
    inflight = null;
    restoring = false; // 기록은 그대로 — 다음 복귀가 처음부터 다시 시도한다
  }

  /** 한 번 시도하고, 실패하면 간격을 늘려 다시 — 전부 실패해야 사용자에게 알린다 */
  async function attemptRestore(cmd: RadioCommand, why: string, attempt: number, gen: number): Promise<void> {
    retryTimer = null;
    if (gen !== restoreGen) return; // 그 사이 잠들기 시작했다 — cancelRestore 가 정리했다
    try {
      // 그 사이 다른 경로가 되돌렸으면(플래그 삭제) 더 볼 것 없다
      if (!didWeTurnRadioOff(d.kind)) {
        restoring = false;
        return;
      }
      const ok = await writePowerAsync(cmd, true);
      // ⚠️ 켜는 사이 잠들기가 시작됐으면 결과로 기록을 건드리지 않는다 — 잠들기(powerOffForSleep)가 방금 남긴
      // "껐다" 기록을 여기서 지우면 장치는 꺼졌는데 복구 근거가 없어진다
      if (gen !== restoreGen) return;
      if (ok) {
        clearRadioOff(d.kind);
        restoring = false;
        const tried = attempt > 0 ? ` · ${attempt + 1}번째 시도` : '';
        console.log(`[power] ${d.label}를 다시 켰습니다 (${why}${tried})`);
        return;
      }
    } catch (err) {
      // 기록 파일 쓰기 실패 등 — restoring 이 묶이면 이 프로세스의 복구가 전부 막힌다
      console.warn(`[power] ${d.label} 복구 중 오류:`, err);
      restoring = false;
      return;
    }
    const next = attempt + 1;
    if (next < RESTORE_RETRY_MS.length) {
      retryTimer = setTimeout(() => void attemptRestore(cmd, why, next, gen), RESTORE_RETRY_MS[next]);
      return;
    }
    // 플래그는 남긴다 — 다음 복귀·다음 실행이 한 번 더 시도한다
    restoring = false;
    sendToast({
      title: `${d.label}를 다시 켜지 못했습니다`,
      message: `${RESTORE_RETRY_MS.length}번 시도했지만 실패했습니다. 제어센터에서 직접 켜 주세요.`,
      variant: 'fail',
      sticky: true,
      dedupeKey: toastKey,
    });
  }

  /**
   * 깨어남 직후 — 덮개가 **열렸을 때만** 되돌린다.
   *
   * ⚠️ 덮개가 닫힌 채 깬 것은 다크웨이크다. 거기서 켜면 블루투스는 재연결 루프가, Wi-Fi 는
   * ARP 응답 연쇄가 되살아나 이 기능이 막으려던 깨어남 폭주를 그대로 재현한다.
   */
  function restoreIfLidOpened(): void {
    if (!didWeTurnRadioOff(d.kind)) return; // 파일 캐시라 싸다 — ioreg 는 껐을 때만 부른다
    if (isLidClosed() !== false) return;
    restoreAfterWake('덮개 열림');
  }

  return { powerOffForSleep, cancelRestore, restoreAfterWake, restoreIfLidOpened };
}
