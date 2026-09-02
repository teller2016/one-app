// 워크트리를 IDE 로 여는 대상 — 앱 번들을 직접 찾는다(CLI 는 사용자가 PATH 에
// 설치했을 때만 있으므로 기대하지 않는다). 없으면 렌더러가 버튼 자체를 감춘다.
// ipc.ts(워크스페이스 IDE 버튼)와 terminal/ipc.ts(세션 탭·팝아웃 헤더의 IDE 버튼)가 공유한다.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const EDITOR_NAME = 'Antigravity';
const EDITOR_APP = 'Antigravity IDE.app';

export function findEditorApp(): string | null {
  for (const dir of ['/Applications', join(homedir(), 'Applications')]) {
    const p = join(dir, EDITOR_APP);
    if (existsSync(p)) return p;
  }
  return null;
}

/** `open -a <앱> <폴더>` — VS Code 계열은 폴더를 창으로 연다.
 *  ⚠️ `shell.openPath` 는 Finder 용이라 IDE 로 열리지 않는다(terminal.md). */
export function openWithApp(app: string, dir: string) {
  return new Promise<{ ok: boolean; error?: string }>((resolve) => {
    execFile('open', ['-a', app, dir], (err) =>
      resolve({ ok: !err, error: err?.message })
    );
  });
}
