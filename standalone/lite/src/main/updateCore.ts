// 자동 업데이트의 **순수 로직** — 버전 비교 · 이 PC 용 산출물 고르기 · 교체 헬퍼 스크립트 본문.
//
// electron 을 import 하지 않는다 — 루트 vitest 로 단위 테스트한다(`updateCore.test.ts`).
// 특히 Windows 헬퍼는 이 맥에서 실제로 돌려볼 수 없으므로, 스크립트 본문이 의도한 순서
// (백업 → 교체 → 재실행 → 정리, 실패 시 원복)를 갖는지는 테스트가 유일한 방어선이다.

/** x.y.z 비교 — a 가 b 보다 새로우면 양수. 자리수가 빠지면 0 으로 친다 */
export function compareVersion(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** GitHub 릴리스 API 의 asset 중 우리가 쓰는 필드 */
export type ReleaseAsset = {
  name?: unknown;
  browser_download_url?: unknown;
  size?: unknown;
  /** 2025 년부터 GitHub 가 `sha256:<hex>` 로 준다 — 없을 수도 있다 */
  digest?: unknown;
};

export type PickedAsset = {
  name: string;
  url: string;
  size: number;
  sha256?: string;
};

/**
 * 이 PC(플랫폼·아키텍처)용 zip 을 고른다 — 이름이 `OneAppLite-<platform>-<arch>-<버전>.zip` 이라는
 * 것은 `scripts/release.mjs`(forge maker-zip 기본 이름)와의 약속이다.
 */
export function pickAsset(
  assets: unknown,
  platform: string,
  arch: string,
): PickedAsset | undefined {
  if (!Array.isArray(assets)) return undefined;
  const needle = `-${platform}-${arch}-`;
  for (const raw of assets as ReleaseAsset[]) {
    const name = typeof raw?.name === 'string' ? raw.name : '';
    if (!name.endsWith('.zip') || !name.includes(needle)) continue;
    if (typeof raw.browser_download_url !== 'string') continue;
    const size = typeof raw.size === 'number' ? raw.size : 0;
    const digest = typeof raw.digest === 'string' ? raw.digest : '';
    const sha256 = digest.startsWith('sha256:') ? digest.slice('sha256:'.length) : undefined;
    return { name, url: raw.browser_download_url, size, sha256 };
  }
  return undefined;
}

/** 교체 헬퍼가 알아야 할 것 — 두 플랫폼이 같은 모양을 쓴다 */
export type SwapPlan = {
  /** 종료를 기다릴 앱 프로세스 */
  pid: number;
  /** 교체될 현재 앱 — mac: `.app` 경로 · win: exe 가 든 폴더 */
  target: string;
  /** 새 앱 — mac: 풀어둔 `.app` · win: 풀어둔 폴더 */
  incoming: string;
  /**
   * zip 을 풀어둔 임시 폴더 — 성공하면 통째로 지운다.
   * ⚠️ `dirname(incoming)` 으로 유추하지 않는다 — incoming 이 곧 stage 인 경우 상위(임시 폴더 전체)를 지운다.
   */
  stage: string;
  /** 교체 중 옛 앱을 잠시 옮겨둘 곳 — target 과 같은 볼륨이어야 한다(이름 바꾸기로 끝나게) */
  backup: string;
  /** 재실행할 것 — mac: `.app` 경로 · win: exe 경로 */
  launch: string;
  /** 헬퍼 로그 파일 — 실패 원인을 나중에 볼 수 있게 */
  log: string;
  /**
   * 결과 파일 — 헬퍼가 끝에 `ok <버전>` 또는 `fail <버전> <사유>` 한 줄을 쓴다. 다음에 뜬 앱이 읽어
   * 실패를 배너로 알린다(예전엔 실패가 로그에만 남아 "재시작이 안 되고 업데이트가 무한 반복"으로 보였다)
   */
  result: string;
  /** 설치하려던 버전 — 결과 파일에 함께 적는다 */
  version: string;
};

/** 결과 파일 한 줄을 읽는다 — `ok <버전>` · `fail <버전> <사유>` (앞의 BOM·공백 허용) */
export function parseSwapResult(
  text: string,
): { ok: true; version: string } | { ok: false; version: string; reason: string } | null {
  const line = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/)[0] ?? '';
  const m = line.match(/^(ok|fail)\s+(\S+)(?:\s+(.*))?$/);
  if (!m) return null;
  return m[1] === 'ok'
    ? { ok: true, version: m[2] }
    : { ok: false, version: m[2], reason: (m[3] ?? '').trim() || '원인을 알 수 없습니다.' };
}

