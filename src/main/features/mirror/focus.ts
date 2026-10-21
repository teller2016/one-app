// 폰 제어 창(scrcpy) 자동 포커스 — 제어를 켜자마자 키보드가 폰으로 가게(2026-10-21 사용자 요청).
//
// scrcpy 는 앱이 백그라운드로 띄운 별도 프로세스라 스스로 앞으로 오지 못한다(최근 macOS 의 협조적 활성화 —
// 활성 앱이 넘겨주지 않으면 거절된다). 그래서 **접근성(AX) 권한**으로 그 프로세스를 맨 앞(AXFrontmost)에 두고
// 창을 주 창·맨 위로 올린다. 권한은 독 터미널의 독 너비 실측과 같은 것이다(terminal-dock 규칙).
// - 권한이 없으면 아무것도 안 한다 — 예전처럼 창을 눌러 쓴다.
// - 마우스는 scrcpy 규칙상 창을 한 번 눌러야 잡힌다(uhid 마우스 캡처) — 포커스와 별개다.
// - ⚠️ AX 속성 이름은 NSString(`$('AXWindows')`)으로 — JS 문자열이면 -25201(dock.ts 실측).
import { execFile } from 'node:child_process';

// 창이 뜰 때까지(서버 푸시·연결) 0.2초 간격 최대 8초 기다린 뒤 한 번만 올린다
const AX_FOCUS_SCRIPT = `
ObjC.import('ApplicationServices');
ObjC.import('Foundation');
function attr(el, name) {
  const ref = Ref();
  return $.AXUIElementCopyAttributeValue(el, $(name), ref) === 0 ? ref[0] : null;
}
function run(argv) {
  if (!$.AXIsProcessTrusted()) return 'untrusted';
  const app = $.AXUIElementCreateApplication(Number(argv[0]));
  const yes = $.NSNumber.numberWithBool(true);
  for (let i = 0; i < 40; i++) {
    const wins = attr(app, 'AXWindows');
    const arr = wins ? ObjC.castRefToObject(wins) : null;
    if (arr && Number(arr.count) > 0) {
      const win = arr.objectAtIndex(0);
      $.AXUIElementSetAttributeValue(app, $('AXFrontmost'), yes);
      $.AXUIElementSetAttributeValue(win, $('AXMain'), yes);
      $.AXUIElementPerformAction(win, $('AXRaise'));
      return 'focused';
    }
    delay(0.2);
  }
  return 'timeout';
}
`;

/** scrcpy 창이 뜨면 앞으로 가져와 포커스한다 — 결과를 기다리지 않는다(실패해도 제어 자체는 그대로) */
export function focusWhenShown(pid: number | undefined): void {
  if (!pid) return;
  execFile(
    '/usr/bin/osascript',
    ['-l', 'JavaScript', '-e', AX_FOCUS_SCRIPT, String(pid)],
    { timeout: 15_000 },
    (err, stdout) => {
      if (err) console.warn('[mirror] 제어 창 포커스 실패:', err.message);
      else if (String(stdout).trim() === 'timeout')
        console.warn('[mirror] 제어 창이 8초 안에 안 떠서 포커스를 건너뜀');
    }
  );
}
