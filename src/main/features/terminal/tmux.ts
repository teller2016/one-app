// tmux 백엔드 — 세션 영속화의 핵심.
// node-pty 가 직접 셸을 spawn 하는 대신 tmux 클라이언트를 spawn 하면, 실제 셸은
// tmux 서버(별도 프로세스) 소유가 되어 앱을 재시작해도 세션·에이전트가 살아있다.
// 전용 소켓(-L oneapp)과 전용 conf 를 써서 사용자의 개인 tmux 와 완전히 분리한다.
// tmux 미설치면 null — 호출부(pty.ts)가 기존 직접 spawn 으로 폴백한다.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

const SOCKET_NAME = 'oneapp'; // -L — 사용자 개인 tmux 서버와 분리
const SESSION_PREFIX = 'oneapp-';
const EXEC_TIMEOUT_MS = 5000;

// Homebrew(애플실리콘/인텔)·시스템 순 — 없으면 로그인 셸 PATH 로 한 번 더 찾는다
const CANDIDATES = ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/usr/bin/tmux'];

// 앱이 시작할 때마다 다시 쓰는 전용 설정 — tmux 를 "보이지 않는 영속화 계층"으로만 쓴다.
// 상태바·프리픽스를 꺼서 사용자는 tmux 의 존재를 모르게 하고, 마우스·BEL·truecolor 는
// 기존(직접 spawn) 동작과 동일하게 패스스루한다.
const CONF = `# One App 전용 tmux 설정 — 앱이 시작 시마다 덮어쓴다 (직접 수정 금지)
set -g prefix None
set -g status off
set -s escape-time 0
set -g default-terminal "tmux-256color"
set -as terminal-overrides ",xterm-256color:RGB"
set -g history-limit 10000
set -g bell-action any
set -g focus-events on
set -g mouse off
`;

let tmuxBin: string | null = null;
let initPromise: Promise<string | null> | null = null;

const confPath = () => path.join(app.getPath('userData'), 'tmux.conf');

/** tmux 세션 이름 규칙 — 앱 세션 id 와 1:1 */
export const tmuxSessionName = (id: string) => `${SESSION_PREFIX}${id}`;
/** tmux 세션 이름 → 앱 세션 id (규칙 밖 이름이면 null) */
export const sessionIdFromTmuxName = (name: string) =>
  name.startsWith(SESSION_PREFIX) ? name.slice(SESSION_PREFIX.length) : null;

/**
 * tmux 탐색 + conf 준비 — 앱 시작 시 1회. 이후 getTmuxBin() 은 동기.
 * 후보 경로에 없으면 로그인 셸 PATH(zsh -lc)로 폴백 — agents.ts 감지와 같은 방식.
 */
export function initTmux(): Promise<string | null> {
  if (!initPromise) initPromise = detect();
  return initPromise;
}

/** 탐색 완료 후의 tmux 경로 — null 이면 미설치(직접 spawn 폴백) */
export const getTmuxBin = () => tmuxBin;

async function detect(): Promise<string | null> {
  let bin = CANDIDATES.find((p) => fs.existsSync(p)) ?? null;
  if (!bin) {
    bin = await new Promise<string | null>((resolve) => {
      execFile(
        '/bin/zsh',
        ['-lc', 'whence -p tmux'],
        { timeout: 10_000 },
        (_err, stdout) => resolve(String(stdout).trim() || null)
      );
    });
  }
  if (bin) {
    try {
      fs.writeFileSync(confPath(), CONF, 'utf8');
    } catch (e) {
      console.error('[tmux] conf 쓰기 실패 — 직접 spawn 으로 폴백:', e);
      bin = null;
    }
  }
  tmuxBin = bin;
  return bin;
}

/** 클라이언트 spawn 용 공통 인자 — 서버가 없으면 이 conf 로 새로 뜬다 */
export const tmuxBaseArgs = () => ['-L', SOCKET_NAME, '-f', confPath()];

/** 새 세션 생성+attach 인자 (-A: 이미 있으면 attach — 재시도에 안전) */
export const tmuxNewSessionArgs = (name: string, cwd: string) => [
  ...tmuxBaseArgs(),
  'new-session',
  '-A',
  '-s',
  name,
  '-c',
  cwd,
];

/** 기존 세션 재접속 인자 (앱 재시작 복원용) */
export const tmuxAttachArgs = (name: string) => [
  ...tmuxBaseArgs(),
  'attach-session',
  '-t',
  `=${name}`, // '=' 접두사 — 부분 일치 방지, 정확히 이 이름만
];

/** tmux CLI 1회 실행 — 서버 없음(exit 1)도 정상 흐름이므로 결과만 반환 */
function run(args: string[]): Promise<{ ok: boolean; stdout: string }> {
  const bin = tmuxBin;
  if (!bin) return Promise.resolve({ ok: false, stdout: '' });
  return new Promise((resolve) => {
    execFile(bin, [...tmuxBaseArgs(), ...args], { timeout: EXEC_TIMEOUT_MS }, (err, stdout) =>
      resolve({ ok: !err, stdout: String(stdout) })
    );
  });
}

/** 살아있는 앱 세션 이름 목록 (oneapp-* 만) — 서버가 없으면 빈 배열 */
export async function listTmuxSessions(): Promise<string[]> {
  const { ok, stdout } = await run(['list-sessions', '-F', '#{session_name}']);
  if (!ok) return [];
  return stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((name) => name.startsWith(SESSION_PREFIX));
}

/** 세션 생존 확인 — 외부 detach 와 진짜 종료를 구분할 때 쓴다 */
export async function hasTmuxSession(name: string): Promise<boolean> {
  const { ok } = await run(['has-session', '-t', `=${name}`]);
  return ok;
}

/** 세션 종료 — attach 중인 클라이언트도 함께 끊긴다(onExit 흐름으로 정리) */
export async function killTmuxSession(name: string): Promise<boolean> {
  const { ok } = await run(['kill-session', '-t', `=${name}`]);
  return ok;
}
