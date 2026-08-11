// PTY 세션 관리 — 메인 프로세스가 세션의 단일 소유자(단일 진실).
// 데스크톱(IPC 경유)과 모바일(WS 경유)이 같은 세션에 attach 해 입출력을 공유하고,
// 세션은 창·클라이언트와 무관하게 One App 이 실행 중인 동안 유지된다.
//
// tmux 백엔드(설치 시): node-pty 가 셸 대신 tmux 클라이언트를 spawn 한다.
// 실제 셸은 tmux 서버(-L oneapp) 소유라 앱을 재시작해도 세션·에이전트가 살아있고,
// 시작 시 restoreSessions() 가 sidecar(terminal-sessions.json)와 대조해 재접속한다.
// tmux 미설치면 기존 직접 spawn — 이 경우 세션은 앱 수명과 같다(영속 없음).
import * as pty from 'node-pty';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type {
  TerminalAttachResult,
  TerminalCreateInput,
  TerminalSessionInfo,
  TerminalSessionStatus,
} from '../../../shared/types';
import { getProject } from '../projects/store';
import { agentCommand } from './agents';
import {
  listPersisted,
  removePersisted,
  savePersisted,
  updatePersistedSize,
  updatePersistedTitle,
} from './sessions-store';
import {
  getTmuxBin,
  hasTmuxSession,
  initTmux,
  isTmuxAltScreen,
  killTmuxSession,
  listTmuxSessions,
  refreshTmuxClients,
  sessionIdFromTmuxName,
  tmuxAttachArgs,
  tmuxExitCopyMode,
  tmuxNewSessionArgs,
  tmuxPaneId,
  tmuxScrollPane,
  tmuxSessionName,
} from './tmux';

const RING_MAX_BYTES = 512 * 1024; // attach replay 용 출력 보관 상한 (chunk 단위 링버퍼)
const BATCH_MS = 16; // 출력 배칭 — 대량 출력 시 IPC/WS 이벤트 폭주 방지
const REDRAW_TOGGLE_MS = 40; // SIGWINCH 토글 간격 — TUI(claude CLI 등) 강제 리렌더용

// ── 상태 휴리스틱 상수 — "스피너=busy 유지, 완전 침묵=waiting" 방식.
// claude 스피너는 ~1Hz 로 계속 그리므로 완전 침묵 = 턴 종료로 안전하다.
// (대기 화면이 주기 출력을 하는 것으로 실측되면 "2초 윈도 출력 < 80B" 판정으로 전환할 것)
const WAIT_SILENCE_MS = 2500; // busy → waiting/idle 판정 침묵 시간
const BEL_SILENCE_MS = 300; // bare BEL(에이전트의 주의 요청) 후에는 짧은 침묵으로 조기 판정
// 입력 후 이 이상 출력해야 "턴 산출물" — 마지막 키 에코 수준(수 바이트)만 거른다.
// ⚠️ 크게 잡으면(600) claude 래퍼의 계정 선택 프롬프트(145B) 같은 작은 입력 대기를 놓친다(2026-08 실측).
// 타이핑 멈춤 오탐은 바이트가 아니라 NOTIFY_INPUT_GAP_MS(알림 게이트)가 막는다.
const MIN_TURN_BYTES = 50;
// 최근 입력 직후의 waiting 전이는 상태(뱃지)만 바꾸고 소리·알럿은 생략 —
// 타이핑을 잠깐 멈춘 사용자는 이미 프롬프트 앞에 있다(불러올 필요가 없다)
const NOTIFY_INPUT_GAP_MS = 5000;
const CREATE_NOTIFY_GRACE_MS = 20_000; // 생성 직후 첫 waiting 알림 억제 (방금 만든 사용자에게 소음)
const STATUS_TICK_MS = 1000; // 침묵 판정 틱 (세션별 타이머 대신 전역 1개)
const AGENT_LAUNCH_QUIET_MS = 350; // 출력이 이만큼 잠잠해지면 프롬프트가 완성됐다고 본다
const AGENT_LAUNCH_MAX_WAIT_MS = 3000; // 출력이 계속 이어지는 셸 테마 대비 발사 상한
const STATUS_DEBUG = process.env.ONEAPP_TERM_DEBUG === '1'; // 상수 보정용 전이 로그
/** 세션 수명 로그 — 생성·자동 실행·종료. 프리셋 세션이 곧바로 사라질 때 원인을 좁힌다 */
const life = (...args: unknown[]) => {
  if (STATUS_DEBUG) console.log('[term:life]', ...args);
};
const TITLE_MAX_LEN = 60; // 사용자 지정 제목 상한 — 목록은 한 줄 ellipsis 라 그 이상은 무의미

