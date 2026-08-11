// tmux 백엔드 — 세션 영속화의 핵심.
// node-pty 가 직접 셸을 spawn 하는 대신 tmux 클라이언트를 spawn 하면, 실제 셸은
// tmux 서버(별도 프로세스) 소유가 되어 앱을 재시작해도 세션·에이전트가 살아있다.
// 전용 소켓(-L oneapp)과 전용 conf 를 써서 사용자의 개인 tmux 와 완전히 분리한다.
// tmux 미설치면 null — 호출부(pty.ts)가 기존 직접 spawn 으로 폴백한다.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { IS_DEV_INSTANCE } from '../../lib/devInstance';

// -L — 사용자 개인 tmux 서버와 분리.
// ⚠️ 개발 인스턴스는 **소켓부터** 가른다(세션 이름이 아니라) — 이름만 갈라도 같은 tmux
// 서버를 공유하면 목록 질의가 서로의 세션을 보고, 무엇보다 두 앱이 한 세션에 동시 attach 하면
// tmux 가 화면을 **가장 작은 클라이언트 크기**로 맞추고 입력이 양쪽에 미러링된다.
// 소켓이 다르면 tmux 서버 자체가 둘이라 완전히 격리된다(conf 는 내용이 같아 공유해도 무해).
const SOCKET_NAME = IS_DEV_INSTANCE ? 'oneapp-dev' : 'oneapp';
const SESSION_PREFIX = 'oneapp-';
const EXEC_TIMEOUT_MS = 5000;

// Homebrew(애플실리콘/인텔)·시스템 순 — 없으면 로그인 셸 PATH 로 한 번 더 찾는다
const CANDIDATES = ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/usr/bin/tmux'];

