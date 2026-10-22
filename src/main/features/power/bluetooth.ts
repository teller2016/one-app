// 잠잘 때 블루투스 끄기 — blueutil 드라이버. 끄고 되돌리는 순서·조건은 radioSwitch.ts · unattended.ts.
//
// 배경(2026-09-20 확정, 규칙 문서 참고): 덮개를 닫아 HID 가 끊기면 bluetoothd 가 그 장치들에
// 재연결을 건 채(`HIDProfile::startHIDAutoConnect`) 잠들고, Wi-Fi/BT 콤보 칩이 저전력 진입에
// 실패해(`centaurid` `Controller-S2REntry`) 맥을 깨운다. 깨면 BLE 주소가 바뀌어 처음부터 반복 —
// 하루 200회 넘는 다크웨이크의 원인이다. 잠들기 전에 블루투스를 꺼서 재연결 대상을 없앤다.
import fs from 'node:fs';
import { createRadioSwitch } from './radioSwitch';

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

export const bluetoothSwitch = createRadioSwitch({
  kind: 'bluetooth',
  label: '블루투스',
  locate: () => {
    const bin = findBlueutil();
    if (!bin) return null;
    return {
      bin,
      readArgs: ['-p'],
      parse: (out) => out.trim() === '1',
      writeArgs: (on) => ['-p', on ? '1' : '0'],
    };
  },
  missingLog: 'blueutil 이 없어 블루투스를 끄지 않습니다 (brew install blueutil)',
  missingToast: 'blueutil 을 찾을 수 없습니다. 제어센터에서 직접 켜 주세요.',
  // ⚠️ blueutil 은 One App 이 띄우므로 블루투스 권한(TCC)은 **One App 의 코드 서명**에 묶인다. 서명 주체가 바뀌면
  // (2026-10-21 자가서명 → Apple Development) 옛 허용이 맞지 않아 권한 창이 다시 뜨고, 잠들기 직전엔 화면이 꺼져
  // 아무도 답하지 못한 채 타임아웃 난다(tccd `Failed to match existing code requirement … kTCCServiceBluetoothAlways`)
  offFailHint:
    '시스템 설정 → 개인정보 보호 및 보안 → 블루투스에서 One App 이 허용돼 있는지 확인하세요(앱 서명이 바뀌면 다시 허용해야 합니다).',
});