type Session = {
  id: string;
  pty: pty.IPty; // tmux 백엔드면 attach 클라이언트 — 재접속 시 교체된다
  tmuxName?: string; // tmux 세션 이름 (없으면 직접 spawn 폴백 — 영속 없음)
  killing: boolean; // killSession 진행 중 — onExit 의 재attach 방어와 구분용
  title: string;
  cwd: string;
  cols: number;
  rows: number;
  agentId: TerminalSessionInfo['agentId'];
  projectId?: string;
  projectName?: string;
  createdAt: number;
  ring: string[]; // 출력 chunk 링버퍼 (시퀀스 중간 절단을 줄이려 chunk 단위로 버림)
  ringBytes: number;
  pending: string; // 배칭 대기 출력
  flushTimer: NodeJS.Timeout | null;
  seq: number; // flush 마다 증가 — attach replay 와 라이브 이벤트의 중복 제거 기준
  // ── 상태 휴리스틱 추적값 ──
  status: TerminalSessionStatus;
  lastOutputAt: number; // 마지막 출력 시각
  lastInputAt: number; // 마지막 사용자 입력(writeSession) 시각 — 자동 실행 write 는 제외
  bytesSinceInput: number; // 입력 이후 누적 출력 — "실제 턴 산출물" 판정
  bellAt: number; // 마지막 bare BEL 수신 시각 (0 = 없음)
  notifiedSinceInput: boolean; // 이번 입력(턴)에 대한 waiting 알림 기회를 이미 소진했는지
  suppressNotifyUntil: number; // 이 시각 전의 waiting 전이는 알림 없이 상태만
  // ── 휠 스크롤(tmux copy-mode) 추적값 ──
  paneId?: string; // tmux pane id 캐시 — pane 타깃 명령은 '=세션명' 을 못 받는다
  copyMode: boolean; // 스크롤로 copy-mode 에 올라가 있는지 (입력이 오면 먼저 빠져나온다)
  pendingInput: string; // copy-mode 해제를 기다리는 입력 — 순서 보존용
  exitingCopyMode: boolean; // 해제 명령 진행 중 (중복 실행 방지)
};

const sessions = new Map<string, Session>();
let disposing = false; // 앱 종료 정리 중 — tmux 세션·sidecar 를 건드리지 않는다

// 구독 — ipc.ts(데스크톱 broadcast)와 server.ts(모바일 WS)가 각각 구독한다
type DataListener = (id: string, data: string, seq: number) => void;
type ExitListener = (id: string, exitCode: number) => void;
type ResizeListener = (id: string, cols: number, rows: number) => void;
type WaitingListener = (info: TerminalSessionInfo) => void;
const dataListeners = new Set<DataListener>();
const exitListeners = new Set<ExitListener>();
const changedListeners = new Set<() => void>();
const resizeListeners = new Set<ResizeListener>();
const waitingListeners = new Set<WaitingListener>();

const subscribe = <T>(set: Set<T>, cb: T) => {
  set.add(cb);
  return () => set.delete(cb);
};
/** 세션 출력 구독 (배칭됨). 해제 함수 반환 */
export const onTerminalData = (cb: DataListener) => subscribe(dataListeners, cb);
/** 세션 종료 구독. 해제 함수 반환 */
export const onTerminalExit = (cb: ExitListener) => subscribe(exitListeners, cb);
/** 세션 목록 변경(생성·종료) 구독. 해제 함수 반환 */
export const onSessionsChanged = (cb: () => void) => subscribe(changedListeners, cb);
/** PTY 크기 변경 구독 — 모든 클라이언트가 term.resize 로 따라와야 렌더가 안 깨진다 */
export const onPtyResized = (cb: ResizeListener) => subscribe(resizeListeners, cb);
/** 에이전트 세션의 busy→waiting 전이 구독 — 입력대기 알림(뱃지·소리) 전용 */
export const onAgentWaiting = (cb: WaitingListener) => subscribe(waitingListeners, cb);

const emitChanged = () => changedListeners.forEach((cb) => cb());

const toInfo = (s: Session): TerminalSessionInfo => ({
  id: s.id,
  title: s.title,
  cwd: s.cwd,
  cols: s.cols,
  rows: s.rows,
  agentId: s.agentId,
  projectId: s.projectId,
  projectName: s.projectName,
  status: s.status,
  createdAt: s.createdAt,
});

// ── 상태 휴리스틱 ─────────────────────────────────────────────────────

function setStatus(s: Session, status: TerminalSessionStatus, why: string) {
  if (s.status === status) return;
  if (STATUS_DEBUG) {
    const silence = ((Date.now() - s.lastOutputAt) / 1000).toFixed(1);
    console.log(
      `[term-status] ${s.id} ${s.status}→${status} (${why}) bytes=${s.bytesSinceInput} silence=${silence}s`
    );
  }
  s.status = status;
  emitChanged();
  if (status !== 'waiting') return;
  // 소리·알럿 게이트 — 상태(뱃지)는 위 emitChanged 로 이미 반영됐다.
  // 알림 기회는 입력(턴)당 1회: attach/resize 의 SIGWINCH redraw 가 busy→waiting 을
  // 다시 만들어도(입력 없이) 소리가 중복되지 않는다.
  const now = Date.now();
  const eligible =
    !s.notifiedSinceInput &&
    now >= s.suppressNotifyUntil &&
    now - s.lastInputAt >= NOTIFY_INPUT_GAP_MS;
  s.notifiedSinceInput = true; // 게이트에 걸려 조용히 지나가도 기회는 소진 (뒤늦은 재알림 방지)
  if (eligible) {
    const info = toInfo(s);
    waitingListeners.forEach((cb) => cb(info));
  }
}

