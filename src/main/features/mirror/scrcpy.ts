// scrcpy 실행·상태 추적 — 바탕화면 'Mirror USB.app'·'Control USB.app' 이식.
// 앱이 종료되면 자식인 scrcpy 창도 함께 정리된다 (VPN 과 달리 독립 유지가 필요 없음).
import { execFile, spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import type {
  MirrorActionResult,
  MirrorMode,
  MirrorStatus,
} from '../../../shared/types';

// 모드별 scrcpy 인자 — 바탕화면 런처 앱들과 동일
const MODE_ARGS: Record<MirrorMode, string[]> = {
  mirror: ['-d', '--turn-screen-off'], // Mirror USB.app
  control: ['-d', '--no-video', '--no-audio', '--keyboard=uhid', '--mouse=uhid'], // Control USB.app
};

// Homebrew 경로 우선 탐색 (Apple Silicon → Intel)
const SCRCPY_CANDIDATES = ['/opt/homebrew/bin/scrcpy', '/usr/local/bin/scrcpy'];
const ADB_CANDIDATES = ['/opt/homebrew/bin/adb', '/usr/local/bin/adb'];

const findBin = (candidates: string[]): string | null =>
  candidates.find((p) => fs.existsSync(p)) ?? null;

let child: ChildProcess | null = null;
let runningMode: MirrorMode | null = null;
let lastError = '';

// 상태 변화 구독 (ipc 가 렌더러로 push)
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((cb) => cb());
export function onMirrorChanged(cb: () => void) {
  listeners.add(cb);
}

/** USB 로 연결된 기기 모델명 조회 (adb devices -l — 'device' 상태만, 미인증/오프라인 제외) */
async function getUsbDevice(): Promise<string | null> {
  const adb = findBin(ADB_CANDIDATES);
  if (!adb) return null;
  return new Promise((resolve) => {
    execFile(adb, ['devices', '-l'], { timeout: 3000 }, (err, stdout) => {
      if (err) return resolve(null);
      const line = stdout
        .split('\n')
        .slice(1) // 헤더 제거
        .find((l) => /\bdevice\b/.test(l) && !/offline|unauthorized/.test(l));
      if (!line) return resolve(null);
      // "SERIAL device usb:... model:SM_G991N ..." → 모델명, 없으면 시리얼
      const model = line.match(/model:(\S+)/)?.[1]?.replace(/_/g, ' ');
      resolve(model ?? line.trim().split(/\s+/)[0]);
    });
  });
}

export async function getMirrorStatus(): Promise<MirrorStatus> {
  return {
    installed: !!findBin(SCRCPY_CANDIDATES),
    running: child ? runningMode : null,
    device: await getUsbDevice(),
    error: lastError || undefined,
  };
}

export async function startMirror(mode: MirrorMode): Promise<MirrorActionResult> {
  const scrcpy = findBin(SCRCPY_CANDIDATES);
  if (!scrcpy) {
    return { ok: false, error: 'scrcpy 미설치 — brew install scrcpy' };
  }
  if (child) return { ok: true }; // 이미 실행 중 (한 번에 한 모드만)

  // 시작 직전 기기 재확인 (위젯 상태가 오래됐을 수 있음)
  if (!(await getUsbDevice())) {
    return { ok: false, error: 'USB 로 연결된 기기가 없습니다.' };
  }

  lastError = '';
  const stderrTail: string[] = []; // 비정상 종료 원인 표시용 — 마지막 몇 줄만 유지
  const proc = spawn(scrcpy, MODE_ARGS[mode], {
    // adb 등 부속 바이너리를 찾도록 Homebrew 경로 보강 (Mirror USB.app 과 동일)
    env: { ...process.env, PATH: `/opt/homebrew/bin:${process.env.PATH ?? ''}` },
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
}

export function stopMirror(): MirrorActionResult {
  child?.kill('SIGTERM');
  return { ok: true }; // 실제 정리는 exit 핸들러가 담당 (상태 push 포함)
}
