// scrcpy 실행·상태 추적 — 바탕화면 'Mirror USB.app'·'Control USB.app' 이식.
// ⚠️ spawn 자식은 부모(앱) 종료만으로 죽지 않는다(POSIX 재부모화) — 앱 종료 시
// main.ts 의 before-quit 이 disposeMirror() 로 명시적으로 정리한다(2026-08-07).
import { app } from 'electron';
import { execFile, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  MIRROR_DEVICE_ISSUE_TEXT,
  type MirrorActionResult,
  type MirrorDeviceIssue,
  type MirrorMode,
  type MirrorStatus,
} from '../../../shared/types';

// 제어 모드 창 — 화면(비디오)이 없으니 입력을 받을 최소 크기면 된다(scrcpy 기본은 256x256).
// 100 이면 타이틀바 신호등 버튼이 다 보이고, 48 까지는 경고 없이 내려간다(2026-09-01 실측).
const CONTROL_WINDOW_SIZE = 100; // 타이틀바까지 **포함한** 창 한 변
// ⚠️ scrcpy 의 --window-height 는 타이틀바를 뺀 **콘텐츠 높이**다(실측: 100 을 주면 창은
//    100x132 가 된다). 창 전체를 정사각형으로 만들려면 타이틀바 높이를 빼서 넘겨야 한다.
const TITLEBAR_H = 32;

// 모드별 scrcpy 인자 — 바탕화면 런처 앱들과 동일
const MODE_ARGS: Record<MirrorMode, string[]> = {
  mirror: ['-d', '--turn-screen-off'], // Mirror USB.app
  control: [
    // Control USB.app
    '-d',
    '--no-video',
    '--no-audio',
    '--keyboard=uhid',
    '--mouse=uhid',
    `--window-width=${CONTROL_WINDOW_SIZE}`,
    `--window-height=${CONTROL_WINDOW_SIZE - TITLEBAR_H}`,
    // 제목 비우기 — 빈 값이 그대로 먹는다(2026-09-01 실측). 타이틀바 자체는 남겨
    // 창을 마우스로 옮기고 닫을 수 있게 둔다(--window-borderless 를 쓰면 둘 다 막힌다).
    '--window-title=',
  ],
};

// scrcpy 는 화면이 없는 control 모드에서도 키·마우스 입력을 받으려고 창을 띄우고,
// 그 한가운데에 자기 아이콘(초록 안드로이드)을 크게 그린다. 소스를 고쳐 다시 빌드할 것 없이
// **SCRCPY_ICON_DIR 로 아이콘 디렉터리를 통째로 갈아끼울 수 있어서**(scrcpy 4.0 실측,
// 2026-09-01) 투명 PNG 를 넘겨 빈 창으로 만든다.
// ⚠️ **1x1 로 만들지 말 것** — 창은 비지만 같은 이미지가 Dock 아이콘으로도 쓰여서,
//    Dock 이 1x1 을 확대할 때 파란 사각형이 됐다(2026-09-01 실측). 256x256 이면 Dock 도
//    빈 자리로 남는다.
const BLANK_ICON_PNG = Buffer.from(
  // 256x256 전체가 알파 0 인 PNG (334 바이트 — 전부 0 이라 압축이 잘 된다)
  'iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAABFUlEQVR42u3BMQEAAADCoPVP7WsIoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAeAMBPAAB2ClDBAAAAABJRU5ErkJggg==',
  'base64',
);

let blankIconDir: string | null | undefined; // undefined = 아직 안 만듦 / null = 실패

/**
 * 투명 아이콘 디렉터리를 userData 아래에 확보하고 경로를 돌려준다.
 * ⚠️ scrcpy 는 이 디렉터리에서 `scrcpy.png` 와 `disconnected.png` 두 이름을 찾는다 —
 *    하나만 두면 기기가 빠질 때 원래 아이콘 폴백이 뜬다.
 * 실패해도 null 만 돌려준다: 아이콘은 곁가지라 미러링 자체를 막지 않는다.
 */