// OSC 시퀀스(ESC ] … BEL/ST) 를 제거한 뒤 남는 BEL 만 "주의 요청"으로 신뢰 —
// zsh·claude 모두 창 제목용 OSC 종결자로 BEL 을 쓰므로 필터 없이는 오탐이 폭주한다.
// eslint-disable-next-line no-control-regex -- 터미널 이스케이프 시퀀스 매칭이 목적
const OSC_RE = /\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;
const hasBareBel = (chunk: string) =>
  chunk.includes('\x07') && chunk.replace(OSC_RE, '').includes('\x07');

/** flush 훅 — 출력을 적산하고 busy 전이를 판정한다.
 * attach/resize 의 SIGWINCH redraw 도 busy 로 잡히지만(구분 불가), 침묵 후 원래 상태로
 * 돌아오고 알림은 notifiedSinceInput 이 막으므로 잠깐의 상태 출렁임만 남는다.
 * ⚠️ redraw 를 grace 로 걸러내면 안 된다 — 터미널 섹션을 열어둔 채 세션을 만들면
 * 즉시 attach 되어 첫 렌더(계정 선택 등)가 통째로 grace 에 먹히고 영영 idle 에 갇힌다(2026-08 실측). */
function noteOutput(s: Session, chunk: string) {
  const now = Date.now();
  s.lastOutputAt = now;
  s.bytesSinceInput += Buffer.byteLength(chunk, 'utf8');
  if (s.agentId !== 'shell' && hasBareBel(chunk)) s.bellAt = now;
  if (s.status !== 'busy') setStatus(s, 'busy', 'output');
}

/** writeSession 훅 — 사용자 입력은 "보고 있음" 신호: waiting 해제 + 턴 적산 리셋 */
function noteInput(s: Session) {
  s.lastInputAt = Date.now();
  s.bytesSinceInput = 0;
  s.bellAt = 0;
  s.notifiedSinceInput = false; // 새 턴 — 알림 기회 리셋
  // busy 는 유지 — 작업 중 휠(마우스 트래킹 시퀀스)이 상태를 깜빡이게 하지 않는다
  if (s.status === 'waiting') setStatus(s, 'idle', 'input');
}

/** 전역 침묵 판정 틱 — busy 세션이 조용해지면 waiting(에이전트) 또는 idle 로 내린다 */
function statusTick() {
  const now = Date.now();
  for (const s of sessions.values()) {
    if (s.status !== 'busy') continue;
    // bare BEL 은 에이전트의 명시적 주의 요청 — 짧은 침묵으로 조기 판정 + 바이트 임계 면제
    const bell = s.bellAt > s.lastInputAt;
    const silence = bell ? BEL_SILENCE_MS : WAIT_SILENCE_MS;
    const lastActivity = Math.max(s.lastOutputAt, s.lastInputAt);
    if (now - lastActivity < silence) continue;
    if (s.agentId !== 'shell' && (bell || s.bytesSinceInput >= MIN_TURN_BYTES)) {
      setStatus(s, 'waiting', bell ? 'bel' : 'silence');
    } else {
      // 순수 셸(ls 한 번)과 에코 수준 출력은 waiting 자격이 없다 — 뱃지 오탐 차단
      setStatus(s, 'idle', 'silence');
    }
  }
}

let statusTimer: NodeJS.Timeout | null = null;
const ensureStatusTimer = () => {
  if (!statusTimer) statusTimer = setInterval(statusTick, STATUS_TICK_MS);
};
const stopStatusTimerIfEmpty = () => {
  if (sessions.size === 0 && statusTimer) {
    clearInterval(statusTimer);
    statusTimer = null;
  }
};

/** 배칭 대기 출력을 즉시 내보내고 링버퍼에 적재 */
function flush(s: Session) {
  if (s.flushTimer) {
    clearTimeout(s.flushTimer);
    s.flushTimer = null;
  }
  if (!s.pending) return;
  const chunk = s.pending;
  s.pending = '';
  noteOutput(s, chunk);
  s.ring.push(chunk);
  s.ringBytes += Buffer.byteLength(chunk, 'utf8');
  while (s.ringBytes > RING_MAX_BYTES && s.ring.length > 1) {
    s.ringBytes -= Buffer.byteLength(s.ring.shift() as string, 'utf8');
  }
  s.seq += 1;
  dataListeners.forEach((cb) => cb(s.id, chunk, s.seq));
}

export function listSessions(): TerminalSessionInfo[] {
  return [...sessions.values()].map(toInfo);
}

/** node-pty 공통 옵션 — 직접 spawn·tmux 클라이언트·재attach 가 전부 공유 */
const ptyOptions = (cwd: string, cols: number, rows: number) => ({
  name: 'xterm-256color',
  cols,
  rows,
  cwd: fs.existsSync(cwd) ? cwd : os.homedir(),
  env: {
    ...process.env,
    COLORTERM: 'truecolor',
    LANG: process.env.LANG ?? 'ko_KR.UTF-8',
  } as { [key: string]: string },
});

