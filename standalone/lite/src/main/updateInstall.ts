// 자동 설치 — 다운로드 → 검증 → 압축 해제 → 교체 헬퍼 실행 → 앱 종료.
//
// Squirrel(electron autoUpdater)을 쓰지 않는 이유: macOS 는 Apple Developer ID 서명이 필수고
// Windows 는 Setup.exe 설치본이 필요한데(맥에서 빌드 불가), 우리는 자가서명 + zip 이다.
// 대신 릴리스 zip 을 직접 받아 헬퍼 스크립트(`updateCore.ts`)로 교체한다.
//
// 부산물: 앱이 직접 받은 파일에는 검역 표시(macOS quarantine · Windows Zone.Identifier)가 붙지
// 않아, 업데이트에서는 Mac 의 xattr 안내와 Windows SmartScreen 경고가 사라진다.
//
// ⚠️ 앱이 종료되기 **전**의 실패는 전부 값으로 돌려준다(예외 X) — 렌더러가 폴백(받은 폴더
// 열기 · 릴리스 페이지)을 안내한다. 종료 **후**의 실패는 헬퍼가 백업을 되돌린다.
import { app } from 'electron';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { broadcast } from '@one/main/lib/broadcast';
import { fetchWithTimeout } from '@one/main/lib/http';
import type { UpdateAsset, UpdateInstallResult, UpdateProgress } from '../shared/update';
import { macSwapScript, psq, winSwapScript, type SwapPlan } from './updateCore';

const run = promisify(execFile);

/** forge.config.ts 의 EXECUTABLE 과 같아야 한다 — 산출물 안에서 앱을 이 이름으로 찾는다 */
const EXECUTABLE = 'OneAppLite';

/** 다운로드 중 이 시간 동안 바이트가 안 오면 끊는다 — 전체 시간 제한은 두지 않는다(느린 망도 완주하게) */
const STALL_MS = 60_000;
/** 진행률 보고 간격 — 렌더러 리렌더를 초당 몇 번으로 묶는다 */
const PROGRESS_INTERVAL_MS = 200;
/** 렌더러가 "다시 시작합니다" 를 그릴 시간을 준 뒤 종료 */
const QUIT_DELAY_MS = 800;

const emit = (progress: UpdateProgress) => broadcast('update:progress', progress);

type InstallTarget =
  /** 개발 인스턴스 — 교체할 번들이 없다. 다운로드·압축 해제까지만 해 보고 폴더를 돌려준다 */
  | { kind: 'dev' }
  | { kind: 'mac'; target: string; launch: string }
  | { kind: 'win'; target: string; launch: string };

const writable = (dir: string) => {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
};

const knownPath = (name: 'home' | 'desktop' | 'downloads' | 'documents') => {
  try {
    return app.getPath(name);
  } catch {
    return undefined;
  }
};

const samePath = (a: string, b: string) => {
  const na = path.resolve(a);
  const nb = path.resolve(b);
  return process.platform === 'win32' ? na.toLowerCase() === nb.toLowerCase() : na === nb;
};

/**
 * 교체 대상을 확정한다 — 여기서 걸리면 자동 설치 불가(`installBlocked`, 릴리스 페이지로 폴백).
 * 실행 중인 바이너리(`process.execPath`)에서 거꾸로 올라간다.
 */
