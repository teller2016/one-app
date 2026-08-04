// PTY 세션 관리 — 메인 프로세스가 세션의 단일 소유자(단일 진실).
// 데스크톱(IPC 경유)과 모바일(WS 경유)이 같은 세션에 attach 해 입출력을 공유하고,
// 세션은 창·클라이언트와 무관하게 One App 이 실행 중인 동안 유지된다.
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

type Session = {
  id: string;
  pty: pty.IPty;
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
};

const sessions = new Map<string, Session>();

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

  const proc = pty.spawn(shell, ['-il'], {
    name: 'xterm-256color',
    cols,
    rows,
    cwd,
    env: {
      ...process.env,
      COLORTERM: 'truecolor',
      LANG: process.env.LANG ?? 'ko_KR.UTF-8',
    } as { [key: string]: string },
  });

  const session: Session = {
    id: crypto.randomUUID().slice(0, 8),
    pty: proc,
    title: usedProject?.name ?? (path.basename(cwd) || cwd),
    cwd,
    cols,
    rows,
    agentId,
    projectId: usedProject?.id,
    projectName: usedProject?.name,
    createdAt: now,
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
    // claude 는 뜨자마자 프롬프트에서 대기하므로 상태는 waiting 이 맞지만,
    // 방금 만든 사용자에게 소리·알럿은 소음 — 첫 waiting 알림만 억제한다
    suppressNotifyUntil: agentId !== 'shell' ? now + CREATE_NOTIFY_GRACE_MS : 0,
  };
  sessions.set(session.id, session);
  ensureStatusTimer();

  const command = agentCommand(agentId);
  if (command) launchAgent(session, command);

  proc.onData((data) => {
    session.pending += data;
    if (!session.flushTimer) {
      session.flushTimer = setTimeout(() => flush(session), BATCH_MS);
    }
  });
  proc.onExit(({ exitCode }) => {
    flush(session);
    sessions.delete(session.id);
    stopStatusTimerIfEmpty();
    exitListeners.forEach((cb) => cb(session.id, exitCode));
    emitChanged();
  });

  emitChanged();
  return toInfo(session);
}

/**
 * 에이전트 자동 실행 — ⚠️ spawn 직후 바로 write 하면 zsh 가 초기화(ZLE) 중에
 * 입력 버퍼를 비우면서 명령이 유실된다(2026-08 실측 — 커널 PTY 버퍼만 믿으면 안 됨).
 * 첫 출력 후 잠깐 잠잠해지면(프롬프트 완성) 보내고, 출력이 계속 이어지는 셸 테마를
 * 대비해 상한 시간이 지나면 그냥 보낸다. 사용자 입력이 아니므로 noteInput 은 타지 않는다.
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
    try {
      s.pty.write(`${command}\r`);
    } catch {
      // 그 사이 세션 종료 — 무해
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
 * 크기가 같으면 SIGWINCH 토글로 TUI 강제 리렌더 (replay 는 스크롤백 복원용이고,
 * 현재 화면의 진실은 이 redraw 가 담당한다).
 * 반환 seq 이하의 라이브 이벤트는 replay 에 이미 포함 — 클라이언트가 버려서 중복을 막는다.
 */
export function attachSession(id: string, cols: number, rows: number): TerminalAttachResult {
  const s = sessions.get(id);
  if (!s) return { ok: false, error: '세션이 없습니다.' };
  flush(s); // replay 에 대기 출력까지 포함
  // 턴 진행 중(busy)이 아니면 이어질 SIGWINCH redraw 가 합성 waiting 을 만든다 —
  // 알림 기회를 미리 소진해 가짜 알림음을 막는다 (진짜 턴은 입력이 플래그를 리셋)
  if (s.status !== 'busy') s.notifiedSinceInput = true;
  const replay = s.ring.join('');
  if (cols > 0 && rows > 0) {
    if (cols !== s.cols || rows !== s.rows) {
      resizeSession(id, cols, rows); // 크기 변경 자체가 SIGWINCH → TUI 가 다시 그림
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

export function writeSession(id: string, data: string): void {
  const s = sessions.get(id);
  if (!s) return;
  noteInput(s);
  s.pty.write(data);
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
  // attach 와 같은 이유 — redraw 가 만드는 합성 waiting 의 알림을 막는다
  if (s.status !== 'busy') s.notifiedSinceInput = true;
  resizeListeners.forEach((cb) => cb(id, cols, rows));
}

export function killSession(id: string): void {
  sessions.get(id)?.pty.kill(); // 정리는 onExit 핸들러가 담당 (목록 push 포함)
}

/** 앱 종료 시 전체 정리 (before-quit) */
export function disposeAll(): void {
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