/** 세션 객체 골격 — 생성·복원이 공유 (휴리스틱 추적값은 전부 0 초기화) */
function makeSession(init: {
  id: string;
  proc: pty.IPty;
  tmuxName?: string;
  title: string;
  cwd: string;
  cols: number;
  rows: number;
  agentId: TerminalSessionInfo['agentId'];
  projectId?: string;
  projectName?: string;
  createdAt: number;
  suppressNotifyUntil: number;
}): Session {
  return {
    id: init.id,
    pty: init.proc,
    tmuxName: init.tmuxName,
    killing: false,
    title: init.title,
    cwd: init.cwd,
    cols: init.cols,
    rows: init.rows,
    agentId: init.agentId,
    projectId: init.projectId,
    projectName: init.projectName,
    createdAt: init.createdAt,
    ring: [],
    ringBytes: 0,
    pending: '',
    flushTimer: null,
    seq: 0,
    status: 'idle',
    lastOutputAt: 0,
    lastInputAt: 0,
    bytesSinceInput: 0,
    bellAt: 0,
    notifiedSinceInput: false,
    suppressNotifyUntil: init.suppressNotifyUntil,
    copyMode: false,
    pendingInput: '',
    exitingCopyMode: false,
  };
}

/** onData(배칭)·onExit 배선 — 재attach 로 pty 가 교체될 때마다 다시 건다 */
function wireSession(s: Session) {
  const proc = s.pty;
  proc.onData((data) => {
    s.pending += data;
    if (!s.flushTimer) {
      s.flushTimer = setTimeout(() => flush(s), BATCH_MS);
    }
  });
  proc.onExit(({ exitCode }) => {
    flush(s);
    life('pty-exit', { id: s.id, exitCode, tmuxName: s.tmuxName, killing: s.killing, disposing });
    if (s.tmuxName && !disposing && !s.killing) {
      // tmux 백엔드 — 클라이언트가 끊긴 것(외부 detach 등)과 세션 종료를 구분한다.
      // 세션이 살아있으면 조용히 재접속해 목록에서 사라지지 않게 한다.
      const name = s.tmuxName;
      void hasTmuxSession(name).then((alive) => {
        life('pty-exit:tmux', { id: s.id, alive });
        if (alive && sessions.get(s.id) === s) scheduleReattach(s);
        else finalizeExit(s, exitCode);
      });
      return;
    }
    finalizeExit(s, exitCode);
  });
}

// reattach 백오프 — attach 클라이언트가 붙자마자 죽는 병리 상태(conf 오류·fd 고갈 등)에서
// exit→has-session→spawn 이 지연 0으로 무한 반복되지 않게 재시도 간격을 지수로 늘린다
// (2026-08-07 성능 감사). 정상 detach 복구는 첫 회(지연 0)라 체감 지연이 없고,
// 마지막 시도 후 30초 넘게 살아 있었으면 정상으로 보고 카운터를 리셋한다.
const REATTACH_BASE_MS = 500;
const REATTACH_MAX_MS = 10_000;
const REATTACH_RESET_MS = 30_000;
const reattachState = new Map<string, { count: number; lastAt: number }>();

function scheduleReattach(s: Session) {
  const prev = reattachState.get(s.id);
  const now = Date.now();
  const count = prev && now - prev.lastAt < REATTACH_RESET_MS ? prev.count + 1 : 0;
  reattachState.set(s.id, { count, lastAt: now });
  if (count === 0) {
    reattach(s);
    return;
  }
  const delay = Math.min(REATTACH_BASE_MS * 2 ** (count - 1), REATTACH_MAX_MS);
  setTimeout(() => {
    if (disposing || sessions.get(s.id) !== s) return;
    reattach(s);
  }, delay);
}

/** 세션 종말 처리 — 목록 제거·sidecar 정리·exit 전파 (중복 호출 안전) */
function finalizeExit(s: Session, exitCode: number) {
  if (sessions.get(s.id) !== s) return; // disposeAll 등으로 이미 정리됨
  // killSession 실패 경로 등 flush 를 안 거치고 오는 경우 — 죽은 세션의 배칭 타이머가
  // 한 번 더 발화해 유령 데이터를 내보내지 않게 여기서도 정리한다
  if (s.flushTimer) {
    clearTimeout(s.flushTimer);
    s.flushTimer = null;
  }
  reattachState.delete(s.id);
  sessions.delete(s.id);
  if (s.tmuxName) removePersisted(s.id); // tmux 세션이 실제로 죽었을 때만 온다
  stopStatusTimerIfEmpty();
  exitListeners.forEach((cb) => cb(s.id, exitCode));
  emitChanged();
}

/** 살아있는 tmux 세션에 attach 클라이언트만 다시 붙인다 (외부 detach 복구) */
function reattach(s: Session) {
  const bin = getTmuxBin();
  if (!bin || !s.tmuxName) {
    finalizeExit(s, 0);
    return;
  }
  try {
    s.pty = pty.spawn(bin, tmuxAttachArgs(s.tmuxName), ptyOptions(s.cwd, s.cols, s.rows));
  } catch {
    finalizeExit(s, 0);
    return;
  }
  // attach 의 redraw 가 만드는 합성 waiting 이 소리내지 않게 (attachSession 과 같은 이유)
  if (s.status !== 'busy') s.notifiedSinceInput = true;
  wireSession(s);
}