export function resolveInstallTarget():
  | { ok: true; target: InstallTarget }
  | { ok: false; reason: string } {
  if (!app.isPackaged) return { ok: true, target: { kind: 'dev' } };
  const exe = process.execPath;

  if (process.platform === 'darwin') {
    // 검역 상태의 앱을 다운로드 폴더에서 바로 열면 macOS 가 읽기 전용 임시 경로로 옮겨 실행한다
    // (App Translocation) — 그 자리에서는 교체가 불가능하다
    if (exe.includes('/AppTranslocation/'))
      return {
        ok: false,
        reason:
          '앱을 응용 프로그램 폴더로 옮긴 뒤 다시 시도하세요 — 다운로드 폴더에서 바로 실행하면 macOS 가 교체를 막습니다.',
      };
    // …/OneAppLite.app/Contents/MacOS/OneAppLite → 세 단계 위가 번들
    const bundle = path.resolve(exe, '../../..');
    if (!bundle.endsWith('.app')) return { ok: false, reason: '앱 번들 위치를 알 수 없습니다.' };
    const parent = path.dirname(bundle);
    if (!writable(parent))
      return { ok: false, reason: `앱이 있는 폴더(${parent})에 쓸 수 없습니다.` };
    return { ok: true, target: { kind: 'mac', target: bundle, launch: bundle } };
  }

  if (process.platform === 'win32') {
    const dir = path.dirname(exe);
    // 폴더째 바꾸므로 **정말 앱 폴더인지** 본다 — 파일을 바탕화면에 낱개로 풀어 실행했다면
    // 바탕화면을 통째로 바꿔치기할 판이다
    const looksLikeApp =
      fs.existsSync(path.join(dir, 'resources', 'app.asar')) &&
      fs.existsSync(path.join(dir, `${EXECUTABLE}.exe`));
    const wellKnown = (['home', 'desktop', 'downloads', 'documents'] as const)
      .map(knownPath)
      .filter((p): p is string => !!p);
    if (!looksLikeApp || wellKnown.some((p) => samePath(p, dir)))
      return {
        ok: false,
        reason: `앱 폴더를 특정할 수 없습니다 (${dir}). zip 을 풀어 나온 폴더째로 옮겨 실행해야 자동 설치가 됩니다.`,
      };
    const parent = path.dirname(dir);
    if (!writable(parent))
      return {
        ok: false,
        reason: `앱이 있는 위치(${parent})에 쓸 수 없습니다 — 앱 폴더를 사용자 폴더로 옮기면 됩니다.`,
      };
    return { ok: true, target: { kind: 'win', target: dir, launch: exe } };
  }

  return { ok: false, reason: '이 플랫폼은 자동 설치를 지원하지 않습니다.' };
}

/**
 * zip 을 받으며 sha256 을 함께 계산한다. 끊김은 "무응답 60초" 로만 판정한다 — 140MB 를
 * 느린 망에서 받는 데 몇 분이 걸려도 정상이므로 전체 시간 제한은 두지 않는다.
 * (`fetchWithTimeout` 은 호출부가 signal 을 주면 자기 타임아웃을 걸지 않는다)
 */
async function download(url: string, dest: string, expectedSize: number) {
  const controller = new AbortController();
  let stall: ReturnType<typeof setTimeout> | undefined;
  const kick = () => {
    if (stall) clearTimeout(stall);
    stall = setTimeout(() => controller.abort(), STALL_MS);
  };
  const hash = createHash('sha256');
  let received = 0;
  let writeErr: Error | null = null;

  kick();
  try {
    const res = await fetchWithTimeout(url, {
      signal: controller.signal,
      headers: { 'User-Agent': EXECUTABLE },
    });
    if (!res.ok || !res.body) throw new Error(`다운로드 실패 (HTTP ${res.status})`);
    const total = Number(res.headers.get('content-length')) || expectedSize;

    const out = fs.createWriteStream(dest);
    out.on('error', (e) => {
      writeErr = e;
      controller.abort();
    });
    const reader = res.body.getReader();
    let lastEmit = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      kick();
      hash.update(value);
      received += value.byteLength;
      if (!out.write(value)) await once(out, 'drain');
      const now = Date.now();
      if (now - lastEmit >= PROGRESS_INTERVAL_MS) {
        lastEmit = now;
        emit({
          phase: 'download',
          received,
          total,
          percent: total ? Math.min(100, Math.round((received / total) * 100)) : undefined,
        });
      }
    }
    await new Promise<void>((resolve, reject) => {
      out.once('error', reject);
      out.end(() => resolve());
    });
    if (writeErr) throw writeErr;
    emit({ phase: 'download', received, total, percent: 100 });
    return { size: received, sha256: hash.digest('hex') };
  } catch (e) {
    if (writeErr) throw writeErr;
    if (controller.signal.aborted)
      throw new Error(
        `다운로드가 ${STALL_MS / 1000}초 동안 멈춰 중단했습니다 — 네트워크를 확인하고 다시 시도하세요.`,
      );
    throw e;
  } finally {
    if (stall) clearTimeout(stall);
  }
}

