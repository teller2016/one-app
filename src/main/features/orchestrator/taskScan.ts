// 루트 작업 감시의 순수 판정 — 대화 기록(jsonl) 줄에서 "우리 지시가 읽혔나 · 답했나 · 워커 보고가 왔나 · 루트의 이번 입력이
// 사람인가"를 읽는다. 파일·타이머 없음(taskScan.test.ts). 감시 루프는 tasks.ts.
//
// 기록 형식(Claude Code 2.1.x, terminal/transcript.ts 머리말과 같은 실측):
// - 사람이 친 입력 = type 'user' + content 문자열(isMeta·isSidechain 아님). 슬래시 명령은 `<command-name>/이름</command-name>` 로 바뀐다.
// - 진행 중인 턴에 끼워 넣어 읽힌 입력은 user 줄 없이 attachment 'queued_command'(prompt) 로만 남는다.
// - 세션 간 메시지(SendMessage)는 **`isMeta: true`** 인 user 줄 + `origin.kind: 'peer'`(+ name·verifiedPeerPid·body)로 남는다
//   (2026-10-22 실측 — content 는 'Another Claude session sent a message:\n<cross-session-message …>'). origin 이 없으면 사람 입력이다.
// - **여러 줄 붙여넣기는 `\n\n<pasted_content id="…">\n본문\n</pasted_content>` 로 감싸 기록된다**(한 줄은 그대로, 2026-10-22 실측) —
//   앞머리를 맞출 때 감싼 것을 벗긴다.
// ⚠️ 모르는 줄은 조용히 건너뛴다 — 한 줄이 깨졌다고 감시가 멈추면 안 된다.

type Origin = { kind?: string; name?: string; verifiedPeerPid?: number };

type Line = {
  type?: string;
  /** queue-operation 의 enqueue·dequeue… */
  operation?: string;
  content?: unknown;
  isMeta?: boolean;
  isSidechain?: boolean;
  timestamp?: string;
  origin?: Origin;
  message?: { content?: unknown };
  attachment?: { type?: string; prompt?: unknown; origin?: Origin };
};

/** 입력 줄 하나 — 사람 입력·끼워 넣은 입력·세션 간 메시지 */
type Input = { text: string; origin: Origin | undefined; at: number };

function parse(raw: string): Line | null {
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === 'object' ? (v as Line) : null;
  } catch {
    return null;
  }
}

const tsOf = (l: Line) => {
  const t = l.timestamp ? Date.parse(l.timestamp) : NaN;
  return Number.isFinite(t) ? t : 0;
};

/**
 * 입력 줄이면 그 글과 출처 — 도구 결과(content 배열)·주입물(isMeta)·서브에이전트 줄은 입력이 아니다.
 * ⚠️ 단 isMeta 여도 **사람이 아닌 출처(peer 등)가 적힌 줄은 입력**이다 — 세션 간 메시지가 그 모양으로 온다.
 */
function inputOf(l: Line): Input | null {
  if (l.isSidechain) return null;
  const foreign = !!l.origin?.kind && l.origin.kind !== 'human';
  if (l.type === 'user' && (!l.isMeta || foreign) && typeof l.message?.content === 'string') {
    return { text: l.message.content, origin: l.origin, at: tsOf(l) };
  }
  if (l.type === 'attachment' && l.attachment?.type === 'queued_command' && typeof l.attachment.prompt === 'string') {
    return { text: l.attachment.prompt, origin: l.attachment.origin ?? l.origin, at: tsOf(l) };
  }
  return null;
}

const isAssistant = (l: Line) => l.type === 'assistant' && !l.isSidechain;

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

const PASTED_RE = /<pasted_content[^>]*>\n?([\s\S]*?)\n?<\/pasted_content>/;

/** 붙여넣기 감싸개를 벗긴 본문 — 감싸지 않았으면 그대로 */
const unwrapPasted = (s: string) => PASTED_RE.exec(s)?.[1] ?? s;

/** 비교할 앞머리 — 긴 지시는 claude 가 붙여넣기를 접어 둘 수 있어 앞부분만 본다 */
const HEAD_CHARS = 40;