/** 작은따옴표 셸 인용 — 임의 명령을 sh 한 줄에 안전하게 끼워 넣는다 */
const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * tmux `new-session` 에 넘길 셸 명령 — **명령을 pane 입력으로 주입하지 않고 여기서 실행**한다.
 *
 * ⚠️ 예전에는 셸을 띄운 뒤 PTY 에 명령을 write 했는데, 그 시점이 zsh 의 ZLE 초기화·히스토리
 * 로드 및 tmux 의 터미널 능력 협상(xterm 이 되돌리는 DA 응답 `ESC[?1;2c`)과 겹쳐 **입력이
 * 뒤섞였다** — `env` 가 `v`·`nv` 로 잘리고 뒷부분이 중복돼 `command not found` 가 났다
 * (2026-08-08 실측, 폰에서 특히 재현이 잦았다). 여기로 넘기면 주입 자체가 없어 경합이 사라진다.
 *
 * - `env -u TMUX …` 는 **셸 바깥**에 둔다 — `zsh -ic 'env -u TMUX … <명령>'` 처럼 안에 넣으면
 *   pane 이 즉시 종료된다(실측). 이유는 규명하지 못했고, 바깥에 두면 정상이다.
 * - `-ic` 로 실행해야 rc 가 로드돼 PATH 가 잡힌다(GUI 앱이 물려주는 PATH 는 빈약하다).
 *
 * ⚠️ **명령과 `exec` 는 반드시 같은 셸 안에서 이어야 한다** (2026-08-10 실측).
 * 예전엔 `<sh> -ic '<명령>'; exec <sh> -il` 로 셸을 **두 번** 띄웠는데, 앞 셸이 인터랙티브라
 * job control 을 켜고 tty 소유권(foreground pgrp)을 명령의 프로세스 그룹에 넘긴 뒤 그대로
 * 죽는다 — 소유권이 죽은 그룹에 남아 뒤이은 `exec <sh> -il` 이 tty 를 못 잡고
 * `zsh: can't set tty pgrp: Input/output error` 와 함께 **pane 이 즉시 종료**됐다.
 * `git pull` 처럼 **끝나는 명령**(`ls` 로도 재현)과 **claude 를 Ctrl+C 로 끝낸 경우**가 여기 걸렸다.
 * 하나의 셸이 명령을 돌리고 그 자리에서 `exec` 하면 소유권이 넘어간 적이 없어 문제가 사라진다.
 *
 * - `trap 'true' INT` 는 **셸만** SIGINT 를 무시하게 한다(자식은 정상 수신 — `sleep` 이 `^C` 로
 *   즉시 취소되는 것 실측). 없으면 명령 실행 중 Ctrl+C 가 셸까지 끊어 `exec` 에 도달하지 못한다.
 *   `trap '' INT`(무시)는 자식이 그 설정을 상속하므로 쓰면 안 된다.
 * - 명령이 끝나거나 실패해도 `exec <shell> -il` 로 셸이 남는다 — 의도했던 동작이 이제 실제로 된다.
 */
function launchShellCommand(shell: string, rawCommand: string): string {
  const sh = shQuote(shell);
  const inner = `trap 'true' INT; ${rawCommand}; exec ${sh} -il`;
  return `env -u TMUX -u TMUX_PANE ${sh} -ic ${shQuote(inner)}`;
}

