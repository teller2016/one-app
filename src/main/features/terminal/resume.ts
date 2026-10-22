// 재부팅 복원 — 기록 쪽. 컴퓨터를 껐다 켜면 tmux 서버가 사라져 세션이 전부 죽지만, 그 안의 claude 대화는
// 디스크(jsonl)에 남아 있어 sessionId 만 알면 `--resume` 으로 이어 띄울 수 있다(다시 띄우기는 pty.ts restoreSessions).
//
// 세션 출력이 멎을 때(busy → 대기·쉼 = 턴이 끝날 때)마다 그 안의 claude 를 찾아 sidecar 에 적는다. 종료 직전에
// 한 번 적는 방식은 강제 종료·배터리 방전에 못 미친다. `/clear`·`/resume` 으로 sessionId 가 바뀌어도 다음 턴에
// 따라가고, claude 를 끝내 셸만 남으면 기록을 지운다 — 순수 셸 탭은 복원하지 않는다(2026-10-06 사용자 결정).
// ⚠️ 'waiting' 전이만 보지 말 것 — 셸 세션은 waiting 이 없어(status.ts) 셸 탭에서 손으로 띄운 claude 를 놓친다.
import { execFile } from 'node:child_process';
import type { TerminalSessionStatus } from '../../../shared/types';
import { findClaude } from './claudeFiles';
import { listSessions, onSessionsChanged } from './pty';
import { detectLauncher, isRevivable } from './resumeCommand';
import { updatePersistedResume } from './sessions-store';

/** 프로세스 실행 인자 — 못 읽으면(그 사이 끝남) null */
function processArgs(pid: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('/bin/ps', ['-o', 'args=', '-p', String(pid)], { timeout: 3000 }, (err, stdout) => {
      const out = String(stdout).trim();
      resolve(err || !out ? null : out);
    });
  });
}

const inflight = new Set<string>(); // 같은 세션의 기록이 겹치지 않게

async function capture(id: string): Promise<void> {
  if (inflight.has(id)) return;
  inflight.add(id);
  try {
    const claude = await findClaude(id);
    if (!claude) {
      updatePersistedResume(id, undefined); // claude 가 없다 — 셸만 남은 탭
      return;
    }
    const args = await processArgs(claude.pid);
    if (args === null) return; // 그 사이 끝났다 — 다음 대기 때 다시 본다
    if (!isRevivable(args)) {
      updatePersistedResume(id, undefined); // 도구를 막고 띄운 claude — 제한 없이 되살리지 않는다
      return;
    }
    updatePersistedResume(id, {
      ...detectLauncher(args),
      sessionId: claude.sessionId,
      configDir: claude.configDir,
      cwd: claude.cwd,
      file: claude.file,
    });
  } catch (e) {
    console.error(`[terminal] 재개 정보 기록 실패 (${id}):`, e);
  } finally {
    inflight.delete(id);
  }
}

// 출력이 멎고 이만큼 조용하면 기록한다 — 셸에서 타이핑하며 멈칫할 때마다 `ps` 를 돌리지 않게 모은다
const CAPTURE_SETTLE_MS = 2000;

/** 출력이 멎을 때마다 재개 정보를 기록한다 — ipc.ts 가 앱 시작 시 한 번 건다 */
export function trackResume(): void {
  const prev = new Map<string, TerminalSessionStatus>();
  const timers = new Map<string, NodeJS.Timeout>();
  onSessionsChanged(() => {
    const alive = new Set<string>();
    for (const s of listSessions()) {
      alive.add(s.id);
      const before = prev.get(s.id);
      prev.set(s.id, s.status);
      if (before !== 'busy' || s.status === 'busy') continue;
      clearTimeout(timers.get(s.id));
      timers.set(
        s.id,
        setTimeout(() => {
          timers.delete(s.id);
          void capture(s.id);
        }, CAPTURE_SETTLE_MS)
      );
    }
    for (const id of prev.keys()) {
      if (alive.has(id)) continue;
      prev.delete(id);
      clearTimeout(timers.get(id));
      timers.delete(id);
    }
  });
}
