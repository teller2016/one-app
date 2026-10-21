// 독 패널 — macOS 독 오른쪽 빈자리에 붙는 작은 터미널 창(2026-10-21).
//
// 역할 분담: **어느 세션을 보여 주나(배정)는 windows.ts 의 'dock' 항목이 정본**이고, 여기는
// 창 자체만 맡는다 — 패널 창 생성 · 독 자리 계산 · 접힘/펼침 · 독 너비 실측 · 수동 경계 저장.
// (windows.ts 가 이 모듈을 import 한다 — 반대 방향 import 는 두지 않는다)
//
// 접힘/펼침: 포커스만으로는 펼치지 않는다(2026-10-21 사용자 결정 — 접힌 채로도 입력한다).
// 패널 안 ⌘↑ 로 위로 펼치고(기본 EXPANDED_H, 윗변을 끌면 기억) ⌘↓ 또는 포커스를 잃으면 독 높이로 접는다.
// 글꼴은 접힘·펼침이 같다(사용자 요청) — 펼치면 줄 수만 는다.
// ⚠️ Esc 로 접지 않는다 — Esc 는 claude 의 작업 중단 키라 패널이 가로채면 안 된다.
import path from 'node:path';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { app, BrowserWindow, ipcMain, screen, systemPreferences } from 'electron';
import type { Rectangle } from 'electron';
import type { TerminalDockState } from '../../../shared/types';
import { broadcast } from '../../lib/broadcast';
import { IS_DEV_INSTANCE } from '../../lib/devInstance';
import { DOCK_GAP as GAP, DOCK_INSET_Y as INSET_Y, findDockSpot } from '../../lib/macDock';
import { readUserJson, writeUserJson } from '../../lib/store';

// 화면 취향(경계 위치)이라 개발 인스턴스와 공유한다 — 세션 배정(runtimeFile)과 다르다
const PREFS_FILE = 'terminal-dock.json';
type DockPrefs = { leftRatio?: number; expandedHeight?: number };

/** 펼친 높이 기본값 — 펼친 상태에서 윗변을 끌어 바꾸면 expandedHeight 로 기억한다 */
const EXPANDED_H = 320;
const EXPANDED_MIN_H = 120;
const MIN_W = 280;
/** 독이 아래에 없을 때(자동 숨김·좌우 배치) 화면 오른쪽 아래에 띄울 크기 */
const FLOATING = { width: 520, height: 44 };
/** 수동 경계 기본값(독 띠 폭 대비) — 가운데 정렬된 독의 오른쪽 끝 언저리 */
const DEFAULT_LEFT_RATIO = 0.66;

let win: BrowserWindow | null = null;
let expanded = false;
let quitting = false;

// ── 독 너비 실측 — 접근성(AX) 권한이 있으면 Dock 프로세스의 아이콘 목록(AXList) 프레임을 읽는다 ──
// 창 목록 API(CGWindowList)로는 독 창이 화면 전체로 잡혀 쓸 수 없다(2026-10-21 실측: 1512×982).
// AX 는 osascript(JXA) 상주 프로세스 하나로 1초마다 묻는다 — 패널이 떠 있을 때만 돈다.
// 읽는 쪽(main)이 사라지면 다음 출력에서 SIGPIPE 로 죽도록 매 틱 '.' 을 쓴다(실측: 0.3초 안에 종료).
let axTrusted: boolean | null = null; // null = 아직 모름
let dockFrame: Rectangle | null = null;
let watcher: ChildProcess | null = null;
let watchGen = 0;
let quickFailures = 0;

