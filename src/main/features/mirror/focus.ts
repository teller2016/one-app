// 폰 제어 창(scrcpy) 포커스 — 켜자마자 자동으로(2026-10-21), 그리고 [포커스] 버튼·전역 단축키로(2026-10-22 사용자 요청).
//
// scrcpy 는 앱이 백그라운드로 띄운 별도 프로세스라 스스로 앞으로 오지 못한다(최근 macOS 의 협조적 활성화 —
// 활성 앱이 넘겨주지 않으면 거절된다). 권한은 독 터미널의 독 너비 실측과 같은 **접근성(AX)** 이다(terminal-dock 규칙).
// - 권한이 없으면 아무것도 안 한다 — 예전처럼 창을 눌러 쓴다.
// - ⚠️ AX 속성 이름은 NSString(`$('AXWindows')`)으로 — JS 문자열이면 -25201(dock.ts 실측).
//
// 켤 때(launch) — AX 로 `AXFrontmost`·`AXMain`·`AXRaise`. 활성 앱(One App)이 방금 띄운 프로세스라 허용된다.
//
// 나중에(manual — 버튼·단축키) — **창 한가운데 클릭을 합성**한다. ⚠️ 같은 AX 요청은 이때 거절된다(2026-10-22 실측,
// WindowServer: `CPS: Denying scrcpy the right to be in front because it is not in the list of permittedFrontASNs`).
// 클릭은 WindowServer 가 직접 앞으로 가져오므로 막히지 않고, scrcpy 는 클릭을 받으면 마우스까지 잡는다(v4.0 `mouse_capture.c` —
// 캡처 전 클릭은 폰에 보내지 않고 버튼을 뗄 때 캡처만 켠다). 커서는 클릭 뒤 원래 자리로 되돌린다(캡처를 풀면 그 자리에 나타난다).
// - ⚠️ 이미 맨 앞(쓰는 중)이면 아무것도 안 한다 — 캡처된 창에 클릭하면 그대로 **폰 터치**가 된다(단축키 재입력 = 무동작, 사용자 결정).
// - ⚠️ 단축키 수정키(⌃⌥⌘)에서 손을 뗄 때까지 기다린 뒤 클릭한다 — ⌘-클릭은 뒤 창을 앞으로 가져오지 않고, 수정키가 클릭에 실린다.
// - 켠 뒤 한 번도 포커스를 못 받은 창(launch 포커스 실패)은 scrcpy 가 캡처 상태로 여겨 이 클릭이 폰 터치로 갈 수 있다(드묾).
import { execFile } from 'node:child_process';

// argv = [pid, 'launch' | 'manual']. launch 는 창이 뜰 때까지(서버 푸시·연결) 0.2초 간격 최대 8초, manual 은 2초 기다린다
const AX_FOCUS_SCRIPT = `
ObjC.import('ApplicationServices');
ObjC.import('CoreGraphics');
ObjC.import('Foundation');
function attr(el, name) {
  const ref = Ref();
  return $.AXUIElementCopyAttributeValue(el, $(name), ref) === 0 ? ref[0] : null;
}
function isFront(app) {
  const v = attr(app, 'AXFrontmost');
  return v ? ObjC.deepUnwrap(ObjC.castRefToObject(v)) === true : false;
}
function windowBounds(pid) {
  const list = ObjC.deepUnwrap(
    ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly, 0))
  );
  const w = list.find((x) => x.kCGWindowOwnerPID === pid);
  return w ? w.kCGWindowBounds : null;
}
// ⇧ ⌃ ⌥ ⌘ (Caps Lock 제외)
const MODS = 0x1e0000;
const modsHeld = () => $.CGEventSourceFlagsState($.kCGEventSourceStateHIDSystemState) & MODS;
function launch(app) {
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
function manual(app, pid) {
  if (isFront(app)) return 'already';
  let b = null;
  for (let i = 0; i < 10 && !(b = windowBounds(pid)); i++) delay(0.2);
  if (!b) return 'timeout';
  for (let i = 0; i < 40 && modsHeld(); i++) delay(0.05);
  if (modsHeld()) return 'timeout';
  const back = $.CGEventGetLocation($.CGEventCreate(null));
  const at = { x: b.X + b.Width / 2, y: b.Y + b.Height / 2 };
  for (const type of [$.kCGEventLeftMouseDown, $.kCGEventLeftMouseUp]) {
    const ev = $.CGEventCreateMouseEvent(null, type, at, $.kCGMouseButtonLeft);
    $.CGEventSetFlags(ev, 0);
    $.CGEventPost($.kCGHIDEventTap, ev);
    delay(0.03);
  }
  let front = false;
  for (let i = 0; i < 20 && !(front = isFront(app)); i++) delay(0.05);
  delay(0.1);
  $.CGWarpMouseCursorPosition(back);
  return front ? 'focused' : 'timeout';
}
function run(argv) {
  if (!$.AXIsProcessTrusted()) return 'untrusted';
  const pid = Number(argv[0]);
  const app = $.AXUIElementCreateApplication(pid);
  return argv[1] === 'manual' ? manual(app, pid) : launch(app);
}
`;

/** focused = 앞으로(manual 이면 마우스 캡처까지) · already = 이미 맨 앞이라 손대지 않음 */
export type FocusOutcome = 'focused' | 'already' | 'untrusted' | 'timeout' | 'failed';

const OUTCOMES: readonly FocusOutcome[] = ['focused', 'already', 'untrusted', 'timeout'];

function runFocusScript(pid: number, mode: 'launch' | 'manual'): Promise<FocusOutcome> {
  return new Promise((resolve) => {
    execFile(
      '/usr/bin/osascript',
      ['-l', 'JavaScript', '-e', AX_FOCUS_SCRIPT, String(pid), mode],
      { timeout: 15_000 },
      (err, stdout) => {
        if (err) {
          console.warn('[mirror] 제어 창 포커스 실패:', err.message);
          resolve('failed');
          return;
        }
        const out = String(stdout).trim() as FocusOutcome;
        resolve(OUTCOMES.includes(out) ? out : 'failed');
      }
    );
  });
}

/** scrcpy 창이 뜨면 앞으로 가져와 포커스한다 — 결과를 기다리지 않는다(실패해도 제어 자체는 그대로) */
export function focusWhenShown(pid: number | undefined): void {
  if (!pid) return;
  void runFocusScript(pid, 'launch').then((r) => {
    if (r === 'timeout') console.warn('[mirror] 제어 창이 8초 안에 안 떠서 포커스를 건너뜀');
  });
}

/** 지금 떠 있는 제어 창을 클릭 합성으로 앞으로 + 마우스 캡처 — [포커스] 버튼·전역 단축키용 */
export function focusControlWindow(pid: number): Promise<FocusOutcome> {
  return runFocusScript(pid, 'manual');
}