// 앱이 시작할 때마다 다시 쓰는 전용 설정 — tmux 를 "보이지 않는 영속화 계층"으로만 쓴다.
// 상태바·프리픽스를 꺼서 사용자는 tmux 의 존재를 모르게 하고, 마우스·BEL·truecolor 는
// 기존(직접 spawn) 동작과 동일하게 패스스루한다.
// ⚠️ terminal-features 의 sync 는 필수 — tmux 기본값(xterm*)엔 sync 가 없어서
// claude 의 동기화 출력(DEC 2026)이 무력화되고, xterm.js 에 그리다 만 중간 프레임이
// 노출돼 화면이 깨져 보인다(반쪽 구분선 등 — 2026-08-05 실측). hyperlinks 도 같은 이유
// (기본값에 없으면 OSC 8 링크가 tmux 에서 소거된다).
const CONF = `# One App 전용 tmux 설정 — 앱이 시작 시마다 덮어쓴다 (직접 수정 금지)
set -g prefix None
set -g status off
set -s escape-time 0
set -g default-terminal "tmux-256color"
set -as terminal-overrides ",xterm-256color:RGB"
set -as terminal-features ",xterm-256color:RGB:sync:hyperlinks"
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
  // conf 는 서버 시작 시에만 읽힌다 — 이전 실행의 서버가 살아있으면(영속 세션)
  // 새 conf 를 반영하도록 재적용한다. 서버가 없으면 조용히 실패(무해).
  if (bin) await run(['source-file', confPath()]);
  return bin;
}

/** 클라이언트 spawn 용 공통 인자 — 서버가 없으면 이 conf 로 새로 뜬다 */
export const tmuxBaseArgs = () => ['-L', SOCKET_NAME, '-f', confPath()];

/** 새 세션 생성+attach 인자 (-A: 이미 있으면 attach — 재시도에 안전) */
export const tmuxNewSessionArgs = (
  name: string,
  cwd: string,
  /** pane 에서 실행할 셸 명령 — 없으면 기본 셸 */
  shellCommand?: string
) => [
  ...tmuxBaseArgs(),
  'new-session',
  '-A',
  '-s',
  name,
  '-c',
  cwd,
  ...(shellCommand ? [shellCommand] : []),
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

/**
 * 대체 화면(alt screen) 여부 — claude 같은 TUI 가 ?1049h 로 켠 상태인지.
 * attach 의 replay 생략 판단에 쓴다 (pane 포맷이라 list-panes -s 로 세션 타깃 질의 —
 * 3.7b 에서 display-message 등 pane 타깃 명령은 '=세션명' 을 못 받는다, 실측).
 */
export async function isTmuxAltScreen(name: string): Promise<boolean> {
  const { ok, stdout } = await run([
    'list-panes',
    '-s',
    '-t',
    `=${name}`,
    '-F',
    '#{alternate_on}',
  ]);
  return ok && stdout.trim().startsWith('1');
}

/**
 * 세션의 pane id (`%0` 형식) — 없으면 null.
 * ⚠️ pane 타깃 명령(copy-mode·send-keys)은 `=세션명` 을 못 받으므로(3.7b 실측) 한 번
 * 조회해서 캐시해 쓴다. 앱 세션은 pane 이 하나뿐이고 그 pane 이 죽으면 세션도 끝난다.
 */
export async function tmuxPaneId(name: string): Promise<string | null> {
  const { ok, stdout } = await run([
    'list-panes',
    '-s',
    '-t',
    `=${name}`,
    '-F',
    '#{pane_id}',
  ]);
  const id = stdout.split('\n')[0]?.trim();
  return ok && id ? id : null;
}

/**
 * 휠 스크롤을 tmux 로 위임한다 — **tmux 가 스크롤백의 주인**이기 때문이다.
 * tmux 클라이언트는 대체 화면으로 붙으므로 xterm 뷰포트엔 스크롤할 것이 없고,
 * xterm 은 그 상태에서 휠을 ↑↓ 키로 바꿔 보내 셸 히스토리가 롤링됐다(사용자 신고).
 *
 * 분기는 tmux 안에서 해서 왕복을 1회로 묶는다:
 * - **대체 화면(TUI)** → 방향키 n회 = xterm 이 하던 기존 동작 그대로 (사용자 선택)
 * - **일반 화면** → `copy-mode -e` 로 올린다. `-e` 라 아래로 되돌려 바닥에 닿으면 자동 종료.
 *
 * @param lines 양수 = 위로, 음수 = 아래로
 * @returns 스크롤 후에도 copy-mode 에 있는지(= 위로 올라가 있는지)
 */
export async function tmuxScrollPane(
  paneId: string,
  lines: number
): Promise<{ scrolledUp: boolean }> {
  const n = String(Math.min(Math.abs(lines), 200)); // 트랙패드 급가속 상한
  const branch =
    lines > 0
      ? [
          `send-keys -t ${paneId} -N ${n} Up`,
          `copy-mode -e -t ${paneId} ; send-keys -X -t ${paneId} -N ${n} scroll-up`,
        ]
      : [
          `send-keys -t ${paneId} -N ${n} Down`,
          // 이미 copy-mode 일 때만 — 바닥에서 진입하면 빈 모드에 들어갔다 나올 뿐이다
          `if-shell -F -t ${paneId} '#{pane_in_mode}' "send-keys -X -t ${paneId} -N ${n} scroll-down"`,
        ];
  const { ok, stdout } = await run([
    'if-shell',
    '-F',
    '-t',
    paneId,
    '#{alternate_on}',
    ...branch,
    ';', // 같은 호출에서 결과 상태까지 회수 — [맨 아래로] 버튼 판정에 쓴다
    'list-panes',
    '-t',
    paneId,
    '-F',
    '#{pane_in_mode}',
  ]);
  return { scrolledUp: ok && stdout.trim().startsWith('1') };
}

/** copy-mode 종료 = 맨 아래로. 모드가 아니면 실패하지만 무해하다(exit 1). */
export async function tmuxExitCopyMode(paneId: string): Promise<void> {
  await run(['send-keys', '-X', '-t', paneId, 'cancel']);
}

/**
 * 세션에 붙은 클라이언트 전체 리프레시 — tmux 가 자기 화면 모델로 전체를 다시 그린다.
 * SIGWINCH 토글(rows±1)과 달리 내부 앱(claude)을 건드리지 않아 이중 리플로우가 없고,
 * sync 광고와 함께면 원자적 프레임으로 온다. (refresh-client 는 target-client(tty) 만
 * 받으므로 list-clients 로 tty 를 먼저 찾는다)
 */
export async function refreshTmuxClients(name: string): Promise<void> {
  const { ok, stdout } = await run([
    'list-clients',
    '-t',
    `=${name}`,
    '-F',
    '#{client_tty}',
  ]);
  if (!ok) return;
  const ttys = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  await Promise.all(ttys.map((tty) => run(['refresh-client', '-t', tty])));
}
