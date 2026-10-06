// MO 채팅 보기 — 터미널 세션 안에서 도는 claude 의 **대화 기록(jsonl)** 을 찾아 구독한다.
//
// 화면을 긁어 해석하지 않는다 — pane 셸 pid → claude 프로세스 → 대화 기록 순으로 **추측 없이** 찾는다(claudeFiles.ts).
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
import os from 'node:os';
import path from 'node:path';
import type { ChatCommand, ChatPrompt, ChatQueued, ChatServerMsg } from '../../../shared/terminal-protocol';
import { listChatCommands, listChatFiles } from './chatCommands';
import {
  alive,
  completeLines,
  fileSize,
  findClaude,
  readRange,
  resolveFromPid,
  type ClaudeProcess,
} from './claudeFiles';
import { listSessions, sessionScreen, writeSession } from './pty';
import { parseScreenPrompt, parseScreenStatus } from './screenPrompt';
import { applyQueueOps, parseTranscript, type QueueOp } from './transcript';

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

type Found = ClaudeProcess;

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
  /**
   * 대기열 — 일하는 중에 보내 아직 안 읽힌 메시지(`queue-operation`). 파일 조각에 걸치므로 여기서 들고 있는다.
   * hidden = 사람 메시지가 아닌 것(`<task-notification>` 등 — 순서 맞춤용으로만 둔다)
   */
  queue: QueueEntry[];
  /** 한가한데 대기열이 남아 있기 시작한 시각(0 = 아님) — 비운 기록을 놓친 경우의 안전장치(QUEUE_STALE_MS) */
  queueIdleSince: number;
};

type QueueEntry = { key: string; text: string; ts?: string; hidden: boolean };

/**
 * claude 는 한가해지면 대기열을 곧바로 꺼내 간다 — 한가한데 이만큼 남아 있으면 꺼낸 기록을 놓친 것(꼬리만 읽은 스냅샷·
 * 모르는 연산·Esc 로 입력란에 되돌린 경우)이라 비운다. 회색 말풍선이 영영 남는 것보다 낫다
 */
const QUEUE_STALE_MS = 6000;

/**
 * 사람 메시지가 아닌 대기열 항목 — claude 가 사람 입력 자리에 넣는 시스템 태그들.
 * ⚠️ `<` 로 시작하는 것 전부로 거르지 말 것 — 사람이 `<div> 고쳐줘` 처럼 보낸 글이 '대기 중'에서 사라진다
 * (2026-10-02 실측: 대기열의 태그는 `<task-notification>` 뿐이었다 — 나머지는 사람 입력 쪽 표식이라 함께 둔다)
 */
const SYSTEM_QUEUED_RE = /^<(task-notification|local-command-|bash-|command-|system-reminder)/;

const makeQueued = (text: string, ts: string | undefined, n: number): QueueEntry => ({
  key: `queued:${ts ?? Date.now()}:${n}`,
  text, // ⚠️ 원문 그대로 둔다 — remove 연산이 글자로 맞춰 찾는다(applyQueueOps). 다듬기는 visibleQueue 에서
  ...(ts ? { ts } : {}),
  hidden: SYSTEM_QUEUED_RE.test(text.trimStart()),
});