// ⚠️ AX 속성 이름은 JS 문자열이 아니라 NSString(`$('AXChildren')`)으로 넘겨야 한다 —
// 문자열을 그대로 주면 kAXErrorIllegalArgument(-25201)다(2026-10-21 실측).
// AXValue(점·크기)는 JXA 에서 구조체로 풀 수 없어 description("x:85.0 y:932.0")을 파싱한다.
const AX_SCRIPT = `
ObjC.import('ApplicationServices');
ObjC.import('Foundation');
function out(s) {
  $.NSFileHandle.fileHandleWithStandardOutput.writeData($(s + '\\n').dataUsingEncoding($.NSUTF8StringEncoding));
}
function attr(el, name) {
  const ref = Ref();
  return $.AXUIElementCopyAttributeValue(el, $(name), ref) === 0 ? ref[0] : null;
}
function num(desc, key) {
  const m = new RegExp(key + ':(-?[0-9.]+)').exec(desc);
  return m ? Number(m[1]) : NaN;
}
function frame(dock) {
  const kids = attr(dock, 'AXChildren');
  if (!kids) return null;
  const arr = ObjC.castRefToObject(kids);
  const n = Number(arr.count);
  for (let i = 0; i < n; i++) {
    const el = arr.objectAtIndex(i);
    const role = attr(el, 'AXRole');
    if (!role || ObjC.unwrap(ObjC.castRefToObject(role)) !== 'AXList') continue;
    const pos = attr(el, 'AXPosition');
    const size = attr(el, 'AXSize');
    if (!pos || !size) return null;
    const p = ObjC.unwrap(ObjC.castRefToObject(pos).description);
    const s = ObjC.unwrap(ObjC.castRefToObject(size).description);
    return { x: num(p, 'x'), y: num(p, 'y'), width: num(s, 'w'), height: num(s, 'h') };
  }
  return null;
}
function run(argv) {
  const dock = $.AXUIElementCreateApplication(Number(argv[0]));
  let last = '';
  for (;;) {
    let line = 'untrusted';
    if ($.AXIsProcessTrusted()) {
      const f = frame(dock);
      line = f && [f.x, f.y, f.width, f.height].every(isFinite) ? JSON.stringify(f) : 'none';
    }
    out(line === last ? '.' : line);
    last = line;
    delay(1);
  }
}
`;

function stopWatch(): void {
  watchGen++;
  if (watcher && watcher.exitCode === null) watcher.kill();
  watcher = null;
  syncTrustPoll();
}

// ⚠️ 상주 osascript 는 **시작할 때의 권한을 붙들고 있다** — 권한을 허용해도 그 프로세스는 계속
// untrusted 를 찍고, 새로 띄운 프로세스만 독을 읽었다(2026-10-21 실측). 그래서 권한이 없는 동안은
// main 이 직접(프로세스 생성 없이) 2초마다 확인하고, 허용되면 측정 프로세스를 새로 띄운다.
// ⚠️ 다시 띄우는 건 **미허용 → 허용으로 바뀌는 순간 한 번**뿐이다 — '허용이면 다시 띄운다'로 두면
// 판정 주체가 엇갈릴 때(앱은 허용인데 osascript 는 미허용) 2초마다 osascript 를 띄우는 루프가 된다.
let trustPoll: ReturnType<typeof setInterval> | null = null;
let selfTrusted = false;
function syncTrustPoll(): void {
  const want = !quitting && isDockShown() && axTrusted === false;
  if (want && !trustPoll) {
    selfTrusted = systemPreferences.isTrustedAccessibilityClient(false);
    trustPoll = setInterval(() => {
      const now = systemPreferences.isTrustedAccessibilityClient(false);
      const granted = now && !selfTrusted;
      selfTrusted = now;
      if (!granted) return;
      quickFailures = 0;
      stopWatch();
      startWatch(); // 새 프로세스가 trusted 를 찍으면 applyAxLine → syncTrustPoll 이 폴링을 끈다
    }, 2000);
  } else if (!want && trustPoll) {
    clearInterval(trustPoll);
    trustPoll = null;
  }
}

