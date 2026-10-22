// 폰 제어 창(scrcpy) 포커스 — 켜자마자 자동으로(2026-10-21), [포커스] 버튼·전역 단축키로, Dock 타일을 눌러도(2026-10-22 사용자 요청).
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
// 캡처 전 클릭은 폰에 보내지 않고 버튼을 뗄 때 캡처만 켠다).
// - ⚠️ **커서를 원래 자리로 되돌리지 말 것** — SDL3 은 캡처할 때 커서를 창 한가운데로 옮겨 고정하고(`SDL_cocoamouse.m`
//   `Cocoa_SetRelativeMouseMode` — `CGAssociateMouseAndMouseCursorPosition(NO)`), 클릭은 그 고정된 자리로 간다. 되돌렸더니
//   다음 클릭이 커서 아래 다른 창으로 가 포커스를 잃고 캡처가 풀렸다(2026-10-22 사용자 신고 "클릭하면 PC 로 나온다").
// - ⚠️ 이미 맨 앞(쓰는 중)이면 아무것도 안 한다 — 캡처된 창에 클릭하면 그대로 **폰 터치**가 된다(단축키 재입력 = 무동작, 사용자 결정).
// - ⚠️ 단축키 수정키(⌃⌥⌘)에서 손을 뗄 때까지 기다린 뒤 클릭한다 — ⌘-클릭은 뒤 창을 앞으로 가져오지 않고, 수정키가 클릭에 실린다.
// - 켠 뒤 한 번도 포커스를 못 받은 창(launch 포커스 실패)은 scrcpy 가 캡처 상태로 여겨 이 클릭이 폰 터치로 갈 수 있다(드묾).
//
// Dock 타일·⌘Tab — scrcpy 는 포커스를 잃으면 캡처를 풀고 **다시 받아도 다시 잡지 않아** 키보드만 왔다. 그래서 제어 중엔
// **상주 감시기**가 0.25초마다 scrcpy 가 앞으로 왔는지 보고, 창 클릭이 아닌 경로(커서가 창 밖)로 왔으면 main 이
// **왼쪽 ⌘ 를 한 번 합성**한다(capture — scrcpy 의 캡처 토글 키). 실측: 감시기 CPU ≈ 코어 0.4% · 메모리 35MB(JXA), scrcpy 증가분은 오차 수준.
// - 창을 직접 눌러 앞에 온 건 scrcpy 가 이미 잡았다 — ⌘ 는 토글이라 건너뛴다(감시기가 커서 위치로 가린다).
// - **이미 앞인데 ⌘ 로 마우스만 풀어 둔 상태**에서 Dock 타일을 누르면 '앞으로 옴'이 없어 반응이 없었다(사용자 신고) → 왼쪽 클릭
//   누적 카운터(`CGEventSourceCounterForEventType`)가 늘었고 커서 아래 Dock 항목(AX 히트테스트)이 scrcpy 타일이면 같은 신호를 낸다.
//   잡혀 있는 동안엔 커서가 폰 창에 고정돼 Dock 에 닿지 못하므로, 이 클릭은 늘 풀린 상태에서 난다 — ⌘ 토글이 거꾸로 가지 않는다.
// - ⌘ 는 마우스 버튼을 뗀 뒤 친다 — Dock 타일을 누른 채 SDL 이 커서를 옮기면 Dock 이 드래그로 볼 수 있다.
// - 켤 때·버튼·단축키로 가져오는 중엔 감시기 신호를 무시한다(`focusing`) — 그 경로가 이미 잡았는데 ⌘ 를 더하면 풀린다.
// - ⌘ 는 클릭과 달리 잘못 쳐도 캡처가 풀릴 뿐 폰에 터치가 가지 않아 감시기 쪽엔 이걸 쓴다.
import { execFile, spawn, type ChildProcess } from 'node:child_process';

// 두 스크립트 공용 조각
const JXA_COMMON = `
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
const buttonHeld = () => $.CGEventSourceButtonState($.kCGEventSourceStateHIDSystemState, $.kCGMouseButtonLeft);
`;

