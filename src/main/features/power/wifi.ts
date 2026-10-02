// 잠잘 때 Wi-Fi 끄기 — networksetup 드라이버. 끄고 되돌리는 순서·조건은 radioSwitch.ts · unattended.ts.
//
// 배경(2026-10-02 확정, 규칙 문서 참고): 블루투스를 끈 뒤에도 덮개 닫힘 9시간 동안 Wi-Fi 수신 패킷으로
// 4176번 깼다(깨어 있던 비율 71% · 배터리 54→39%). airportd 가 남긴 깨운 패킷의 77% 가 **공유기의 ARP 응답**
// 이었다 — 맥 안의 프로세스(femc Claude 세션의 `mcp-oracle-database`)가 닿지 않는 사내 DB 에 15초마다
// 재접속을 시도해 깰 때마다 ARP 를 내보내고, 그 응답이 다시 잠든 맥을 깨우는 연쇄다. 재시도하는 프로세스는
// 앞으로도 바뀌므로(로컬 서버·DB 클라이언트 등) 프로세스가 아니라 Wi-Fi 를 끊어 연쇄를 막는다.
import { execFileSync } from 'node:child_process';
import { createRadioSwitch, EXEC_TIMEOUT_MS } from './radioSwitch';

/** GUI 로 뜬 Electron 의 PATH 를 믿지 않고 절대 경로로 부른다 */
const NETWORKSETUP = '/usr/sbin/networksetup';

/**
 * Wi-Fi 장치 이름(en0 등) — `-listallhardwareports` 에서 "Hardware Port: Wi-Fi" 바로 다음 줄의 Device.
 *
 * ⚠️ **장치 이름을 짐작해 넘기지 말 것.** `networksetup -setairportpower <Wi-Fi 가 아닌 이름> off` 는
 * 실패하지 않고 "Turning off the only airport interface found: en0" 를 찍으며 **진짜 Wi-Fi 를 끈다**
 * (exit 0 — 2026-10-02 실측, 오류 동작을 보려다 사용자 Wi-Fi 를 꺼 버렸다). 목록에서 정확히 찾고,
 * 못 찾으면 아무것도 하지 않는다.
 */
function findWifiDevice(): string | null {
  try {
    const out = execFileSync(NETWORKSETUP, ['-listallhardwareports'], {
      timeout: EXEC_TIMEOUT_MS,
      encoding: 'utf8',
    });
    // 옛 macOS 는 포트 이름이 AirPort 다
    const m = out.match(/^Hardware Port: (?:Wi-Fi|AirPort)\r?\nDevice: (en\d+)\s*$/m);
    return m ? m[1] : null;
  } catch (err) {
    console.warn('[power] Wi-Fi 장치를 찾지 못했습니다:', err);
    return null;
  }
}

/**
 * 목록에서 찾은 장치 이름 — 프로세스 동안 기억한다.
 * ⚠️ 깨어나는 순간에는 configd 가 장치를 열거하느라 `networksetup` 이 몇 초 붙잡힐 수 있다(규칙 문서 실측).
 * 복구 때 목록 조회가 한 번 타임아웃 나면 "장치 없음"으로 끝나 끈 기록까지 지워지므로, 끌 때 찾은 이름을
 * 그대로 쓴다. 짐작한 이름이 아니라 목록에서 찾은 값이라 위 ⚠️ 와 어긋나지 않는다.
 */
let wifiDevice: string | null = null;

export const wifiSwitch = createRadioSwitch({
  kind: 'wifi',
  label: 'Wi-Fi',
  locate: () => {
    const dev = (wifiDevice ??= findWifiDevice());
    if (!dev) return null;
    return {
      bin: NETWORKSETUP,
      readArgs: ['-getairportpower', dev],
      // `Wi-Fi Power (en0): On`
      parse: (out) => {
        const m = out.match(/\):\s*(On|Off)\s*$/m);
        return m ? m[1] === 'On' : null;
      },
      writeArgs: (on) => ['-setairportpower', dev, on ? 'on' : 'off'],
      // ⚠️ 종료 코드를 믿을 수 없다(엉뚱한 인자에도 exit 0) — 쓰고 나서 다시 읽어 확인한다
      verifyWrite: true,
    };
  },
  missingLog: 'Wi-Fi 장치를 찾지 못해 Wi-Fi를 끄지 않습니다',
  missingToast: 'Wi-Fi 장치를 찾을 수 없습니다. 제어센터에서 직접 켜 주세요.',
});
