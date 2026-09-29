// 포트 기능 IPC — 리스닝 포트 목록 조회와 프로세스 종료.
//
// "포트가 이미 사용 중" 이라고 뜰 때마다 lsof 로 찾아 kill 하던 일을 화면에서 끝내는 것이 목적이다.
import { execFile } from 'node:child_process';
import { ipcMain } from 'electron';
import type { PortKillResult, PortProcess } from '../../../shared/types';
import { sleep } from '../../lib/util';
import { listProjects } from '../projects/store';
import { buildProcesses, parseCwds, parseListeners } from './lsof';

const LSOF = '/usr/sbin/lsof';
const EXEC_TIMEOUT_MS = 5_000;

/**
 * ⚠️ **`-p` 에 넘기는 PID 는 20개까지다.** 그보다 많으면 lsof 가 **에러 없이 빈 결과**를 돌려준다
 * (2026-09-23 실측: 20개 → 20건, 30개 → 0건). 조용히 실패하므로 cwd 가 통째로 비는 것으로만 보인다.
 */
const CWD_CHUNK = 20;

/** lsof 실행 — 실패해도 빈 문자열로 넘긴다(포트 하나 못 읽었다고 화면을 막지 않는다) */
function runLsof(args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      LSOF,
      args,
      { timeout: EXEC_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
      // ⚠️ lsof 는 일부 프로세스에 접근하지 못하면 **0이 아닌 코드로 끝내면서도 정상 출력을 준다**.
      // 에러라고 버리면 목록이 통째로 비므로 stdout 을 그대로 쓴다.
      (_err, stdout) => resolve(stdout ?? ''),
    );
  });
}

/** 리스닝 중인 포트 목록 — 프로젝트 매칭과 보호 표시까지 붙여서 돌려준다 */
async function listPorts(): Promise<PortProcess[]> {
  const raw = await runLsof(['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pcLn']);
  const procs = parseListeners(raw);
  if (procs.length === 0) return [];

  // cwd 는 프로세스마다 한 번씩 부르면 수십 회가 되므로 묶어서 부른다(20개 제한은 위 상수 참고)
  const pids = [...new Set(procs.map((p) => p.pid))];
  const cwds = new Map<number, string>();
  for (let i = 0; i < pids.length; i += CWD_CHUNK) {
    const chunk = pids.slice(i, i + CWD_CHUNK).join(',');
    const out = await runLsof(['-a', '-p', chunk, '-d', 'cwd', '-F', 'pn']);
    for (const [pid, cwd] of parseCwds(out)) cwds.set(pid, cwd);
  }
  return buildProcesses(procs, cwds, listProjects(), process.pid);
}

/** 프로세스가 아직 살아 있는가 — 신호 0 은 보내지 않고 존재만 확인한다 */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * 종료 직전 재확인 — 목록을 받은 뒤 시간이 지났으면 그 PID 가 **다른 프로세스로 재사용**됐을 수 있다
 * (목록은 자동 갱신되지 않는다). 이름이 목록 때와 같아야 하고, 첫 종료(SIGTERM)는 아직 리스닝 중이어야
 * 한다. 강제 종료는 SIGTERM 을 받고 정리 중이라 리스닝을 먼저 놓았을 수 있어 이름만 본다.
 * 이름은 목록과 같은 lsof `c` 필드라 잘림 규칙도 같다 — 그대로 비교한다.
 */
async function verifyTarget(
  pid: number,
  expectCommand: string,
  requireListening: boolean,
): Promise<string | null> {
  const args = requireListening
    ? ['-a', '-p', String(pid), '-iTCP', '-sTCP:LISTEN', '-F', 'pcn']
    : ['-a', '-p', String(pid), '-d', 'cwd', '-F', 'pc'];
  const found = parseListeners(await runLsof(args)).find((p) => p.pid === pid);
  if (!found) {
    return requireListening
      ? '그 프로세스는 이제 포트를 쓰고 있지 않습니다 — 목록을 새로고침하세요.'
      : '이미 종료된 프로세스입니다.';
  }
  if (found.command !== expectCommand) {
    return `프로세스 번호 ${pid} 가 다른 프로그램(${found.command})으로 바뀌었습니다 — 목록을 새로고침하세요.`;
  }
  return null;
}

/**
 * 프로세스 종료 — 기본은 SIGTERM(정리할 기회를 준다), `force` 면 SIGKILL.
 * 보낸 뒤 잠깐 기다렸다가 생존 여부를 돌려줘서, 화면이 [강제 종료]를 이어서 제안할 수 있게 한다.
 */
async function killPort(
  pid: number,
  force: boolean,
  expectCommand: unknown,
): Promise<PortKillResult> {
  if (!Number.isInteger(pid) || pid <= 1) {
    return { ok: false, alive: true, message: '잘못된 프로세스 번호입니다.' };
  }
  if (pid === process.pid) {
    return { ok: false, alive: true, message: 'One App 자신은 여기서 종료할 수 없습니다.' };
  }
  if (typeof expectCommand !== 'string' || !expectCommand) {
    return { ok: false, alive: true, message: '종료할 프로세스 이름이 없습니다.' };
  }
  const mismatch = await verifyTarget(pid, expectCommand, !force);
  if (mismatch) return { ok: false, alive: false, message: mismatch };
  try {
    process.kill(pid, force ? 'SIGKILL' : 'SIGTERM');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return { ok: true, alive: false, message: '이미 종료된 프로세스입니다.' };
    if (code === 'EPERM') {
      return { ok: false, alive: true, message: '권한이 없어 종료하지 못했습니다 (다른 사용자·시스템 소유).' };
    }
    return { ok: false, alive: true, message: `종료하지 못했습니다: ${String(err)}` };
  }
  // SIGTERM 은 프로세스가 정리를 마칠 시간이 필요하다 — 바로 확인하면 아직 살아 있다
  await sleep(force ? 300 : 1_200);
  const alive = isAlive(pid);
  return {
    ok: !alive,
    alive,
    message: alive
      ? '아직 살아 있습니다 — 강제 종료가 필요합니다.'
      : force
        ? '강제 종료했습니다.'
        : '종료했습니다.',
  };
}

/** 포트 관련 IPC 등록 (데스크톱 전용 — 폰에서 프로세스를 죽일 이유가 없다) */
export function registerPortsIpc() {
  ipcMain.handle('ports:list', async () => listPorts());
  ipcMain.handle('ports:kill', async (_e, pid: number, force = false, expectCommand?: string) =>
    killPort(pid, force === true, expectCommand),
  );
}