// argv = [pid, 'launch' | 'manual' | 'capture']. launch 는 창이 뜰 때까지(서버 푸시·연결) 0.2초 간격 최대 8초, manual 은 2초 기다린다
const AX_FOCUS_SCRIPT = `${JXA_COMMON}
// 왼쪽 ⌘ 눌렀다 떼기 — 수정키라 flagsChanged 로 보낸다(0x08 = 왼쪽 ⌘ 장치 비트 — SDL 이 좌우를 이걸로 가린다)
function tapLeftCommand() {
  for (const down of [true, false]) {
    const ev = $.CGEventCreateKeyboardEvent(null, 55, down);
    $.CGEventSetType(ev, $.kCGEventFlagsChanged);
    $.CGEventSetFlags(ev, down ? ($.kCGEventFlagMaskCommand | 0x08) : 0);
    $.CGEventPost($.kCGHIDEventTap, ev);
    delay(0.03);
  }
}
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
  const at = { x: b.X + b.Width / 2, y: b.Y + b.Height / 2 };
  for (const type of [$.kCGEventLeftMouseDown, $.kCGEventLeftMouseUp]) {
    const ev = $.CGEventCreateMouseEvent(null, type, at, $.kCGMouseButtonLeft);
    $.CGEventSetFlags(ev, 0);
    $.CGEventPost($.kCGHIDEventTap, ev);
    delay(0.03);
  }
  let front = false;
  for (let i = 0; i < 20 && !(front = isFront(app)); i++) delay(0.05);
  return front ? 'focused' : 'timeout';
}
// 이미 앞에 온 창의 마우스만 잡는다 — 그사이 다른 앱으로 넘어갔으면 치지 않는다(⌘ 가 그 앱으로 간다)
function capture(app) {
  for (let i = 0; i < 40 && (modsHeld() || buttonHeld()); i++) delay(0.05);
  if (modsHeld() || buttonHeld() || !isFront(app)) return 'timeout';
  tapLeftCommand();
  return 'focused';
}
function run(argv) {
  if (!$.AXIsProcessTrusted()) return 'untrusted';
  const pid = Number(argv[0]);
  const app = $.AXUIElementCreateApplication(pid);
  if (argv[1] === 'manual') return manual(app, pid);
  if (argv[1] === 'capture') return capture(app);
  return launch(app);
}
`;

// 상주 감시기 — argv = [scrcpy pid, Dock pid]. 마우스를 잡아야 할 때 'front' 를 쓴다:
//   ① scrcpy 가 막 앞으로 왔고 커서가 창 밖(Dock 타일·⌘Tab — 창을 눌러 왔으면 scrcpy 가 이미 잡았다)
//   ② 이미 앞인데 그새 왼쪽 클릭이 있었고 커서 아래 Dock 항목이 scrcpy 타일(⌘ 로 마우스만 풀어 둔 상태)
// 읽는 쪽(main)이 사라지면 다음 출력에서 SIGPIPE 로 죽도록 2초마다 '.' 을 쓴다(dock.ts 와 같은 방식).
// ⚠️ 시작 때의 권한을 붙든다 — 권한이 없으면 'untrusted' 를 쓰고 끝난다(다음에 제어를 켤 때 다시 본다).
const WATCH_SCRIPT = `${JXA_COMMON}
function out(s) {
  $.NSFileHandle.fileHandleWithStandardOutput.writeData($(s + '\\n').dataUsingEncoding($.NSUTF8StringEncoding));
}
function text(v) {
  return v ? ObjC.unwrap(ObjC.castRefToObject(v)) : '';
}
const clicks = () => $.CGEventSourceCounterForEventType($.kCGEventSourceStateHIDSystemState, $.kCGEventLeftMouseDown);
function cursor() {
  return $.CGEventGetLocation($.CGEventCreate(null));
}
function inWindow(pid, p) {
  const b = windowBounds(pid);
  return !!b && p.x >= b.X && p.x < b.X + b.Width && p.y >= b.Y && p.y < b.Y + b.Height;
}
// 커서 아래 Dock 항목이 이 앱의 타일인가 — Dock 프로세스 안에서 히트테스트(타일이 없는 자리는 -25212)
function onOwnTile(dock, title, p) {
  if (!dock || !title) return false;
  const ref = Ref();
  if ($.AXUIElementCopyElementAtPosition(dock, p.x, p.y, ref) !== 0) return false;
  return text(attr(ref[0], 'AXSubrole')) === 'AXApplicationDockItem' && text(attr(ref[0], 'AXTitle')) === title;
}
function run(argv) {
  if (!$.AXIsProcessTrusted()) {
    out('untrusted');
    return;
  }
  const pid = Number(argv[0]);
  const app = $.AXUIElementCreateApplication(pid);
  const dock = Number(argv[1]) > 0 ? $.AXUIElementCreateApplication(Number(argv[1])) : null;
  let title = '';
  let prev = isFront(app);
  let downs = clicks();
  for (let tick = 1; ; tick++) {
    const now = isFront(app);
    const d = clicks();
    if (now && !prev) {
      if (!inWindow(pid, cursor())) out('front');
    } else if (now && d !== downs) {
      // 앱 이름은 처음 필요할 때 읽는다 — 감시기를 띄우는 순간엔 scrcpy 가 아직 AX 에 안 올라와 있을 수 있다
      if (!title) title = text(attr(app, 'AXTitle'));
      if (onOwnTile(dock, title, cursor())) out('front');
    } else if (tick % 8 === 0) out('.');
    prev = now;
    downs = d;
    delay(0.25);
  }
}
`;