/**
 * 압축 해제 — macOS 는 `ditto`(번들의 심링크·권한을 보존하는 Apple 권장 도구), Windows 는
 * 내장 `tar`(Win10 1803+) 를 쓰고 없으면 PowerShell `Expand-Archive` 로 넘어간다.
 * zip 라이브러리를 들이지 않는 이유: .app 안의 프레임워크 심링크를 깨뜨리는 구현이 많다.
 */
async function extract(zip: string, stage: string) {
  if (process.platform === 'darwin') {
    await run('ditto', ['-xk', zip, stage]);
    return;
  }
  try {
    await run('tar', ['-xf', zip, '-C', stage], { windowsHide: true });
  } catch {
    await run(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `Expand-Archive -LiteralPath ${psq(zip)} -DestinationPath ${psq(stage)} -Force`,
      ],
      { windowsHide: true },
    );
  }
}

const subdirs = (dir: string) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(dir, d.name));

/** 풀어놓은 것 안에서 앱을 찾는다 — forge 의 zip 은 mac 은 `.app` 이 바로, win 은 폴더 하나 아래에 있다 */
function findIncoming(stage: string): string | undefined {
  for (const dir of [stage, ...subdirs(stage)]) {
    if (process.platform === 'win32') {
      if (
        fs.existsSync(path.join(dir, `${EXECUTABLE}.exe`)) &&
        fs.existsSync(path.join(dir, 'resources', 'app.asar'))
      )
        return dir;
    } else {
      const bundle = path.join(dir, `${EXECUTABLE}.app`);
      if (fs.existsSync(path.join(bundle, 'Contents', 'MacOS', EXECUTABLE))) return bundle;
    }
  }
  return undefined;
}

const PS_FLAGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden'];
/** UTF-8 BOM — PowerShell 5.1 이 스크립트를 UTF-8 로 읽게 하는 표식(없으면 한글 경로가 깨진다) */
const BOM = '\uFEFF';

