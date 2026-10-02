// "아예 안 쓰는 상태(= 가방 안)" 판정 — 잠잘 때 무선(블루투스·Wi-Fi)을 꺼도 되는지의 근거.
//
// ⚠️ **이 판정이 무선 끄기 기능의 핵심이다.** 덮개를 닫고 외부 모니터로 계속 쓰는 클램셸 사용 중에
// 껐다가는 블루투스 키보드·마우스로 맥을 깨울 수 없게 되고, Wi-Fi 도 책상에서 쓰던 연결이 끊긴다.
// 그래서 "안 쓰는 상태" 를 세 조건의 AND 로만 인정한다 — 하나라도 어긋나면 건드리지 않는다.
import { execFileSync } from 'node:child_process';
import { powerMonitor, screen } from 'electron';

/** 덮개 상태를 읽는 ioreg — GUI 로 뜬 Electron 의 PATH 를 믿지 않고 절대 경로로 부른다 */
const IOREG = '/usr/sbin/ioreg';

// ⚠️ 잠들기 직전(suspend 핸들러)에 동기로 부르므로 짧게 끊는다 — ioreg 는 정상이면 수십 ms 다
const EXEC_TIMEOUT_MS = 3_000;

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
