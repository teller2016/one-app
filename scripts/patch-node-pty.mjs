#!/usr/bin/env node
// node-pty 1.1.0 의 macOS 네이티브(`pty_posix_spawn`) fd 누수 패치 + 리빌드.
//
// 무엇이 새는가 (2026-08-27 메모리 감사에서 실측·재현 — 세션 생성→종료 1회마다 fd 3개 영구 잔류):
//   ① fd 번호 확보용 프로브 `low_fds[count] = posix_openpt()` 를 `for (; count > 0; count--)`
//      로 닫는데, 첫 프로브가 바로 fd≥3 이면 count==0 이라 루프가 한 번도 안 돌아 `low_fds[0]`
//      (/dev/ptmx 마스터)이 영영 남는다.
//   ② 부모가 `slave = open(...)` 으로 연 슬레이브를 자식에만 dup2/close 하고 부모 쪽에서는
//      닫지 않아, 자식이 죽으면 `(revoked)` fd 로 남는다.
//   ③ 종료 감시 스레드가 `kqueue()` 로 NOTE_EXIT 를 기다린 뒤 kq 를 닫지 않는다(KQUEUE fd 잔류).
// 둘 다 upstream `main` 에는 고쳐져 있으나(2026-08 기준) 릴리스 1.1.0 에는 미포함이다.
// 새 릴리스가 나오면 이 스크립트는 "이미 패치됨" 으로 조용히 통과하거나(같은 코드) 지워도 된다.
//
// 앱 코드로는 못 고친다 — 마스터는 node-pty 가 200ms 타이머로 닫아 주지만 위 두 fd 는 JS 에
// 노출되지 않는다. 그래서 소스를 고치고 `electron-rebuild` 로 build/Release 를 다시 만든다
// (node-pty 로더는 build/Release → prebuilds 순으로 찾는다 — lib/utils.js loadNativeModule).
//
// 실행: postinstall 에서 자동. 강제 리빌드는 `node scripts/patch-node-pty.mjs --force`.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'node_modules/node-pty/src/unix/pty.cc');
const force = process.argv.includes('--force');

if (!fs.existsSync(src)) {
  console.log('[patch-node-pty] node-pty 소스가 없어 건너뜀:', src);
  process.exit(0);
}

let code = fs.readFileSync(src, 'utf8');
let changed = false;

const edits = [
  {
    name: '① 프로브 fd 전부 닫기 (low_fds[0] 누수)',
    from: `  for (; count > 0; count--) {
    close(low_fds[count]);
  }`,
    to: `  // one-app 패치: 프로브로 연 fd 는 low_fds[0..count] 전부다 (원본은 [0] 을 영영 안 닫았다)
  for (size_t i = 0; i <= count && i < 3; i++) {
    close(low_fds[i]);
  }`,
  },
  {
    name: '② 부모 쪽 slave fd 닫기 (revoked fd 누수)',
    from: `done:
  posix_spawn_file_actions_destroy(&acts);
  posix_spawnattr_destroy(&attrs);
`,
    to: `done:
  posix_spawn_file_actions_destroy(&acts);
  posix_spawnattr_destroy(&attrs);
  // one-app 패치: 슬레이브는 자식 것이다 — 부모가 쥐고 있으면 자식 종료 후 (revoked) 로 남는다
  if (slave != -1) {
    close(slave);
  }
`,
  },
  {
    // 종료 감시 스레드(kqueue 로 NOTE_EXIT 대기)가 kq 를 안 닫는다 — 세션마다 KQUEUE fd 1개 잔류
    // (2026-08-27 E2E: create→kill 6회에 kqueue 16→22, 회수 안 됨)
    name: '③ 종료 감시 스레드의 kqueue fd 닫기',
    from: `          HANDLE_EINTR(waitpid(pid, &stat_loc, 0));
        }
      }
    }
#else`,
    to: `          HANDLE_EINTR(waitpid(pid, &stat_loc, 0));
        }
      }
    }
    // one-app 패치: kqueue fd 는 스레드가 끝나도 안 닫혀 세션마다 하나씩 남았다
    if (kq != -1) {
      close(kq);
    }
#else`,
  },
];

for (const e of edits) {
  if (code.includes(e.to)) {
    console.log(`[patch-node-pty] 이미 적용됨: ${e.name}`);
    continue;
  }
  if (!code.includes(e.from)) {
    console.error(`[patch-node-pty] ⚠️ 패치 지점을 못 찾음(node-pty 버전이 바뀐 듯): ${e.name}`);
    console.error('  → 새 버전에 이 누수가 이미 고쳐졌는지 확인하고 스크립트를 갱신/삭제할 것');
    // 구버전 소스로 컴파일된 build/Release 가 남아 있으면 로더가 그것을 먼저 집어 새 JS 와 어긋난다
    // → 지워서 새 버전의 prebuilds 가 로드되게 한다(Forge 가 필요하면 다시 컴파일한다)
    fs.rmSync(path.join(root, 'node_modules/node-pty/build'), { recursive: true, force: true });
    process.exit(0); // 설치 자체는 막지 않는다
  }
  code = code.replace(e.from, e.to);
  changed = true;
  console.log(`[patch-node-pty] 적용: ${e.name}`);
}
if (changed) fs.writeFileSync(src, code);

if (!changed && !force) {
  console.log('[patch-node-pty] 변경 없음 — 리빌드 생략');
  process.exit(0);
}

console.log('[patch-node-pty] electron-rebuild 로 node-pty 재컴파일 중…');
const bin = path.join(root, 'node_modules/.bin/electron-rebuild');
const r = spawnSync(bin, ['-f', '-w', 'node-pty'], { cwd: root, stdio: 'inherit' });
if (r.status !== 0) {
  console.error('[patch-node-pty] ⚠️ 리빌드 실패 — 기존 바이너리(누수 있음)를 그대로 쓴다');
  process.exit(0);
}
// spawn-helper 는 확장자 없는 실행 파일 — 권한을 보정한다 (prebuilds 쪽 보정과 동일)
const helper = path.join(root, 'node_modules/node-pty/build/Release/spawn-helper');
if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755);
console.log('[patch-node-pty] 완료');