/** 헬퍼를 **떼어서** 띄운다 — 앱이 종료돼도 살아서 교체를 마쳐야 한다 */
async function launchHelper(plan: SwapPlan, kind: 'mac' | 'win') {
  const temp = app.getPath('temp');
  if (kind === 'mac') {
    const script = path.join(temp, `${EXECUTABLE}-update.sh`);
    fs.writeFileSync(script, macSwapScript(plan), { mode: 0o755 });
    spawn('/bin/sh', [script], { detached: true, stdio: 'ignore' }).unref();
    return;
  }

  // 그룹 정책이 스크립트 실행을 막는 PC 가 있다 — **앱을 끄기 전에** 진짜 스크립트 파일로 확인한다
  // (`-Command` 는 정책이 Restricted 여도 돌아가서 시험이 안 된다)
  const probe = path.join(temp, `${EXECUTABLE}-update-probe.ps1`);
  fs.writeFileSync(probe, `${BOM}exit 0\n`, 'utf8');
  try {
    await run('powershell.exe', [...PS_FLAGS, '-File', probe], {
      windowsHide: true,
      timeout: 15_000,
    });
  } catch {
    throw new Error(
      '이 PC 에서는 PowerShell 스크립트 실행이 막혀 있어 자동 교체를 할 수 없습니다 — 받은 폴더로 직접 교체하세요.',
    );
  } finally {
    fs.rmSync(probe, { force: true });
  }

  const script = path.join(temp, `${EXECUTABLE}-update.ps1`);
  // PowerShell 5.1 은 BOM 이 있어야 UTF-8 로 읽는다 — 한글 사용자 폴더 경로
  fs.writeFileSync(script, `${BOM}${winSwapScript(plan)}`, 'utf8');
  spawn('powershell.exe', [...PS_FLAGS, '-File', script], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
}

let installing = false;

/** 임시 폴더 안의 경로인가 — `update:open-folder` 가 임의 경로를 열지 않게 */
export function isStageFolder(folder: string): boolean {
  const rel = path.relative(app.getPath('temp'), path.resolve(folder));
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export async function installUpdate(
  asset: UpdateAsset,
  version: string,
): Promise<UpdateInstallResult> {
  if (installing) return { ok: false, error: '이미 설치가 진행 중입니다.' };
  installing = true;

  const temp = app.getPath('temp');
  const stage = path.join(temp, `${EXECUTABLE}-update-${version}`);
  const zip = path.join(temp, asset.name);
  // 받아 풀어둔 폴더를 사용자에게 넘길 때(반자동 폴백)만 stage 를 남긴다
  const fail = (error: string, keepStage = false): UpdateInstallResult => {
    if (!keepStage) fs.rmSync(stage, { recursive: true, force: true });
    return { ok: false, error, ...(keepStage ? { folder: stage } : {}) };
  };

  try {
    const resolved = resolveInstallTarget();
    if (!resolved.ok) return fail(resolved.reason);

    fs.rmSync(stage, { recursive: true, force: true });
    fs.mkdirSync(stage, { recursive: true });

    emit({ phase: 'download', percent: 0, received: 0, total: asset.size });
    const got = await download(asset.url, zip, asset.size);

    emit({ phase: 'verify' });
    if (asset.size && got.size !== asset.size)
      return fail(`받은 파일 크기가 다릅니다 (${got.size} ≠ ${asset.size}) — 다시 시도하세요.`);
    if (asset.sha256 && got.sha256 !== asset.sha256)
      return fail('받은 파일의 체크섬이 다릅니다 — 다시 시도하세요.');

    emit({ phase: 'extract' });
    await extract(zip, stage);
    const incoming = findIncoming(stage);
    if (!incoming) return fail('받은 파일 안에서 앱을 찾지 못했습니다.', true);

    if (resolved.target.kind === 'dev')
      return fail('개발 인스턴스에서는 교체하지 않습니다 — 받은 파일은 폴더에서 확인하세요.', true);

    emit({ phase: 'install' });
    const plan: SwapPlan = {
      pid: process.pid,
      target: resolved.target.target,
      incoming,
      stage,
      // 같은 폴더 안 = 같은 볼륨 → 이름 바꾸기 한 번으로 끝난다
      backup: `${resolved.target.target}.bak`,
      launch: resolved.target.launch,
      log: path.join(temp, `${EXECUTABLE}-update.log`),
    };
    await launchHelper(plan, resolved.target.kind);

    // 헬퍼가 우리 종료를 기다리고 있다
    setTimeout(() => app.quit(), QUIT_DELAY_MS);
    return { ok: true };
  } catch (e) {
    return fail(
      e instanceof Error && e.message ? e.message : '설치에 실패했습니다.',
      fs.existsSync(stage) && !!findIncomingSafe(stage),
    );
  } finally {
    fs.rmSync(zip, { force: true });
    installing = false;
  }
}

/** 예외 경로에서 쓰는 안전한 버전 — stage 가 반쯤 비어 있어도 던지지 않는다 */
function findIncomingSafe(stage: string): string | undefined {
  try {
    return findIncoming(stage);
  } catch {
    return undefined;
  }
}