export function createSession(opts: TerminalCreateInput = {}): TerminalSessionInfo {
  const shell = process.env.SHELL ?? '/bin/zsh';
  // projectId 가 있으면 프로젝트 레지스트리에서 위치 해석 (cwd 보다 우선)
  const project = opts.projectId ? getProject(opts.projectId) : undefined;
  const requested = project?.localPath ?? opts.cwd;
  const cwd = requested && fs.existsSync(requested) ? requested : os.homedir();
  // 경로가 사라져 홈으로 폴백했으면 프로젝트 이름을 제목으로 쓰지 않는다
  const usedProject = project && cwd === project.localPath ? project : undefined;
  const agentId = opts.agentId ?? 'shell';
  const cols = opts.cols ?? 80;
  const rows = opts.rows ?? 24;
  const now = Date.now();
  const id = crypto.randomUUID().slice(0, 8);

  // 자동 실행할 원시 명령 — 프리셋이 있으면 그것, 없으면 에이전트 기본 명령
  const autoRun = opts.command?.trim() || agentCommand(agentId);

  // tmux 가 있으면 셸 대신 tmux 클라이언트를 spawn — 실제 셸은 tmux 서버 소유(영속)
  const bin = getTmuxBin();
  const tmuxName = bin ? tmuxSessionName(id) : undefined;
  const proc =
    bin && tmuxName
      ? pty.spawn(
          bin,
          tmuxNewSessionArgs(tmuxName, cwd, autoRun ? launchShellCommand(shell, autoRun) : undefined),
          ptyOptions(cwd, cols, rows)
        )
      : pty.spawn(shell, ['-il'], ptyOptions(cwd, cols, rows));

  const session = makeSession({
    id,
    proc,
    tmuxName,
    // 프리셋 세션은 프리셋 이름이 제목 (Superset 의 탭 이름과 동일)
    title: opts.title?.trim() || (usedProject?.name ?? (path.basename(cwd) || cwd)),
    cwd,
    cols,
    rows,
    agentId,
    projectId: usedProject?.id,
    projectName: usedProject?.name,
    createdAt: now,
    // claude 는 뜨자마자 프롬프트에서 대기하므로 상태는 waiting 이 맞지만,
    // 방금 만든 사용자에게 소리·알럿은 소음 — 첫 waiting 알림만 억제한다
    suppressNotifyUntil: agentId !== 'shell' ? now + CREATE_NOTIFY_GRACE_MS : 0,
  });
  sessions.set(session.id, session);
  ensureStatusTimer();

  if (tmuxName) {
    savePersisted({
      id,
      title: session.title,
      cwd,
      agentId,
      projectId: session.projectId,
      projectName: session.projectName,
      createdAt: now,
      cols,
      rows,
    });
  }

  life('create', { id, cwd, agentId, cols, rows, tmuxName, autoRun: autoRun || '(없음)' });
  // tmux 백엔드는 위에서 new-session 의 shell-command 로 이미 넘겼다 — 여기서 입력을
  // 주입하는 건 폴백(tmux 미설치) 세션뿐이다.
  if (!tmuxName && autoRun) {
    launchAgent(session, `env -u TMUX -u TMUX_PANE ${autoRun}`);
  }

  wireSession(session);
  emitChanged();
  return toInfo(session);
}

/**
 * 앱 시작 시 영속 세션 복원 — tmux 생존 세션(oneapp-*)과 sidecar 를 대조한다.
 * sidecar 만 남은 항목은 정리(크래시로 tmux 서버까지 죽은 경우)하고,
 * sidecar 없는 고아 tmux 세션도 셸로 복원한다(사용자가 잃는 것보단 낫다).
 */
export async function restoreSessions(): Promise<void> {
  const bin = await initTmux();
  if (!bin) return;
  const live = await listTmuxSessions();
  const liveIds = new Set(
    live.map(sessionIdFromTmuxName).filter((v): v is string => !!v)
  );
  const persisted = new Map(listPersisted().map((p) => [p.id, p]));
  for (const id of persisted.keys()) {
    if (!liveIds.has(id)) removePersisted(id);
  }
  const now = Date.now();
  let restored = false;
  for (const name of live) {
    const id = sessionIdFromTmuxName(name);
    if (!id || sessions.has(id)) continue;
    const meta = persisted.get(id);
    const cwd = meta?.cwd ?? os.homedir();
    // 마지막 크기로 attach — 80x24 로 붙였다 되돌리면 TUI(claude)가 앱 시작마다
    // 두 번 리플로우하며 화면이 출렁인다
    const cols = meta?.cols ?? 80;
    const rows = meta?.rows ?? 24;
    let proc: pty.IPty;
    try {
      proc = pty.spawn(bin, tmuxAttachArgs(name), ptyOptions(cwd, cols, rows));
    } catch (e) {
      console.error(`[terminal] 세션 복원 실패 (${name}):`, e);
      continue;
    }
    const session = makeSession({
      id,
      proc,
      tmuxName: name,
      title: meta?.title ?? (path.basename(cwd) || cwd),
      cwd,
      cols,
      rows,
      agentId: meta?.agentId ?? 'shell',
      projectId: meta?.projectId,
      projectName: meta?.projectName,
      createdAt: meta?.createdAt ?? now,
      // 재시작 직후 attach redraw 가 waiting 을 합성한다 — 알림은 억제, 뱃지는 그대로
      suppressNotifyUntil: now + CREATE_NOTIFY_GRACE_MS,
    });
    session.notifiedSinceInput = true;
    sessions.set(id, session);
    wireSession(session);
    restored = true;
  }
  if (restored) {
    ensureStatusTimer();
    emitChanged();
  }
}

/**
 * 에이전트 자동 실행 — **tmux 미설치 폴백 세션 전용**이다. tmux 백엔드는 명령을 입력으로
 * 주입하지 않고 `new-session` 의 shell-command 로 넘긴다(`launchShellCommand()` 주석 참고).
 *
 * ⚠️ spawn 직후 바로 write 하면 zsh 가 초기화(ZLE) 중에 입력 버퍼를 비우면서 명령이
 * 유실된다(2026-08 실측 — 커널 PTY 버퍼만 믿으면 안 됨). 첫 출력 후 잠깐 잠잠해지면
 * (프롬프트 완성) 보내고, 출력이 계속 이어지는 셸 테마를 대비해 상한 시간이 지나면 그냥
 * 보낸다. 사용자 입력이 아니므로 noteInput 은 타지 않는다.
 */