function startWatch(): void {
  if (watcher || quitting) return;
  const gen = ++watchGen;
  execFile('/usr/bin/pgrep', ['-x', 'Dock'], (err, stdout) => {
    if (gen !== watchGen || !isDockShown()) return;
    const pid = Number(String(stdout).trim().split('\n')[0]);
    if (err || !pid) return; // 독이 없다(이상 상태) — 수동 경계로 남는다
    const startedAt = Date.now();
    const p = spawn('/usr/bin/osascript', ['-l', 'JavaScript', '-e', AX_SCRIPT, String(pid)], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    watcher = p;
    let buf = '';
    p.stdout?.setEncoding('utf8');
    p.stdout?.on('data', (chunk: string) => {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line && line !== '.') applyAxLine(line);
      }
    });
    p.on('exit', () => {
      if (watcher === p) watcher = null;
      if (gen !== watchGen || quitting || !isDockShown()) return;
      // 독 재시작(pid 바뀜)이면 다시 붙는다 — 곧바로 죽기를 반복하면(스크립트 오류 등) 포기하고 수동으로
      quickFailures = Date.now() - startedAt < 5000 ? quickFailures + 1 : 0;
      if (quickFailures >= 3) return;
      setTimeout(() => {
        if (gen === watchGen) startWatch();
      }, 3000);
    });
  });
}

function applyAxLine(line: string): void {
  let nextFrame: Rectangle | null = null;
  let trusted = true;
  if (line === 'untrusted') trusted = false;
  else if (line !== 'none') {
    try {
      const f = JSON.parse(line) as Rectangle;
      nextFrame = {
        x: Math.round(f.x),
        y: Math.round(f.y),
        width: Math.round(f.width),
        height: Math.round(f.height),
      };
    } catch {
      nextFrame = null;
    }
  }
  const changed =
    trusted !== axTrusted || JSON.stringify(nextFrame) !== JSON.stringify(dockFrame);
  axTrusted = trusted;
  dockFrame = nextFrame;
  syncTrustPoll();
  if (!changed) return;
  layout();
  emitState();
}

// ── 독 자리 계산 — 독 띠 찾기는 lib/macDock(폰 제어 창과 공용) ──

// 손잡이를 끄는 동안은 메모리 값만 바꾸고 놓을 때 한 번 쓴다 — pointermove 마다 파일을 쓰지 않게
let prefsCache: DockPrefs | null = null;
function readPrefs(): DockPrefs {
  prefsCache ??= readUserJson<DockPrefs>(PREFS_FILE, {});
  return prefsCache;
}

/** 실측한 독 프레임이 이 띠 안에 있을 때만 믿는다 — 독이 다른 화면으로 옮겨 가는 사이의 낡은 값 방어 */
function measuredDockRight(strip: Rectangle): number | null {
  const f = dockFrame;
  if (!f || f.width <= 0) return null;
  const cy = f.y + f.height / 2;
  if (cy < strip.y || cy > strip.y + strip.height) return null;
  if (f.x < strip.x || f.x + f.width > strip.x + strip.width) return null;
  return f.x + f.width;
}

function currentFit(): TerminalDockState['fit'] {
  const spot = findDockSpot();
  if (spot.kind === 'floating') return 'floating';
  return measuredDockRight(spot.strip) !== null ? 'auto' : 'manual';
}

/** 펼친 높이 — 기억한 값(없으면 기본)을 [최소, 화면에 들어가는 최대] 로 자른다. 접힌 높이보다 낮아지지 않는다 */
function expandedHeight(collapsedH: number, maxH: number): number {
  const want = readPrefs().expandedHeight ?? EXPANDED_H;
  return Math.max(collapsedH, Math.min(Math.max(want, EXPANDED_MIN_H), maxH));
}

function panelBounds(): Rectangle {
  const spot = findDockSpot();
  if (spot.kind === 'floating') {
    const w = spot.display.workArea;
    const width = Math.min(FLOATING.width, w.width - GAP * 2);
    const bottom = w.y + w.height - GAP;
    const height = expanded
      ? expandedHeight(FLOATING.height, bottom - w.y - GAP)
      : FLOATING.height;
    return { x: w.x + w.width - width - GAP, y: bottom - height, width, height };
  }
  const { strip, display } = spot;
  const right = strip.x + strip.width - GAP;
  const measured = measuredDockRight(strip);
  const ratio = readPrefs().leftRatio ?? DEFAULT_LEFT_RATIO;
  const wanted = measured !== null ? measured + GAP : strip.x + strip.width * ratio;
  // 남는 자리가 MIN_W 보다 좁으면 독 쪽으로 파고든다 — 독(레벨 20)이 패널(floating) 위에 그려진다
  const left = Math.round(Math.max(strip.x + GAP, Math.min(wanted, right - MIN_W)));
  const bottom = strip.y + strip.height - INSET_Y;
  const collapsedH = strip.height - INSET_Y * 2;
  const height = expanded
    ? expandedHeight(collapsedH, bottom - display.workArea.y - GAP)
    : collapsedH;
  return { x: left, y: bottom - height, width: right - left, height };
}

