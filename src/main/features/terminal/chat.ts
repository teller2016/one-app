// MO 채팅 보기 — 터미널 세션 안에서 도는 claude 의 **대화 기록(jsonl)** 을 찾아 구독한다.
//
// 화면을 긁어 해석하지 않는다 — claude 는 대화를 `$CLAUDE_CONFIG_DIR/projects/<cwd>/<sessionId>.jsonl`
// 에 줄 단위로 남기고, 실행 중인 프로세스마다 `$CLAUDE_CONFIG_DIR/sessions/<pid>.json`
// (`{pid, sessionId, cwd, …}`)을 둔다(2026-10-01 실측, Claude Code 2.1.x). 그래서
//   세션 pane 셸 pid → 자손 프로세스 중 sessions/<pid>.json 이 있는 것 → sessionId → jsonl
// 순으로 **추측 없이** 이어진다. 계정이 여럿(`~/.claude`·`~/.claude-team` — CLAUDE_CONFIG_DIR 셸 함수)이라
// 홈의 `.claude*` 폴더를 전부 후보로 본다.
//
// ⚠️ jsonl 은 **첫 메시지 때** 생긴다 — sessions/<pid>.json 은 claude 가 뜨자마자 있지만 대화 파일은 아직 없다
//    (2026-10-01 /test 실측). 그 상태를 '못 찾음'으로 보내면 새 세션은 첫 메시지를 터미널로 쳐야 했다 →
//    **빈 대화(fresh)** 로 보내 입력창을 연다. 폴더 신뢰 확인 같은 TUI 화면도 같은 상태라 구분할 수 없어,
//    폰은 '확인 화면이 떠 있으면 터미널에서 먼저' 안내를 함께 띄운다(ChatView).
//
// ⚠️ AskUserQuestion 질문은 **답하기 전까지 jsonl 에 없다**(같은 날 실측) — 대기 중임은 sessions/<pid>.json 의
//    `status: 'waiting'` 으로만 안다. 그때만 터미널 화면 끝을 읽어 번호 선택 화면을 보낸다(screenPrompt.ts, chat-prompt).
//
// 구독은 폰이 채팅 보기를 연 동안만 — 1초 주기로 크기만 보고, 늘어난 바이트만 읽어 파싱한다.
// `/clear`·`/resume` 으로 sessionId 가 바뀌면 sessions/<pid>.json 이 따라 바뀌므로 주기마다 다시 읽는다.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChatCommand, ChatPrompt, ChatServerMsg } from '../../../shared/terminal-protocol';
import { listChatCommands } from './chatCommands';
import { listSessions, sessionRootPid, sessionScreen, writeSession } from './pty';
import { parseScreenPrompt, parseScreenStatus } from './screenPrompt';
import { parseTranscript } from './transcript';

const TICK_MS = 1000;
/** 처음 열 때 읽는 꼬리 — 오래 쓴 대화는 수십 MB 라 끝부분만 */
const INITIAL_TAIL_BYTES = 1536 * 1024;
/** 처음 보낼 항목 수 상한 — 폰 DOM 을 가볍게 */
const INITIAL_ITEMS = 300;
/** 한 번에 읽을 증분 상한 — 이보다 많이 늘었으면 통째로 다시 연다(reset) */
const MAX_DELTA_BYTES = 4 * 1024 * 1024;
const MISSING_REASON = 'claude 대화 기록을 찾지 못했습니다 — claude 가 실행 중일 때만 채팅으로 볼 수 있습니다.';

type ChatMsg = ChatServerMsg;
type Listener = (msg: ChatMsg) => void;

type Found = {
  pid: number;
  configDir: string;
  sessionId: string;
  cwd: string;
  file: string;
  /** claude 가 남긴 상태 — 'busy' · 'idle' · 'waiting'(터미널에서 답 대기) */
  status?: string;
};

// ── 탐색 ──

let configDirsCache: { at: number; dirs: string[] } | null = null;