/** POSIX sh 단일 인용 — `'` 는 `'\''` 로 */
export const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** PowerShell 단일 인용 — `'` 는 `''` 로 (단일 인용 안에서는 다른 확장이 없다) */
export const psq = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** 앱 종료를 기다리는 상한 — 이 안에 안 죽으면 그냥 진행한다(무한 대기로 헬퍼가 남지 않게) */
const WAIT_EXIT_SEC = 30;

/**
 * macOS 헬퍼(`/bin/sh`) — 앱이 종료되면 `.app` 을 바꾸고 다시 띄운다.
 *
 * 순서가 곧 안전장치다: **옛 앱을 백업으로 옮긴 뒤** 새 앱을 들여놓고, 어느 단계가 실패하든
 * 백업을 되돌려 놓고 원래 앱을 다시 띄운다. `mv` 는 같은 볼륨이면 이름 바꾸기라 즉시 끝나고,
 * 볼륨이 다르면(외장 디스크에 앱을 둔 경우) `ditto` 로 복사한다.
 */
export function macSwapScript(plan: SwapPlan): string {
  const { pid, target, incoming, stage, backup, launch, log, result, version } = plan;
  const res = (line: string) => `printf '%s\\n' ${shq(line)} >${shq(result)}`;
  return [
    '#!/bin/sh',
    '# One App Lite 업데이트 헬퍼 — 앱이 만든 임시 스크립트. 앱이 종료되면 교체하고 다시 띄운다.',
    `exec >>${shq(log)} 2>&1`,
    // 작업 폴더를 앱 밖으로 — Windows 헬퍼와 같은 원칙(앱 폴더를 붙잡지 않는다)
    'cd /tmp || true',
    `echo "[$(date)] start pid=${pid}"`,
    'i=0',
    `while kill -0 ${pid} 2>/dev/null; do`,
    '  sleep 0.2; i=$((i+1))',
    `  if [ "$i" -gt ${WAIT_EXIT_SEC * 5} ]; then echo "timeout waiting for exit"; break; fi`,
    'done',
    `TARGET=${shq(target)}`,
    `INCOMING=${shq(incoming)}`,
    `STAGE=${shq(stage)}`,
    `BACKUP=${shq(backup)}`,
    `LAUNCH=${shq(launch)}`,
    'rm -rf "$BACKUP"',
    'if ! mv "$TARGET" "$BACKUP"; then',
    `  echo "backup failed"; ${res(`fail ${version} 기존 앱을 옮기지 못했습니다.`)}; open "$LAUNCH"; exit 1`,
    'fi',
    'if mv "$INCOMING" "$TARGET" 2>/dev/null || { rm -rf "$TARGET"; ditto "$INCOMING" "$TARGET"; }; then',
    '  echo "swapped"',
    '  # 앱이 직접 받은 파일엔 검역 표시가 없지만, 혹시 붙어 있어도 첫 실행이 막히지 않게',
    '  xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null || true',
    `  ${res(`ok ${version}`)}`,
    '  open "$LAUNCH"',
    '  rm -rf "$BACKUP"',
    '  rm -rf "$STAGE"',
    '  echo "done"',
    'else',
    '  echo "swap failed, restoring"',
    `  ${res(`fail ${version} 새 버전을 옮겨 놓지 못해 기존 앱으로 되돌렸습니다.`)}`,
    '  rm -rf "$TARGET"',
    '  mv "$BACKUP" "$TARGET"',
    '  open "$LAUNCH"',
    '  exit 1',
    'fi',
    '',
  ].join('\n');
}

/**
 * Windows 헬퍼(PowerShell 5.1+) — 앱이 종료되면 폴더를 바꾸고 exe 를 다시 띄운다.
 *
 * ⚠️ 이 맥에서 실행해 볼 수 없다. 그래서 위험한 가정을 피한다:
 * - 실행 파일 잠금은 프로세스 종료 직후 바로 풀리지 않을 수 있다(백신·인덱서) → 이름 바꾸기를 재시도
 * - `Move-Item` 은 **드라이브가 다르면 폴더를 옮기지 못한다** → 루트가 다르면 복사 후 삭제
 * - 경로는 인자로 넘기지 않고 스크립트 본문에 박는다(한글 경로가 인자 인코딩에서 깨지는 것을 피함).
 *   호출부는 파일을 **UTF-8 BOM** 으로 저장해야 PowerShell 5.1 이 한글을 바로 읽는다.
 */