// ⚠️ 펼침·접힘에 `setBounds(…, true)` 애니메이션을 쓰지 말 것 — 투명 창은 크기가 바뀌는 프레임마다
// 화면 전체를 다시 그리고 xterm 도 매 프레임 다시 맞춰서 올라오는 내내 심하게 깜빡였다(2026-10-21 사용자 확인).
// 한 번에 바꾼다
function layout(): void {
  if (!win || win.isDestroyed()) return;
  win.setBounds(panelBounds());
}

// ── 상태 방송 — 상태바 버튼·패널 렌더러가 미러한다 ──

export function isDockShown(): boolean {
  return !!win && !win.isDestroyed() && win.isVisible();
}

export function dockState(): TerminalDockState {
  return { open: isDockShown(), expanded, fit: currentFit(), axTrusted };
}

function emitState(): void {
  broadcast('terminal:dock', dockState());
}

function setExpanded(next: boolean): void {
  if (expanded === next) return;
  expanded = next;
  layout();
  emitState();
}

// ── 창 ──

/** 패널 창을 (없으면) 만든다 — 숨긴 채로. 보이기는 showDockPanel */
export function ensureDockWindow(onClosed: () => void): BrowserWindow {
  if (win && !win.isDestroyed()) return win;
  expanded = false;
  const w = new BrowserWindow({
    ...panelBounds(),
    // 패널: 눌러도 원앱 본창을 앞으로 끌어오지 않고(NSWindowStyleMaskNonactivatingPanel),
    // 전체화면 앱 위·모든 데스크톱에 뜬다(Electron 공식 문서 — BaseWindowConstructorOptions.type)
    type: 'panel',
    frame: false,
    // 둥근 모서리는 CSS 가 그린다 — 창은 투명, OS 그림자는 끄고 테두리로 대신한다
    // (투명 창의 OS 그림자는 크기가 바뀔 때 잔상이 남는다)
    transparent: true,
    hasShadow: false,
    // ⚠️ 없으면 macOS 가 띄우는 순간(orderFront → constrainFrameRect) 패널을 독 띠 밖으로 밀어 올린다
    // (2026-10-21 실측: y 938 → 903, 35pt). Electron 은 이 옵션 + 프레임 없는 창이면 요청한 프레임을
    // 그대로 둔다 — 독 띠 안에 앉히려면 필수
    enableLargerThanScreen: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    title: IS_DEV_INSTANCE ? '독 터미널 — DEV' : '독 터미널',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // 메인 창(main.ts)·팝아웃(windows.ts)과 동일 — 명시해 프로세스 격리가 조용히 풀리는 것을 막는다
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  win = w;

  w.on('page-title-updated', (e) => e.preventDefault());
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // 펼치기는 ⌘↑(terminal:dock:expand)로만 — 포커스를 잃으면(바깥 클릭·숨기기) 접는다
  w.on('blur', () => setExpanded(false));
  w.on('show', () => {
    startWatch();
    syncTrustPoll();
    emitState();
  });
  w.on('hide', () => {
    stopWatch();
    emitState();
  });
  // ⌘W 등 사용자 닫기 = 숨기기 — 배정(전용 셸·가져온 세션)은 그대로 두고 다음에 다시 띄운다
  w.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    hideDockPanel();
  });
  w.on('closed', () => {
    if (win === w) win = null;
    stopWatch();
    expanded = false;
    onClosed();
    emitState();
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void w.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}?dock=1`);
  } else {
    void w.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`), {
      query: { dock: '1' },
    });
  }
  return w;
}