/** claude 설정 폴더 후보 — 홈의 `.claude`·`.claude-*` 중 sessions/ 가 있는 것 (1분 캐시) */
function configDirs(): string[] {
  if (configDirsCache && Date.now() - configDirsCache.at < 60_000) return configDirsCache.dirs;
  const home = os.homedir();
  const dirs = new Set<string>();
  if (process.env.CLAUDE_CONFIG_DIR) dirs.add(process.env.CLAUDE_CONFIG_DIR);
  try {
    for (const name of fs.readdirSync(home)) {
      if (name === '.claude' || name.startsWith('.claude-')) dirs.add(path.join(home, name));
    }
  } catch {
    // 홈을 못 읽으면 후보 없음
  }
  const list = [...dirs].filter((d) => fs.existsSync(path.join(d, 'sessions')));
  configDirsCache = { at: Date.now(), dirs: list };
  return list;
}

/** 뿌리 pid 의 자손(자신 포함, 가까운 순) — `ps` 한 번 */
function descendants(root: number): Promise<number[]> {
  return new Promise((resolve) => {
    execFile('/bin/ps', ['-A', '-o', 'pid=,ppid='], { timeout: 3000 }, (err, stdout) => {
      if (err) return resolve([root]);
      const children = new Map<number, number[]>();
      for (const line of String(stdout).split('\n')) {
        const [pid, ppid] = line.trim().split(/\s+/).map(Number);
        if (!pid || Number.isNaN(ppid)) continue;
        const arr = children.get(ppid) ?? [];
        arr.push(pid);
        children.set(ppid, arr);
      }
      const out: number[] = [];
      const queue = [root];
      while (queue.length && out.length < 200) {
        const p = queue.shift() as number;
        out.push(p);
        queue.push(...(children.get(p) ?? []));
      }
      resolve(out);
    });
  });
}

type SessionMeta = { sessionId?: string; cwd?: string; status?: string };

function readMeta(configDir: string, pid: number): SessionMeta | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(configDir, 'sessions', `${pid}.json`), 'utf8')) as SessionMeta;
  } catch {
    return null;
  }
}

/** `/Users/me/a.b` → `-Users-me-a-b` — claude 의 projects 폴더 이름 규칙(영숫자 외 전부 '-') */
const projectSlug = (cwd: string) => cwd.replace(/[^a-zA-Z0-9]/g, '-');

/** 대화 파일 경로 — 아직 없으면(첫 메시지 전) 생길 자리를 돌려준다. 생기면 증분 읽기가 0 바이트부터 따라간다 */
function transcriptFile(configDir: string, sessionId: string, cwd: string): string {
  const direct = path.join(configDir, 'projects', projectSlug(cwd), `${sessionId}.jsonl`);
  if (fs.existsSync(direct)) return direct;
  // 이름 규칙이 바뀌었을 때의 안전망 — projects 아래를 한 단계만 훑는다
  try {
    for (const dir of fs.readdirSync(path.join(configDir, 'projects'))) {
      const f = path.join(configDir, 'projects', dir, `${sessionId}.jsonl`);
      if (fs.existsSync(f)) return f;
    }
  } catch {
    // projects 가 없다
  }
  return direct;
}

/** 파일 크기 — 아직 없으면 0 (첫 메시지 전) */
function fileSize(file: string): number {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
}

function resolveFromPid(pid: number, configDir: string): Found | null {
  const meta = readMeta(configDir, pid);
  if (!meta?.sessionId || !meta.cwd) return null;
  const file = transcriptFile(configDir, meta.sessionId, meta.cwd);
  return { pid, configDir, sessionId: meta.sessionId, cwd: meta.cwd, file, status: meta.status };
}