function launchAgent(s: Session, command: string) {
  let sent = false;
  let quietTimer: NodeJS.Timeout | null = null;
  const send = () => {
    if (sent) return;
    sent = true;
    if (quietTimer) clearTimeout(quietTimer);
    clearTimeout(maxTimer);
    sub.dispose();
    life('launch', { id: s.id, alive: sessions.has(s.id), command });
    try {
      s.pty.write(`${command}\r`);
    } catch (err) {
      life('launch:failed', { id: s.id, err: String(err) });
    }
  };
  const sub = s.pty.onData(() => {
    if (sent) return;
    if (quietTimer) clearTimeout(quietTimer);
    quietTimer = setTimeout(send, AGENT_LAUNCH_QUIET_MS);
  });
  const maxTimer = setTimeout(send, AGENT_LAUNCH_MAX_WAIT_MS);
}

/**
 * 세션 attach — last-attach-wins: 새로 붙은 클라이언트 크기로 PTY 를 맞춘다.
 * 크기가 같으면 SIGWINCH 토글(폴백)/refresh-client(tmux)로 현재 화면을 다시 그린다
 * (replay 는 스크롤백 복원용이고, 현재 화면의 진실은 이 redraw 가 담당한다).
 * 반환 seq 이하의 라이브 이벤트는 replay 에 이미 포함 — 클라이언트가 버려서 중복을 막는다.
 *
 * ⚠️ tmux 세션이 대체 화면(claude 등 TUI)이면 replay 를 **생략**한다 — 옛 프레임을
 * 재생하면 그 사이 크기가 달랐던 프레임의 글자가 우측 끝에 눌어붙는데, TUI 는 자기
 * 렌더 모델과의 diff 만 다시 그려서 그 잔상을 영영 지우지 않는다(2026-08-05 실측:
 * ◉ × 조각·잘린 에이전트 칩). 빈 화면에 tmux 전체 리드로(라인 클리어 포함) 한 프레임이
 * superset 과 같은 클린 attach 다. 일반 셸은 스크롤백 가치가 있어 replay 를 유지한다.
 */
export async function attachSession(
  id: string,
  cols: number,
  rows: number
): Promise<TerminalAttachResult> {
  const s = sessions.get(id);
  if (!s) return { ok: false, error: '세션이 없습니다.' };
  flush(s); // replay 에 대기 출력까지 포함
  // 턴 진행 중(busy)이 아니면 이어질 SIGWINCH redraw 가 합성 waiting 을 만든다 —
  // 알림 기회를 미리 소진해 가짜 알림음을 막는다 (진짜 턴은 입력이 플래그를 리셋)
  if (s.status !== 'busy') s.notifiedSinceInput = true;
  // ⚠️ alt 질의(await) 중의 flush 는 ring·seq 에 반영된 뒤 아래에서 스냅샷된다 — 유실 없음
  const skipReplay = s.tmuxName ? await isTmuxAltScreen(s.tmuxName) : false;
  const replay = skipReplay ? '' : s.ring.join('');
  if (cols > 0 && rows > 0) {
    if (cols !== s.cols || rows !== s.rows) {
      resizeSession(id, cols, rows); // 크기 변경 자체가 SIGWINCH → TUI 가 다시 그림
    } else if (s.tmuxName) {
      // tmux 는 화면 모델을 갖고 있다 — refresh-client 가 내부 앱(claude)을 건드리지
      // 않고 전체 화면을 다시 보내준다 (rows±1 토글의 이중 리플로우·출렁임 없음)
      void refreshTmuxClients(s.tmuxName);
    } else {
      // 같은 크기면 토글로 SIGWINCH 만 유발 — 일시적이므로 resized 이벤트는 내지 않는다
      try {
        s.pty.resize(cols, rows + 1);
        setTimeout(() => {
          try {
            if (sessions.has(id)) s.pty.resize(cols, rows);
          } catch {
            // 종료 직후 레이스 — 무해
          }
        }, REDRAW_TOGGLE_MS);
      } catch {
        // resize 실패는 attach 를 막지 않는다
      }
    }
  }
  return { ok: true, replay, seq: s.seq, cols: s.cols, rows: s.rows };
}

/**
 * 세션 제목 변경 — 같은 프로젝트에서 여러 세션을 열면 기본 제목(프로젝트명)이 전부
 * 같아 목록에서 구분할 수 없다. 사용자가 직접 붙인 이름은 tmux 백엔드일 때
 * sidecar 에도 반영해 앱 재시작 복원 후에도 남는다.
 */
export function renameSession(id: string, title: string): void {
  const s = sessions.get(id);
  if (!s) return;
  // 개행·제어문자는 목록 한 줄 렌더를 깨므로 제거하고, 길이는 목록 폭에 맞춰 자른다
  // eslint-disable-next-line no-control-regex -- 붙여넣기로 들어오는 제어문자 제거가 목적
  const next = title.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, TITLE_MAX_LEN);
  if (!next || next === s.title) return;
  s.title = next;
  if (s.tmuxName) updatePersistedTitle(id, next);
  emitChanged();
}