/** 패널 보이기 — focus 면 바로 키 입력을 받게, 아니면 포커스를 뺏지 않고(앱 시작 복원). 둘 다 접힌 채 */
export function showDockPanel(focus: boolean): void {
  if (!win || win.isDestroyed()) return;
  layout();
  if (focus) {
    win.show();
    win.focus();
  } else {
    win.showInactive();
  }
}

export function hideDockPanel(): void {
  if (!win || win.isDestroyed() || !win.isVisible()) return;
  win.hide();
}

export function getDockWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null;
}

/** 위치·접근성 IPC — 배정과 무관한 창 조작만. windows.ts 의 registerTerminalWindowsIpc 가 부른다 */
export function registerDockPanelIpc(): void {
  app.on('before-quit', () => {
    quitting = true;
    stopWatch();
  });

  // 모니터 연결·해제, 독 이동·크기 변경(= workArea 변화) — 다시 앉힌다.
  // ⚠️ screen 은 app ready 전에 쓰면 throw 다 — 이 등록은 main.ts 최상위(ready 전)에서 불린다
  const relayout = () => {
    layout();
    emitState();
  };
  void app.whenReady().then(() => {
    screen.on('display-metrics-changed', relayout);
    screen.on('display-added', relayout);
    screen.on('display-removed', relayout);
  });

  ipcMain.handle('terminal:dock:state', () => dockState());

  // 펼치기/접기 — 패널 안 ⌘↑/⌘↓. 포커스를 가진 패널만(숨은 창의 늦은 키 이벤트 방어)
  ipcMain.on('terminal:dock:expand', (_e, on: boolean) => {
    if (typeof on !== 'boolean' || !win || win.isDestroyed() || !win.isFocused()) return;
    setExpanded(on);
  });

  // 수동 경계 — 패널 왼쪽 손잡이를 끈 화면 x 좌표. 독 띠 폭 대비 비율로 저장(해상도가 바뀌어도 유지).
  // 끄는 동안(commit=false)은 메모리·창만, 놓을 때(commit=true) 파일에 쓴다
  ipcMain.on('terminal:dock:set-left', (_e, args: { screenX: number; commit: boolean }) => {
    const screenX = args?.screenX;
    if (typeof screenX !== 'number' || !Number.isFinite(screenX)) return;
    const spot = findDockSpot();
    if (spot.kind !== 'bottom' || measuredDockRight(spot.strip) !== null) return;
    const ratio = (screenX - spot.strip.x) / spot.strip.width;
    const clamped = Math.round(Math.min(Math.max(ratio, 0.05), 0.95) * 1000) / 1000;
    prefsCache = { ...readPrefs(), leftRatio: clamped };
    layout();
    if (args.commit) writeUserJson(PREFS_FILE, prefsCache);
  });

  // 펼친 높이 — 펼친 상태에서 윗변 손잡이를 끈 화면 y 좌표. 바닥은 그대로 두고 위로 늘이고 줄인다.
  // 저장은 실제로 적용된 높이(화면 위로 넘치게 끌었으면 잘린 값) — 다음에 펼칠 때 그대로 나온다
  ipcMain.on('terminal:dock:set-top', (_e, args: { screenY: number; commit: boolean }) => {
    const screenY = args?.screenY;
    if (typeof screenY !== 'number' || !Number.isFinite(screenY)) return;
    if (!win || win.isDestroyed() || !expanded) return;
    const b = win.getBounds();
    prefsCache = { ...readPrefs(), expandedHeight: Math.round(b.y + b.height - screenY) };
    layout();
    prefsCache = { ...prefsCache, expandedHeight: win.getBounds().height };
    if (args.commit) writeUserJson(PREFS_FILE, prefsCache);
  });

  // 자동 맞춤 켜기 — 시스템 접근성 권한 요청 창을 띄운다(허용은 시스템 설정에서 사용자가 한다).
  // 허용 여부는 상주 측정 프로세스가 다음 틱에 알아챈다. 이미 죽었으면(빠른 실패 포기) 다시 띄운다
  ipcMain.handle('terminal:dock:request-auto', () => {
    const trusted = systemPreferences.isTrustedAccessibilityClient(true);
    quickFailures = 0;
    if (isDockShown() && !watcher) startWatch();
    syncTrustPoll();
    return { trusted };
  });
}