function ensureBlankIconDir(): string | null {
  if (blankIconDir !== undefined) return blankIconDir;
  try {
    const dir = path.join(app.getPath('userData'), 'mirror-icons');
    fs.mkdirSync(dir, { recursive: true });
    for (const name of ['scrcpy.png', 'disconnected.png']) {
      const file = path.join(dir, name);
      // 존재 여부가 아니라 크기로 비교한다 — 예전에 다른 아이콘을 심어 뒀어도 갱신된다
      if (fs.statSync(file, { throwIfNoEntry: false })?.size !== BLANK_ICON_PNG.length) {
        fs.writeFileSync(file, BLANK_ICON_PNG);
      }
    }
    blankIconDir = dir;
  } catch {
    blankIconDir = null;
  }
  return blankIconDir;
}

// Homebrew 경로 우선 탐색 (Apple Silicon → Intel)
const SCRCPY_CANDIDATES = ['/opt/homebrew/bin/scrcpy', '/usr/local/bin/scrcpy'];
const ADB_CANDIDATES = ['/opt/homebrew/bin/adb', '/usr/local/bin/adb'];

const findBin = (candidates: string[]): string | null =>
  candidates.find((p) => fs.existsSync(p)) ?? null;

// adb 데몬이 꺼져 있으면 `adb devices` 가 데몬을 먼저 띄우는데, 그게 **3초를 넘는다**
// (2026-08 실측: 콜드 3.03초 / 웜 0.01초). 예전 타임아웃이 3초여서 데몬이 식어 있는 동안
// 기기 감지가 매번 실패했다 — 넉넉히 잡고, 첫 조회 전에 데몬을 미리 띄운다.
const ADB_TIMEOUT_MS = 10_000;
let adbWarmed = false;

function warmAdbDaemon(adb: string): Promise<void> {
  if (adbWarmed) return Promise.resolve();
  adbWarmed = true;
  return new Promise((resolve) => {
    execFile(adb, ['start-server'], { timeout: ADB_TIMEOUT_MS }, () => resolve());
  });
}

let child: ChildProcess | null = null;
let runningMode: MirrorMode | null = null;
let starting = false; // 기기 확인(await) 중 재진입 방지 — 없으면 scrcpy 가 이중 실행돼 하나가 유실됨
let lastError = '';

// 상태 변화 구독 (ipc 가 렌더러로 push)
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((cb) => cb());
export function onMirrorChanged(cb: () => void) {
  listeners.add(cb);
}

// adb 기기 상태 → 사용자 조치가 필요한 원인. 여기 없는 상태(recovery·sideload 등)는
// 미러링 대상이 아니라 '기기 없음' 으로 둔다.
const ISSUE_BY_STATE: Record<string, MirrorDeviceIssue> = {
  unauthorized: 'unauthorized',
  authorizing: 'unauthorized', // 승인 진행 중 — 안내가 같으므로 묶는다
  offline: 'offline',
};

type DeviceScan = { device: string | null; issue?: MirrorDeviceIssue };

/**
 * `adb devices -l` 출력 파싱.
 * 쓸 수 있는 기기('device')가 있으면 모델명을, 없으면 붙어 있는 기기의 문제 상태를 돌려준다.
 * ⚠️ 문제 상태를 버리고 null 만 반환하면 위젯에서 '케이블이 빠짐' 과 '승인만 남음' 을
 *    구분할 수 없다 — 실제로 unauthorized 를 기기 없음으로 표시해 오진을 유발했다(2026-08 실측).
 */
export function parseAdbDevices(stdout: string): DeviceScan {
  let issue: MirrorDeviceIssue | undefined;
  for (const raw of stdout.split('\n')) {
    const line = raw.trim();
    // 헤더('List of devices attached')·데몬 시작 배너('* daemon not running...') 제외
    if (!line || line.startsWith('*') || /^List of devices/i.test(line)) continue;
    const [serial, state, ...rest] = line.split(/\s+/);
    if (!serial || !state) continue;
    if (state === 'device') {
      // "SERIAL device usb:... model:SM_G991N ..." → 모델명, 없으면 시리얼
      const model = rest.join(' ').match(/model:(\S+)/)?.[1]?.replace(/_/g, ' ');
      return { device: model ?? serial };
    }
    // 'no permissions (user in plugdev group...)' 는 공백이 섞여 두 번째 토큰이 'no' 로 잘린다
    issue ??= state === 'no' ? 'no-permission' : ISSUE_BY_STATE[state];
  }
  return { device: null, issue };
}

