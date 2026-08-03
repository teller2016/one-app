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
} from '../../../shared/types';

const RING_MAX_BYTES = 512 * 1024; // attach replay 용 출력 보관 상한 (chunk 단위 링버퍼)
const BATCH_MS = 16; // 출력 배칭 — 대량 출력 시 IPC/WS 이벤트 폭주 방지
const REDRAW_TOGGLE_MS = 40; // SIGWINCH 토글 간격 — TUI(claude CLI 등) 강제 리렌더용

type Session = {
  id: string;
  pty: pty.IPty;
  title: string;
  cwd: string;
  cols: number;
  rows: number;
  ring: string[]; // 출력 chunk 링버퍼 (시퀀스 중간 절단을 줄이려 chunk 단위로 버림)
  ringBytes: number;
  pending: string; // 배칭 대기 출력
  flushTimer: NodeJS.Timeout | null;
  seq: number; // flush 마다 증가 — attach replay 와 라이브 이벤트의 중복 제거 기준
};

const sessions = new Map<string, Session>();

// 구독 — ipc.ts(데스크톱 broadcast)와 server.ts(모바일 WS)가 각각 구독한다
type DataListener = (id: string, data: string, seq: number) => void;
type ExitListener = (id: string, exitCode: number) => void;
type ResizeListener = (id: string, cols: number, rows: number) => void;
const dataListeners = new Set<DataListener>();
const exitListeners = new Set<ExitListener>();
const changedListeners = new Set<() => void>();
const resizeListeners = new Set<ResizeListener>();

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

const emitChanged = () => changedListeners.forEach((cb) => cb());

const toInfo = (s: Session): TerminalSessionInfo => ({
  id: s.id,
  title: s.title,
  cwd: s.cwd,
  cols: s.cols,
  rows: s.rows,
});

/** 배칭 대기 출력을 즉시 내보내고 링버퍼에 적재 */
function flush(s: Session) {
  if (s.flushTimer) {
    clearTimeout(s.flushTimer);
    s.flushTimer = null;
  }
  if (!s.pending) return;
  const chunk = s.pending;
  s.pending = '';
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
  const cwd = opts.cwd && fs.existsSync(opts.cwd) ? opts.cwd : os.homedir();
  const cols = opts.cols ?? 80;
  const rows = opts.rows ?? 24;

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
    title: path.basename(cwd) || cwd,
    cwd,
    cols,
    rows,
    ring: [],
    ringBytes: 0,
    pending: '',
    flushTimer: null,
    seq: 0,
  };
  sessions.set(session.id, session);

  proc.onData((data) => {
    session.pending += data;
    if (!session.flushTimer) {
      session.flushTimer = setTimeout(() => flush(session), BATCH_MS);
    }
  });
  proc.onExit(({ exitCode }) => {
    flush(session);
    sessions.delete(session.id);
    exitListeners.forEach((cb) => cb(session.id, exitCode));
    emitChanged();
  });

  emitChanged();
  return toInfo(session);
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
  sessions.get(id)?.pty.write(data);
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
}