// SIGTERM 을 받은 scrcpy 깨우기 — 해 없는 이벤트(수정키 없는 flagsChanged)를 그 프로세스에만 보낸다(scrcpy.ts terminate)
const WAKE_SCRIPT = `
ObjC.import('CoreGraphics');
function run(argv) {
  const ev = $.CGEventCreateKeyboardEvent(null, 55, false);
  $.CGEventSetType(ev, $.kCGEventFlagsChanged);
  $.CGEventSetFlags(ev, 0);
  $.CGEventPostToPid(Number(argv[0]), ev);
}
`;

/** 이벤트 하나로 scrcpy 의 이벤트 루프를 돌게 한다 — 앱이 꺼지는 중에도 끝까지 돌도록 main 과 떨어뜨려 띄운다 */
export function wakeProcess(pid: number): void {
  spawn('/usr/bin/osascript', ['-l', 'JavaScript', '-e', WAKE_SCRIPT, String(pid)], {
    detached: true,
    stdio: 'ignore',
  }).unref();
}

/** focused = 앞으로(manual 이면 마우스 캡처까지) · already = 이미 맨 앞이라 손대지 않음 */
export type FocusOutcome = 'focused' | 'already' | 'untrusted' | 'timeout' | 'failed';

const OUTCOMES: readonly FocusOutcome[] = ['focused', 'already', 'untrusted', 'timeout'];

function runFocusScript(pid: number, mode: 'launch' | 'manual' | 'capture'): Promise<FocusOutcome> {
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

// 켤 때·버튼·단축키로 직접 가져오는 중 — 감시기가 본 '앞으로 옴'은 그 경로의 것이라 무시한다(끝난 뒤 1초까지)
let focusing = 0;
let quietUntil = 0;

async function whileFocusing(job: Promise<FocusOutcome>): Promise<FocusOutcome> {
  focusing++;
  try {
    return await job;
  } finally {
    focusing--;
    quietUntil = Date.now() + 1000;
  }
}

/** scrcpy 창이 뜨면 앞으로 가져와 포커스한다 — 결과를 기다리지 않는다(실패해도 제어 자체는 그대로) */
export function focusWhenShown(pid: number | undefined): void {
  if (!pid) return;
  void whileFocusing(runFocusScript(pid, 'launch')).then((r) => {
    if (r === 'timeout') console.warn('[mirror] 제어 창이 8초 안에 안 떠서 포커스를 건너뜀');
  });
}

/** 지금 떠 있는 제어 창을 클릭 합성으로 앞으로 + 마우스 캡처 — [포커스] 버튼·전역 단축키용 */
export function focusControlWindow(pid: number): Promise<FocusOutcome> {
  return whileFocusing(runFocusScript(pid, 'manual'));
}

/**
 * 제어 중 상주 감시 — Dock 타일·⌘Tab 으로 scrcpy 가 앞에 오면(이미 앞이면 Dock 타일을 누르면) 마우스까지 잡게 한다. 돌려준 함수로 내린다.
 * 제어를 켤 때 띄우고 scrcpy 가 끝나면(exit·error·앱 종료) 내린다.
 */
export function watchActivation(pid: number): () => void {
  let stopped = false;
  let p: ChildProcess | null = null;
  // Dock pid — 이미 앞일 때 타일 클릭을 가리는 데만 쓴다(못 찾으면 그 경우만 빠진다)
  execFile('/usr/bin/pgrep', ['-x', 'Dock'], (_err, stdout) => {
    if (stopped) return;
    const dockPid = Number(String(stdout).trim().split('\n')[0]) || 0;
    const proc = spawn('/usr/bin/osascript', ['-l', 'JavaScript', '-e', WATCH_SCRIPT, String(pid), String(dockPid)], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    p = proc;
    let buf = '';
    proc.stdout?.setEncoding('utf8');
    proc.stdout?.on('data', (chunk: string) => {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line === 'untrusted') console.warn('[mirror] 접근성 권한이 없어 Dock 클릭 마우스 캡처를 건너뜀');
        else if (line === 'front' && !focusing && Date.now() >= quietUntil) void runFocusScript(pid, 'capture');
      }
    });
    proc.on('error', (err) => console.warn('[mirror] 포커스 감시를 띄우지 못함:', err.message));
  });
  return () => {
    stopped = true;
    if (p && p.exitCode === null) p.kill();
  };
}