const IMAGE_MARK_RE = /\[Image #\d+\]\s*/g;

/**
 * 보여 줄 대기열(사람 메시지만) — 이미지 자리 표시(`[Image #4]`)는 걷고 장수로 단다. 읽힌 뒤의 말풍선
 * (transcript.ts userTextItem)과 같은 모양이어야 '대기 중' → 보통 말풍선으로 바뀔 때 글이 달라지지 않는다
 */
const visibleQueue = (q: QueueEntry[]): ChatQueued[] =>
  q
    .filter((x) => !x.hidden)
    .map(({ key, text, ts }) => {
      const images = text.match(IMAGE_MARK_RE)?.length ?? 0;
      return {
        key,
        text: images ? text.replace(IMAGE_MARK_RE, '').trim() : text,
        ...(images ? { images } : {}),
        ...(ts ? { ts } : {}),
      };
    });

/** 대기열을 갱신하고 보이는 것이 바뀌었는지 */
function updateQueue(w: Watch, ops: QueueOp[]): boolean {
  if (!ops.length) return false;
  const before = JSON.stringify(visibleQueue(w.queue));
  w.queue = applyQueueOps(w.queue, ops, makeQueued);
  return JSON.stringify(visibleQueue(w.queue)) !== before;
}

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
  const queue = applyQueueOps<QueueEntry>([], parsed.queueOps, makeQueued);
  if (!only) {
    w.offset = size - (Buffer.byteLength(text, 'utf8') - used);
    w.queue = queue;
  }
  emit(
    w,
    {
      type: 'chat',
      id: w.termId,
      reset: true,
      items: parsed.items.slice(-INITIAL_ITEMS),
      results: parsed.results,
      ...(size === 0 ? { fresh: true } : {}),
      // 이미 도는 구독에 합류한 쪽(only)에는 지금 들고 있는 대기열을 준다 — 꼬리를 다시 읽어 만든 것은
      // 비운 기록(sweepQueue·놓친 꺼냄)을 모르고 '대기 중' 유령을 되살린다
      queued: visibleQueue(only ? w.queue : queue),
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
  const queueChanged = updateQueue(w, parsed.queueOps);
  if (!parsed.items.length && !parsed.results.length && !queueChanged) return;
  emit(w, {
    type: 'chat',
    id: w.termId,
    reset: false,
    items: parsed.items,
    results: parsed.results,
    ...(queueChanged ? { queued: visibleQueue(w.queue) } : {}),
  });
}

/** 한가한데 대기열이 남아 있으면 잠시 뒤 비운다(QUEUE_STALE_MS) */
function sweepQueue(w: Watch, found: Found | null) {
  if (found?.status !== 'idle' || !w.queue.length) {
    w.queueIdleSince = 0;
    return;
  }
  if (!w.queueIdleSince) w.queueIdleSince = Date.now();
  if (Date.now() - w.queueIdleSince < QUEUE_STALE_MS) return;
  const hadVisible = visibleQueue(w.queue).length > 0;
  w.queue = [];
  w.queueIdleSince = 0;
  if (hadVisible) emit(w, { type: 'chat', id: w.termId, reset: false, items: [], results: [], queued: [] });
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
      sweepQueue(w, found);
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
      queue: [],
      queueIdleSince: 0,
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

/** 채팅 입력의 Enter 지연 — 붙여넣기 끝을 claude 가 처리한 뒤에 Enter 가 오도록 */
const CHAT_SUBMIT_DELAY_MS = 250;

const paste = (s: string) => `\x1b[200~${s}\x1b[201~`;

/**
 * 폰 채팅 입력창 전송 — 글을 claude 입력란에 붙여넣고 Enter(server.ts WS). 데스크톱은 채팅이 읽기 전용이라
 * 아래로 드러난 터미널에 직접 친다(이미지·`/`·`@` 도 claude 그대로 — 예전 이미지 첨부 흉내는 걷어냈다).
 * ⚠️ 한 줄 글도 **bracketed paste 로 감싼다** — 감싸지 않은 글자 덩어리 뒤의 Enter 를 claude 가 붙여넣기 일부로
 *    삼켜 **글이 입력란에 남고 제출되지 않았다**(2026-10-01 재현). 붙여넣기 끝 표시가 있으면 Enter 가 제출로 읽힌다.
 *    여러 줄도 이 방식이라 줄마다 제출되지 않는다(claude 는 긴 붙여넣기를 `[Pasted text #1 +N lines]` 로 접는다).
 * ⚠️ claude 입력란을 비우지 말 것 — 중단 뒤 되돌아온 글은 ChatView 의 [중단]이 직후에 비운다.
 */
export function sendChatText(id: string, text: string) {
  if (typeof text !== 'string' || !text.trim()) return;
  if (!listSessions().some((s) => s.id === id)) return;
  writeSession(id, paste(text));
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

/** `@` 자동완성 목록 — 대화를 구독 중이면 claude 의 cwd, 아니면 세션 위치 기준 저장소 파일 */
export function chatFilesFor(termId: string): Promise<string[]> {
  const cwd = watches.get(termId)?.found?.cwd ?? listSessions().find((s) => s.id === termId)?.cwd;
  return cwd ? listChatFiles(cwd) : Promise.resolve([]);
}