/** USB 로 연결된 기기 조회 (모델명 또는 쓸 수 없는 이유) */
async function scanDevices(): Promise<DeviceScan> {
  const adb = findBin(ADB_CANDIDATES);
  if (!adb) return { device: null };
  await warmAdbDaemon(adb);
  return new Promise((resolve) => {
    execFile(adb, ['devices', '-l'], { timeout: ADB_TIMEOUT_MS }, (err, stdout) => {
      resolve(err ? { device: null } : parseAdbDevices(stdout));
    });
  });
}

export async function getMirrorStatus(): Promise<MirrorStatus> {
  const scan = await scanDevices();
  return {
    installed: !!findBin(SCRCPY_CANDIDATES),
    running: child ? runningMode : null,
    device: scan.device,
    deviceIssue: scan.issue,
    error: lastError || undefined,
  };
}

export async function startMirror(mode: MirrorMode): Promise<MirrorActionResult> {
  const scrcpy = findBin(SCRCPY_CANDIDATES);
  if (!scrcpy) {
    return { ok: false, error: 'scrcpy 미설치 — brew install scrcpy' };
  }
  if (child || starting) return { ok: true }; // 이미 실행/시작 중 (한 번에 한 모드만)

  starting = true;
  try {
    // 시작 직전 기기 재확인 (위젯 상태가 오래됐을 수 있음) — 실패 사유는 원인까지 알려준다
    const scan = await scanDevices();
    if (!scan.device) {
      const issue = scan.issue && MIRROR_DEVICE_ISSUE_TEXT[scan.issue];
      return {
        ok: false,
        error: issue
          ? `${issue.label} — ${issue.hint}`
          : 'USB 로 연결된 기기가 없습니다.',
      };
    }

    lastError = '';
    const stderrTail: string[] = []; // 비정상 종료 원인 표시용 — 마지막 몇 줄만 유지
    const iconDir = ensureBlankIconDir();
    const proc = spawn(scrcpy, MODE_ARGS[mode], {
      env: {
        ...process.env,
        // adb 등 부속 바이너리를 찾도록 Homebrew 경로 보강 (Mirror USB.app 과 동일)
        PATH: `/opt/homebrew/bin:${process.env.PATH ?? ''}`,
        // 창 한가운데 안드로이드 아이콘을 지운다 (control 모드에서 보인다)
        ...(iconDir ? { SCRCPY_ICON_DIR: iconDir } : {}),
      },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    proc.stderr?.on('data', (d: Buffer) => {
      stderrTail.push(...d.toString().split('\n').filter(Boolean));
      if (stderrTail.length > 5) stderrTail.splice(0, stderrTail.length - 5);
    });
    proc.on('exit', (code) => {
      // 사용자가 미러 창을 닫으면 code 0 — 조용히 상태만 갱신
      if (code !== 0 && code !== null) {
        lastError = stderrTail.at(-1) ?? `scrcpy 종료 (code ${code})`;
      }
      child = null;
      runningMode = null;
      emit();
    });
    proc.on('error', (err) => {
      lastError = err.message;
      child = null;
      runningMode = null;
      emit();
    });
    child = proc;
    runningMode = mode;
    emit();
    return { ok: true };
  } finally {
    starting = false;
  }
}

export function stopMirror(): MirrorActionResult {
  child?.kill('SIGTERM');
  return { ok: true }; // 실제 정리는 exit 핸들러가 담당 (상태 push 포함)
}

/** 앱 종료 시 scrcpy 회수 — 없으면 미러링을 켠 채 앱을 꺼도 scrcpy 가 고아로 남는다 */
export function disposeMirror(): void {
  child?.kill('SIGTERM');
  child = null;
  runningMode = null;
}