/**
 * 이 입력이 우리가 넣은 지시인가 — 슬래시 명령은 명령 이름으로, 그 밖은 앞머리로 맞춘다.
 * 사람 입력(origin 없음·human)만 본다 — 세션 간 메시지가 우연히 같은 글로 시작해도 우리 지시가 아니다.
 */
export function matchesInstruction(input: Pick<Input, 'text' | 'origin'>, instruction: string): boolean {
  if ((input.origin?.kind ?? 'human') !== 'human') return false;
  const want = norm(instruction);
  if (!want) return false;
  const cmd = /^\/([\w:.-]+)/.exec(want);
  const got = norm(unwrapPasted(input.text));
  if (cmd) return input.text.includes(`<command-name>/${cmd[1]}</command-name>`) || got.startsWith(want.slice(0, HEAD_CHARS));
  return got.startsWith(want.slice(0, HEAD_CHARS));
}

/**
 * 워커 쪽 진행 — 줄을 조각조각 읽으므로 이전 결과를 이어받는다.
 * anyReply 는 지시 글을 못 맞췄을 때의 대비(긴 붙여넣기를 claude 가 접어 기록하는 경우 등) — 지시 뒤 답이 하나라도 나왔는가.
 */
export type WorkerScan = { consumed: boolean; replied: boolean; anyReply: boolean };

export const WORKER_SCAN_START: WorkerScan = { consumed: false, replied: false, anyReply: false };

/** 워커 대화 기록의 새 줄 — 우리 지시가 읽혔고(consumed) 그 뒤에 답이 나왔는가(replied) */
export function scanWorker(lines: string[], instruction: string, prev: WorkerScan): WorkerScan {
  let { consumed, replied, anyReply } = prev;
  for (const raw of lines) {
    const l = parse(raw);
    if (!l) continue;
    if (isAssistant(l)) anyReply = true;
    if (!consumed) {
      const input = inputOf(l);
      if (input && matchesInstruction(input, instruction)) consumed = true;
      continue;
    }
    if (isAssistant(l)) replied = true;
  }
  return { consumed, replied, anyReply };
}

/** 루트 대화 기록에 들어온 세션 간 메시지 — 보낸 claude 의 pid(검증된 것)와 시각 */
export type PeerMessage = { pid: number | null; name: string | null; at: number };

/** 대기열에 들어간 세션 간 메시지의 보낸 쪽 — `<cross-session-message from="uds:/tmp/cc-socks/<pid>.sock" from-name="…">` */
const QUEUED_PEER_RE = /<cross-session-message from="uds:[^"]*?\/(\d+)\.sock"(?: from-name="([^"]*)")?/;

/**
 * 루트에 온 세션 간 메시지. 루트가 바쁘면 메시지는 먼저 대기열(queue-operation enqueue)에 들어가고 입력 줄은 차례가 와야 생긴다 —
 * 그 사이 '보고 없음'으로 닫지 않게 enqueue 도 센다(보낸 쪽 pid 는 소켓 이름에서 — 원장 상태용이지 보안 판정용이 아니다).
 */
export function peerMessages(lines: string[]): PeerMessage[] {
  const out: PeerMessage[] = [];
  for (const raw of lines) {
    const l = parse(raw);
    if (l?.type === 'queue-operation' && l.operation === 'enqueue' && typeof l.content === 'string') {
      const m = QUEUED_PEER_RE.exec(l.content);
      if (m) out.push({ pid: Number(m[1]), name: m[2] ?? null, at: tsOf(l) });
      continue;
    }
    const input = l && inputOf(l);
    if (!input || input.origin?.kind !== 'peer') continue;
    const pid = input.origin.verifiedPeerPid;
    out.push({ pid: typeof pid === 'number' ? pid : null, name: input.origin.name ?? null, at: input.at });
  }
  return out;
}

/**
 * 루트의 마지막 입력의 출처 — 'human'(사람) · 'peer'(워커 보고) · 그 밖(백그라운드 알림 등). 입력이 없으면 null.
 * 무인 연쇄 가드가 쓴다: 사람이 시킨 턴이 아니면 상태를 바꾸는 도구를 승인 창에 올린다.
 */
export function lastInputKind(lines: string[]): string | null {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const l = parse(lines[i]);
    const input = l && inputOf(l);
    if (input) return input.origin?.kind ?? 'human';
  }
  return null;
}