export function winSwapScript(plan: SwapPlan): string {
  const { pid, target, incoming, stage, backup, launch, log, result, version } = plan;
  return [
    '# One App Lite 업데이트 헬퍼 — 앱이 만든 임시 스크립트. 앱이 종료되면 폴더를 교체하고 다시 띄운다.',
    "$ErrorActionPreference = 'Stop'",
    // ⚠️ 작업 폴더를 앱 폴더 밖으로 — Windows 는 **어떤 프로세스의 작업 폴더인 폴더**를 이름 바꾸거나
    //    옮길 수 없다. 앱을 더블클릭해 띄우면 작업 폴더가 앱 폴더이고, 헬퍼가 그걸 물려받아 자기 발로
    //    백업(이름 바꾸기)을 막고 있었다 → 20번 재시도 후 포기 → 옛 앱 재실행 = "무한 업데이트"(2.4.0 신고).
    //    호출부도 cwd 를 임시 폴더로 주지만, 스크립트가 스스로도 한 번 더 옮긴다.
    'Set-Location -LiteralPath ([IO.Path]::GetTempPath())',
    `$log = ${psq(log)}`,
    `$target = ${psq(target)}`,
    `$incoming = ${psq(incoming)}`,
    `$stage = ${psq(stage)}`,
    `$backup = ${psq(backup)}`,
    `$launch = ${psq(launch)}`,
    `$result = ${psq(result)}`,
    `$version = ${psq(version)}`,
    'function Log($m) { Add-Content -LiteralPath $log -Value ("[{0}] {1}" -f (Get-Date -Format s), $m) }',
    // 결과 한 줄 — 다음에 뜬 앱이 읽는다(parseSwapResult). 실패해도 교체 흐름은 막지 않는다
    'function Result($m) { try { Set-Content -LiteralPath $result -Value $m -Encoding UTF8 } catch { Log "result write failed: $_" } }',
    // 재실행한 앱의 작업 폴더는 앱 폴더로 (앱이 상대 경로에 기대지 않지만 사용자가 더블클릭했을 때와 같게)
    'function Relaunch() { try { Start-Process -FilePath $launch -WorkingDirectory ([IO.Path]::GetDirectoryName($launch)) } catch { Log "relaunch failed: $_" } }',
    'function MoveDir($from, $to) {',
    '  if ([IO.Path]::GetPathRoot($from) -ieq [IO.Path]::GetPathRoot($to)) {',
    '    Move-Item -LiteralPath $from -Destination $to',
    '  } else {',
    '    Copy-Item -LiteralPath $from -Destination $to -Recurse',
    '    Remove-Item -LiteralPath $from -Recurse -Force',
    '  }',
    '}',
    'try {',
    `  Log "start pid=${pid}"`,
    `  $deadline = (Get-Date).AddSeconds(${WAIT_EXIT_SEC})`,
    `  while ((Get-Process -Id ${pid} -ErrorAction SilentlyContinue) -and ((Get-Date) -lt $deadline)) { Start-Sleep -Milliseconds 200 }`,
    '  Start-Sleep -Milliseconds 500',
    '  if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Recurse -Force }',
    '  $moved = $false',
    '  for ($i = 0; $i -lt 20 -and -not $moved; $i++) {',
    '    try { Move-Item -LiteralPath $target -Destination $backup; $moved = $true } catch { Start-Sleep -Milliseconds 500 }',
    '  }',
    "  if (-not $moved) { Log 'backup failed (target still locked)'; Result \"fail $version 앱 폴더가 사용 중이라 바꾸지 못했습니다 — 앱 폴더를 연 탐색기 창이나 다른 프로그램을 닫고 다시 시도하세요.\"; Relaunch; exit 1 }",
    '  try {',
    '    MoveDir $incoming $target',
    "    Log 'swapped'",
    '    Result "ok $version"',
    '  } catch {',
    '    Log "swap failed: $_ - restoring"',
    '    Result "fail $version 새 버전을 옮겨 놓지 못해 기존 앱으로 되돌렸습니다."',
    '    if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }',
    '    Move-Item -LiteralPath $backup -Destination $target',
    '    Relaunch',
    '    exit 1',
    '  }',
    '  Relaunch',
    '  Remove-Item -LiteralPath $backup -Recurse -Force -ErrorAction SilentlyContinue',
    '  if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue }',
    "  Log 'done'",
    '} catch {',
    '  Log "fatal: $_"',
    '  Result "fail $version 교체 중 오류가 났습니다 — $_"',
    '  if (-not (Test-Path -LiteralPath $target) -and (Test-Path -LiteralPath $backup)) {',
    '    Move-Item -LiteralPath $backup -Destination $target',
    '  }',
    '  Relaunch',
    '  exit 1',
    '}',
    '',
  ].join('\n');
}
