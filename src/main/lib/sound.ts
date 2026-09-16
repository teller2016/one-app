// 알림음 (공통 유틸) — macOS 사운드 파일을 afplay 로 울린다.
// 시스템 경고음(shell.beep) 대신 전용 음원을 쓰는 이유는 다른 앱의 경고음과 구분하기 위해서고,
// 기능마다 다른 음을 배정해 **소리만 듣고 어느 알림인지** 알 수 있게 한다.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// 사용자 폴더를 먼저 둔다 — 같은 이름이면 개인 음원이 시스템 음원을 이긴다(macOS 와 같은 규칙).
const SOUND_DIRS = [
  path.join(os.homedir(), 'Library', 'Sounds'),
  '/System/Library/Sounds',
];
const SOUND_EXTS = ['.aiff', '.aif', '.wav', '.m4a', '.mp3', '.caf'];

// 목록 캐시 — 환경설정 화면이 열릴 때마다 두 폴더를 읽을 이유가 없다.
const LIST_TTL_MS = 60_000;
let cache: { at: number; names: string[]; paths: Map<string, string> } | null = null;

function scan(): { names: string[]; paths: Map<string, string> } {
  const paths = new Map<string, string>();
  for (const dir of SOUND_DIRS) {
    let files: string[];
    try {
      files = fs.readdirSync(dir);
    } catch {
      continue; // 사용자 폴더는 없는 것이 기본이다
    }
    for (const f of files) {
      const ext = path.extname(f).toLowerCase();
      if (!SOUND_EXTS.includes(ext)) continue;
      const name = path.basename(f, path.extname(f));
      if (!paths.has(name)) paths.set(name, path.join(dir, f)); // 먼저 온 폴더(사용자) 우선
    }
  }
  return { names: [...paths.keys()].sort((a, b) => a.localeCompare(b)), paths };
}

function read(): { names: string[]; paths: Map<string, string> } {
  if (cache && Date.now() - cache.at < LIST_TTL_MS) return cache;
  const scanned = scan();
  cache = { at: Date.now(), ...scanned };
  return cache;
}

/** 고를 수 있는 알림음 이름 목록 (가나다·알파벳 순) — 환경설정 드롭다운이 쓴다 */
export function listSounds(): string[] {
  return read().names;
}

/** 그 이름의 음원이 실제로 있는가 — 설정값을 저장하기 전에 확인한다 */
export function isKnownSound(name: string): boolean {
  return read().paths.has(name);
}

/**
 * 알림음 재생 — 재생 실패는 무시한다.
 * 소리는 어디까지나 **부가 신호**라, 안 나더라도 뱃지·토스트는 그대로 동작해야 한다.
 * ⚠️ 이름을 경로로 조립하지 않고 **스캔 목록에서 찾은 경로만** 넘긴다 — 설정 파일을 손으로
 * 고치거나 폰에서 값이 넘어와도 임의 파일을 실행하는 통로가 되지 않게.
 */
export function playSound(name: string): void {
  const file = read().paths.get(name);
  if (!file) return;
  execFile('afplay', [file], () => {
    // 재생 실패(음원 삭제·권한 등)는 무시
  });
}