export function writeSession(id: string, data: string): void {
  const s = sessions.get(id);
  if (!s) return;
  noteInput(s);
  // 휠로 tmux copy-mode(스크롤 위)에 올라가 있으면 키 입력이 셸이 아니라 copy-mode 명령으로
  // 먹힌다 — 먼저 빠져나온다. 해제는 tmux CLI 호출(비동기)이라 그동안의 입력은 순서대로
  // 모아 뒀다가 한 번에 흘려보낸다(첫 글자를 잃지 않는다).
  if (s.copyMode) {
    s.pendingInput += data;
    exitCopyMode(s);
    return;
  }
  s.pty.write(data);
}

/** copy-mode 해제 + 밀린 입력 flush — writeSession·scrollSessionToBottom 공용 */
function exitCopyMode(s: Session): Promise<void> {
  if (!s.paneId) {
    // 스크롤을 거치지 않으면 copyMode 가 켜질 수 없다 — 방어적으로 원상복구
    s.copyMode = false;
    flushPendingInput(s);
    return Promise.resolve();
  }
  if (s.exitingCopyMode) return Promise.resolve();
  s.exitingCopyMode = true;
  return tmuxExitCopyMode(s.paneId).then(() => {
    s.exitingCopyMode = false;
    s.copyMode = false;
    flushPendingInput(s);
  });
}

function flushPendingInput(s: Session) {
  const buf = s.pendingInput;
  s.pendingInput = '';
  if (buf && sessions.has(s.id)) s.pty.write(buf);
}

/**
 * 휠 스크롤 — tmux 백엔드는 **tmux 가 스크롤백의 주인**이라 xterm 이 스스로 스크롤할 수
 * 없다(클라이언트가 대체 화면으로 붙는다). 그래서 렌더러가 휠을 가로채 이리로 보내고
 * copy-mode 로 올린다. 대체 화면(claude 등 TUI)이면 tmux 가 방향키로 넘겨 기존 동작 유지.
 *
 * @param lines 양수 = 위로, 음수 = 아래로
 * @returns 위로 올라가 있는지(= 상단 바 [맨 아래로] 노출 판정). tmux 폴백 세션은 항상 false.
 */
export async function scrollSession(
  id: string,
  lines: number
): Promise<{ scrolledUp: boolean }> {
  const s = sessions.get(id);
  if (!s || !s.tmuxName || !lines) return { scrolledUp: false };
  if (!s.paneId) s.paneId = (await tmuxPaneId(s.tmuxName)) ?? undefined;
  if (!s.paneId) return { scrolledUp: false };
  const res = await tmuxScrollPane(s.paneId, lines);
  s.copyMode = res.scrolledUp;
  return res;
}

/** 상단 바 [맨 아래로] — copy-mode 를 끝내면 tmux 가 현재 화면으로 돌아온다 */
export async function scrollSessionToBottom(id: string): Promise<void> {
  const s = sessions.get(id);
  if (!s || !s.copyMode) return;
  await exitCopyMode(s);
}

/** PTY 크기 변경 (마지막 요청 우선) — 모든 클라이언트에 resized 로 전파된다 */
export function resizeSession(id: string, cols: number, rows: number): void {
  const s = sessions.get(id);
  if (!s || cols <= 0 || rows <= 0) return;
  if (cols === s.cols && rows === s.rows) return;
  try {
    s.pty.resize(cols, rows);
  } catch {
    return; // 종료 직후 레이스 — 무해
  }
  s.cols = cols;
  s.rows = rows;
  // 영속 세션은 크기도 기억 — 다음 복원 attach 를 마지막 크기로 해 리플로우를 없앤다
  if (s.tmuxName) updatePersistedSize(s.id, cols, rows);
  // attach 와 같은 이유 — redraw 가 만드는 합성 waiting 의 알림을 막는다
  if (s.status !== 'busy') s.notifiedSinceInput = true;
  resizeListeners.forEach((cb) => cb(id, cols, rows));
}

export function killSession(id: string): void {
  const s = sessions.get(id);
  if (!s) return;
  if (s.tmuxName) {
    // tmux 세션 자체를 죽인다 — attach 클라이언트도 끊기며 onExit 흐름으로 정리된다
    s.killing = true;
    const name = s.tmuxName;
    void killTmuxSession(name).then((ok) => {
      if (ok) return;
      // tmux 서버가 이미 죽은 등 명령 실패 — 클라이언트라도 정리한다
      try {
        s.pty.kill();
      } catch {
        // 이미 죽은 프로세스 — 무해
      }
      finalizeExit(s, 0);
    });
    return;
  }
  s.pty.kill(); // 정리는 onExit 핸들러가 담당 (목록 push 포함)
}

/**
 * 앱 종료 시 정리 (before-quit) — tmux 백엔드 세션은 attach 클라이언트만 끊는다.
 * 셸·에이전트는 tmux 서버에 살아남고 다음 시작의 restoreSessions() 가 복원한다.
 * sidecar 도 그대로 둔다(finalizeExit 를 타지 않게 disposing 플래그로 막는다).
 */
export function disposeAll(): void {
  disposing = true;
  for (const s of sessions.values()) {
    if (s.flushTimer) clearTimeout(s.flushTimer);
    try {
      s.pty.kill();
    } catch {
      // 이미 죽은 프로세스 — 무해
    }
  }
  sessions.clear();
  stopStatusTimerIfEmpty();
}