async function findClaude(termId: string): Promise<Found | null> {
  const root = await sessionRootPid(termId);
  if (!root) return null;
  const dirs = configDirs();
  for (const pid of await descendants(root)) {
    for (const dir of dirs) {
      const found = resolveFromPid(pid, dir);
      if (found) return found;
    }
  }
  return null;
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// ── 읽기 ──

function readRange(file: string, start: number, end: number): string {
  if (end <= start) return '';
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(end - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

/** 마지막 줄바꿈까지만 완성된 줄 — 나머지(쓰는 중인 줄)는 다음 주기로 */
function completeLines(text: string): { lines: string[]; used: number } {
  const lastNl = text.lastIndexOf('\n');
  if (lastNl < 0) return { lines: [], used: 0 };
  const done = text.slice(0, lastNl + 1);
  return { lines: done.split('\n'), used: Buffer.byteLength(done, 'utf8') };
}

// ── 구독 ──

type Watch = {
  termId: string;
  listeners: Set<Listener>;
  timer: NodeJS.Timeout | null;
  found: Found | null;
  offset: number;
  busy: boolean;
  /** 못 찾은 상태를 이미 알렸다 — 주기마다 같은 안내를 보내지 않는다 */
  reportedMissing: boolean;
  lastSearchAt: number;
  /** 마지막으로 보낸 선택 화면(JSON) — 바뀔 때만 보낸다. 'null' = 대기 없음, '' = 아직 안 보냄(첫 주기엔 null 도 보낸다) */
  promptKey: string;
  /** 마지막으로 보낸 작업 중 상태 줄 — 바뀔 때만. null = 일하지 않거나 못 읽음 */
  statusText: string | null;
};

const watches = new Map<string, Watch>();

function emit(w: Watch, msg: ChatMsg, only?: Listener) {
  if (only) only(msg);
  else w.listeners.forEach((fn) => fn(msg));
}

/** 꼬리부터 읽어 통째로 보낸다(reset) */
function sendSnapshot(w: Watch, found: Found, only?: Listener) {
  const size = fileSize(found.file);
  const start = Math.max(0, size - INITIAL_TAIL_BYTES);
  let text = readRange(found.file, start, size);
  if (start > 0) text = text.slice(text.indexOf('\n') + 1); // 잘린 첫 줄은 버린다
  const { lines, used } = completeLines(text);
  const parsed = parseTranscript(lines, found.cwd);
  if (!only) w.offset = size - (Buffer.byteLength(text, 'utf8') - used);
  emit(
    w,
    {
      type: 'chat',
      id: w.termId,
      reset: true,
      items: parsed.items.slice(-INITIAL_ITEMS),
      results: parsed.results,
      ...(size === 0 ? { fresh: true } : {}),
    },
    only,
  );
}

/** 대화 파일을 따라 읽는다 — 새 파일이면 스냅샷, 같은 파일이면 늘어난 만큼 */
function syncTranscript(w: Watch, found: Found) {
  if (!w.found || w.found.file !== found.file) {
    w.found = found;
    sendSnapshot(w, found);
    return;
  }
  w.found = found; // 상태(status)는 주기마다 바뀐다
  const size = fileSize(found.file);
  if (size < w.offset || size - w.offset > MAX_DELTA_BYTES) {
    sendSnapshot(w, found); // 잘렸거나 너무 많이 늘었다 — 다시 연다
    return;
  }
  if (size === w.offset) return;
  const { lines, used } = completeLines(readRange(found.file, w.offset, size));
  if (!used) return;
  w.offset += used;
  const parsed = parseTranscript(lines, found.cwd);
  if (!parsed.items.length && !parsed.results.length) return;
  emit(w, { type: 'chat', id: w.termId, reset: false, items: parsed.items, results: parsed.results });
}

/** 대기 중이면 화면에서 선택 화면을 읽는다 — 읽지 못하면 선택지 없는 prompt(= 터미널에서 답 필요) */
async function syncPrompt(w: Watch, found: Found | null) {
  let prompt: ChatPrompt | null = null;
  let status: string | null = null;
  // 화면은 대기·작업 중일 때만 읽는다(한가하면 읽을 것이 없다) — 한 번 읽어 선택 화면·상태 줄을 함께 뽑는다
  if (found?.status === 'waiting' || found?.status === 'busy') {
    const screen = await sessionScreen(w.termId);
    if (found.status === 'waiting') prompt = (screen && parseScreenPrompt(screen)) || { question: '', options: [] };
    else status = screen ? parseScreenStatus(screen) : null;
  }
  if (!watches.has(w.termId)) return;
  const key = JSON.stringify(prompt);
  if (key !== w.promptKey) {
    w.promptKey = key;
    emit(w, { type: 'chat-prompt', id: w.termId, prompt });
  }
  if (status !== w.statusText) {
    w.statusText = status;
    emit(w, { type: 'chat-status', id: w.termId, text: status });
  }
}

async function tick(w: Watch) {
  if (w.busy) return;
  w.busy = true;
  try {
    let found = w.found;
    // 같은 프로세스라도 /clear·/resume 이면 sessionId(=파일)가 바뀐다 — 메타를 다시 읽는다
    if (found) {
      const next = alive(found.pid) ? resolveFromPid(found.pid, found.configDir) : null;
      found = next;
    }
    // 못 찾았으면 3초에 한 번만 다시 찾는다(ps 비용)
    if (!found && Date.now() - w.lastSearchAt >= 3000) {
      w.lastSearchAt = Date.now();
      found = await findClaude(w.termId);
    }
    if (!watches.has(w.termId)) return; // 기다리는 사이 구독이 끝났다
    if (!found) {
      if (w.found || !w.reportedMissing) {
        w.found = null;
        w.reportedMissing = true;
        emit(w, { type: 'chat-unavailable', id: w.termId, reason: MISSING_REASON });
      }
    } else {
      w.reportedMissing = false;
      syncTranscript(w, found);
    }
    await syncPrompt(w, found);
  } catch (err) {
    console.error('[term:chat] 읽기 실패', err);
  } finally {
    w.busy = false;
  }
}

/**
 * 세션의 대화를 구독한다 — 곧바로 스냅샷(reset)이 오고 이후 증분이 온다.
 * @returns 구독 해제
 */
export function subscribeChat(termId: string, listener: Listener): () => void {
  const existing = watches.get(termId);
  if (existing) {
    existing.listeners.add(listener);
    // 이미 도는 구독에 합류 — 이 구독자에게만 현재 상태를 준다(찾는 중이면 첫 결과가 모두에게 간다)
    try {
      if (existing.found) sendSnapshot(existing, existing.found, listener);
      else if (existing.reportedMissing) listener({ type: 'chat-unavailable', id: termId, reason: MISSING_REASON });
      // ⚠️ 대기 없음(null)도 보낸다 — 폰은 다시 구독할 때 예전 카드를 들고 있을 수 있다(터미널에서 답하고 돌아온 경우)
      if (existing.promptKey)
        listener({ type: 'chat-prompt', id: termId, prompt: JSON.parse(existing.promptKey) as ChatPrompt | null });
      if (existing.statusText) listener({ type: 'chat-status', id: termId, text: existing.statusText });
    } catch (err) {
      console.error('[term:chat] 스냅샷 실패', err);
    }
  } else {
    const w: Watch = {
      termId,
      listeners: new Set([listener]),
      timer: null,
      found: null,
      offset: 0,
      busy: false,
      reportedMissing: false,
      lastSearchAt: 0,
      promptKey: '',
      statusText: null,
    };
    w.timer = setInterval(() => void tick(w), TICK_MS);
    watches.set(termId, w);
    void tick(w); // 첫 탐색 — 찾으면 스냅샷, 못 찾으면 안내
  }
  return () => unsubscribe(termId, listener);
}

function unsubscribe(termId: string, listener: Listener) {
  const w = watches.get(termId);
  if (!w) return;
  w.listeners.delete(listener);
  if (w.listeners.size) return;
  if (w.timer) clearInterval(w.timer);
  watches.delete(termId);
}

/** 채팅 입력의 Enter 지연 — 붙여넣기 직후의 Enter 를 claude 가 붙여넣기 일부로 삼키지 않게 */
const CHAT_SUBMIT_DELAY_MS = 150;

/**
 * 채팅 입력창 전송 — 글을 넣고 잠시 뒤 Enter. 폰(server.ts WS)·데스크톱(ipc.ts) 공용.
 * 여러 줄은 **bracketed paste** 로 감싼다 — 그냥 쓰면 줄바꿈마다 제출된다. claude 는 붙여넣기를
 * `[Pasted text #1 +N lines]` 로 접어 보여주지만 제출되는 내용은 전문이다.
 */
export function sendChatText(id: string, text: string) {
  if (typeof text !== 'string' || !text.trim()) return;
  if (!listSessions().some((s) => s.id === id)) return;
  const body = text.includes('\n') ? `\x1b[200~${text}\x1b[201~` : text;
  writeSession(id, body);
  setTimeout(() => writeSession(id, '\r'), CHAT_SUBMIT_DELAY_MS);
}

/**
 * `/` 자동완성 목록 — 이 세션의 위치·claude 계정 기준. 대화를 구독 중이면 찾아 둔 claude 의 cwd·계정을,
 * 아니면 세션 위치와 기본 계정(~/.claude)을 쓴다.
 */
export function chatCommandsFor(termId: string): ChatCommand[] {
  const found = watches.get(termId)?.found;
  const cwd = found?.cwd ?? listSessions().find((s) => s.id === termId)?.cwd;
  if (!cwd) return [];
  return listChatCommands(cwd, found?.configDir ?? path.join(os.homedir(), '.claude'));
}
