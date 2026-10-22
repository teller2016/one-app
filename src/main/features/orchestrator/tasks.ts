// 루트 작업 원장 + 감시 — 루트가 넣은 지시를 한 줄씩 남기고, 워커가 끝나면 4줄 보고를 요청하고, 보고가 오면 닫는다.
//
//   지시함(dispatched) → 작업 중(working) → [질문 대기(waiting_prompt)] → 보고 요청함(report_requested) → 보고받음(reported)
//
// - 끝남 판정은 화면 휴리스틱이 아니라 **claude 가 남기는 상태(sessions/<pid>.json 의 status)** + 대화 기록:
//   우리 지시가 읽혔고(taskScan.scanWorker) 그 뒤 답이 나왔고 status 가 idle 로 두 번 연속 보이면 끝. 대기열에 들어간 지시도
//   그 차례가 끝나야 끝이다(앞 일이 끝나도 claude 가 곧장 꺼내 busy 를 잇는다 — 두 번 연속 조건이 그 틈을 거른다).
// - 보고 요청은 지시 꼬리가 아니라 끝난 뒤 따로 넣는다(꼬리로 붙이면 run-ticket 이 부가 설명으로 읽는다 — 기획 결정).
//   질문 창이 떠 있으면 넣지 않는다(사용자가 직접 답한다).
// - 보고받음 = 루트 대화 기록에 그 워커 claude(pid)가 보낸 세션 간 메시지가 들어왔다(origin.verifiedPeerPid).
// - 감시는 열린 일이 있을 때만 3초마다 돈다. 원장은 인스턴스별 런타임 파일(dev·설치본의 tmux 세션이 다르다).
import crypto from 'node:crypto';
import { isOpenTask, type OrchestratorTask, type TerminalOverviewItem } from '../../../shared/types';
import { broadcast } from '../../lib/broadcast';
import { runtimeFile } from '../../lib/devInstance';
import { readUserJson, writeUserJson } from '../../lib/store';
import {
  completeLines,
  fileSize,
  findClaude,
  findClaudeMany,
  listSessions,
  readRange,
  sessionRootPid,
  type ClaudeProcess,
} from '../terminal';
import { currentPrompt, deliver } from './deliver';
import { ticketKeyOf } from './guard';
import { getRootSessionId, ROOT_NAME } from './store';
import { peerMessages, scanWorker, WORKER_SCAN_START, type WorkerScan } from './taskScan';

const FILE = runtimeFile('orchestrator-tasks.json');

const TICK_MS = 3_000;
/** idle 가 이만큼 연달아 보여야 끝 — 대기열의 다음 지시로 넘어가는 순간의 idle 을 거른다 */
const IDLE_STREAK_DONE = 2;
/** claude 를 못 찾는 것이 이만큼 이어지면 끝난 것으로 — 프로세스 목록 한 번 놓친 것으로 닫지 않는다 */
const MISS_STREAK_GONE = 2;
/** 지시 글을 대화 기록에서 못 맞춰도 이만큼 지나 답이 있고 쉬고 있으면 끝으로 본다(긴 붙여넣기 접힘 등) */
const UNMATCHED_GRACE_MS = 2 * 60_000;
/** 지시가 읽힌 흔적도 답도 없이 쉬고 있는 채로 이만큼 지나면 닫는다 — 붙여넣기가 유실된 경우 '루트' 표시가 영영 남지 않게 */
const UNREAD_GIVE_UP_MS = 10 * 60_000;
/** 보고 요청을 못 넣으면 다음 틱에 다시 — 이만큼 실패하면 포기(약 30초) */
const REPORT_TRIES = 10;
/** 보고 요청 뒤 이만큼 보고가 없으면 닫는다 */
const REPORT_WAIT_MS = 30 * 60_000;
/** 워커가 보고 요청 턴을 마쳤는데 보고가 안 왔을 때 더 기다리는 틱 수 — 루트가 바빠 메시지가 늦게 기록될 틈(약 30초) */
const REPORT_LATE_TICKS = 10;
/** 원장 보존 — 7일 · 50개 */
const KEEP_MS = 7 * 24 * 60 * 60_000;
const KEEP_MAX = 50;
/** 루트 대화 기록을 처음(또는 파일이 바뀐 뒤) 읽을 때의 꼬리 — 앱을 껐다 켠 사이 온 보고까지 */
const ROOT_FIRST_TAIL_BYTES = 512 * 1024;
const INSTRUCTION_KEEP = 300;

/** 원장 한 줄 + 감시용 내부 값(파일에만, 방송·도구에는 안 나간다) */
type Stored = OrchestratorTask & {
  file?: string;
  offset?: number;
  scan?: WorkerScan;
  workerPid?: number;
  reportRequestedAt?: number;
  reportTries?: number;
};

let tasks: Stored[] | null = null;
/** 틱 사이에만 필요한 값 — 저장하지 않는다 */
const idleStreak = new Map<string, number>();
const missStreak = new Map<string, number>();
let rootScan: { file: string; offset: number } | null = null;
let timer: NodeJS.Timeout | null = null;
let ticking = false;

const load = (): Stored[] => {
  if (!tasks) tasks = readUserJson<{ tasks?: Stored[] }>(FILE, {}).tasks ?? [];
  return tasks;
};

const toPublic = (t: Stored): OrchestratorTask => ({
  id: t.id,
  sessionId: t.sessionId,
  ticketKey: t.ticketKey,
  repo: t.repo,
  branch: t.branch,
  tab: t.tab,
  instruction: t.instruction,
  report: t.report,
  state: t.state,
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
  note: t.note,
});

/** 최근 것부터 */
export const listTasks = (): OrchestratorTask[] => [...load()].sort((a, b) => b.createdAt - a.createdAt).map(toPublic);

function save(): void {
  const now = Date.now();
  const list = load()
    .filter((t) => isOpenTask(t) || now - t.updatedAt < KEEP_MS)
    .sort((a, b) => b.createdAt - a.createdAt);
  // 넘치면 닫힌 것부터 버린다
  while (list.length > KEEP_MAX) {
    const i = list.map((t) => isOpenTask(t)).lastIndexOf(false);
    list.splice(i >= 0 ? i : list.length - 1, 1);
  }
  tasks = list;
  writeUserJson(FILE, { tasks: list });
  broadcast('orchestrator:tasks', listTasks());
  if (list.some(isOpenTask)) ensureTimer();
}

function update(t: Stored, patch: Partial<Stored>): void {
  Object.assign(t, patch, { updatedAt: Date.now() });
  if (!isOpenTask(t)) {
    idleStreak.delete(t.id);
    missStreak.delete(t.id);
  }
}

/**
 * 지시를 원장에 올린다 — send_to_session 이 넣은 직후. 같은 세션에 아직 끝나지 않은(보고 요청 전) 일이 있으면
 * 그 일은 닫고 이번 일에 합친다 — claude 가 차례로 처리하니 보고는 마지막 한 번이면 된다.
 */
export function addTask(input: {
  sessionId: string;
  item: TerminalOverviewItem | undefined;
  tab: string;
  instruction: string;
  report: boolean;
  claude: ClaudeProcess;
}): OrchestratorTask {
  const list = load();
  for (const t of list) {
    if (t.sessionId === input.sessionId && (t.state === 'dispatched' || t.state === 'working' || t.state === 'waiting_prompt')) {
      update(t, { state: 'done', note: '같은 세션에 다음 지시가 들어와 보고를 한 번으로 합쳤습니다.' });
    }
  }
  const now = Date.now();
  const t: Stored = {
    id: crypto.randomUUID().slice(0, 8),
    sessionId: input.sessionId,
    ticketKey: input.item ? ticketKeyOf(input.item) : null,
    repo: input.item?.workspace?.name ?? null,
    branch: input.item?.branch ?? null,
    tab: input.tab,
    instruction: input.instruction.slice(0, INSTRUCTION_KEEP),
    report: input.report,
    state: 'dispatched',
    createdAt: now,
    updatedAt: now,
    file: input.claude.file,
    // 지시를 넣기 직전의 크기 — 붙여넣기 + Enter 가 250ms 뒤라 그 전의 기록은 이전 일이다
    offset: safeSize(input.claude.file),
    scan: WORKER_SCAN_START,
  };
  list.push(t);
  save();
  return toPublic(t);
}

function safeSize(file: string): number {
  try {
    return fileSize(file);
  } catch {
    return 0; // 첫 메시지 전이라 아직 없다
  }
}

/** 파일의 offset 부터 끝까지 완성된 줄 — 다음 offset 과 함께 */
function readNew(file: string, offset: number): { lines: string[]; next: number } {
  const size = safeSize(file);
  if (size <= offset) return { lines: [], next: size < offset ? 0 : offset }; // 줄었다 = 새 파일
  const { lines, used } = completeLines(readRange(file, offset, size));
  return { lines, next: offset + used };
}

/**
 * 보고 요청 문구 — 워커 claude 가 읽는다. 무슨 일이었는지·보낼 곳·양식을 함께.
 * ⚠️ **한 줄로** — 여러 줄 붙여넣기는 claude 가 `<pasted_content>` 로 감싸 "사용자가 쓰지 않았을 수 있는 글"로 다뤄,
 *    워커가 4줄을 채워 달라고 사용자에게 되물었다(10-22 haiku 실측 2회). 한 줄은 감싸지 않는다.
 * ⚠️ 티켓 키만 쓰지 말 것 — 워커가 실제로 받은 지시 글과 이어지지 않아 "다른 세션의 일"로 읽었다. 지시 앞머리를 함께 준다.
 */
export function reportRequest(t: Pick<OrchestratorTask, 'ticketKey' | 'instruction'>): string {
  const head = t.instruction.replace(/\s+/g, ' ').trim();
  const what = `"${head.length > 40 ? `${head.slice(0, 40)}…` : head}"${t.ticketKey ? `(${t.ticketKey})` : ''}`;
  return (
    `[One App 루트 세션의 자동 요청] 방금 네가 끝낸 일 ${what}의 결과를, 사용자에게 묻지 말고 네가 직접 정리해서 ` +
    `SendMessage 도구로 to="${ROOT_NAME}"(ListAgents 에 보이는 루트 세션)에게 바로 보내라 — 내용은 4줄: ` +
    '"상태: 끝남/막힘/사용자 답 대기 중 하나" · "바뀐 파일: 이번 일에서 바꾼 경로(없으면 없음)" · ' +
    '"검증 결과: 돌린 확인과 결과(안 했으면 안 함)" · "남은 질문: 사용자에게 물을 것(없으면 없음)". 보낸 뒤엔 "보고함" 한 줄만 답한다.'
  );
}

/** 루트 대화 기록에 새로 들어온 세션 간 메시지 */
async function newPeerMessages() {
  const rootId = getRootSessionId();
  const root = rootId ? await findClaude(rootId) : null;
  if (!root) return [];
  if (!rootScan || rootScan.file !== root.file) {
    rootScan = { file: root.file, offset: Math.max(0, safeSize(root.file) - ROOT_FIRST_TAIL_BYTES) };
    if (rootScan.offset > 0) {
      // 꼬리 첫 조각은 줄 중간이다 — 다음 줄바꿈까지 건너뛴다
      const head = readRange(root.file, rootScan.offset, Math.min(safeSize(root.file), rootScan.offset + 64 * 1024));
      rootScan.offset += head.indexOf('\n') + 1;
    }
  }
  const { lines, next } = readNew(rootScan.file, rootScan.offset);
  rootScan.offset = next;
  return peerMessages(lines);
}

/** 끝났다 — 보고 요청을 넣거나(기본) 그냥 닫는다 */
async function finish(t: Stored, claude: ClaudeProcess): Promise<void> {
  if (!t.report) {
    update(t, { state: 'done', note: '보고 생략(지시할 때 report:false).' });
    return;
  }
  const res = await deliver(t.sessionId, reportRequest(t));
  if (res.ok) {
    // 보고 요청 턴을 따로 감시한다 — 워커가 보내지 않고 턴을 마치면(되묻기 등) 곧 닫기 위해
    update(t, {
      state: 'report_requested',
      workerPid: claude.pid,
      reportRequestedAt: Date.now(),
      offset: safeSize(claude.file),
      scan: WORKER_SCAN_START,
      note: undefined,
    });
    idleStreak.set(t.id, 0);
    return;
  }
  const tries = (t.reportTries ?? 0) + 1;
  if (tries >= REPORT_TRIES) update(t, { state: 'done', reportTries: tries, note: `보고 요청을 넣지 못했습니다: ${res.reason}` });
  else t.reportTries = tries;
}

/**
 * 보고 요청 턴이 보고 없이 끝났는가 — 요청 글이 읽혔고 답이 나왔고 쉬는 상태가 REPORT_LATE_TICKS 만큼 이어졌다.
 * (보고를 보냈다면 SendMessage 가 턴 안에서 루트에 닿으니 그 사이 peer 로 잡혔어야 한다)
 */
async function reportTurnEnded(t: Stored, claude: ClaudeProcess): Promise<boolean> {
  if (t.file !== claude.file) Object.assign(t, { file: claude.file, offset: 0 });
  const { lines, next } = readNew(claude.file, t.offset ?? 0);
  const scan = scanWorker(lines, reportRequest(t), t.scan ?? WORKER_SCAN_START);
  Object.assign(t, { offset: next, scan });
  const resting = claude.status === 'idle' && scan.consumed && scan.replied;
  const streak = resting ? (idleStreak.get(t.id) ?? 0) + 1 : 0;
  idleStreak.set(t.id, streak);
  return streak >= REPORT_LATE_TICKS;
}

/** 작업 중인 일 하나 — 대화 기록을 이어 읽고 claude 상태로 다음 단계를 정한다 */
async function watchWork(t: Stored, claude: ClaudeProcess): Promise<void> {
  // /clear·재시작으로 대화 파일이 바뀌었으면 새 파일 처음부터
  if (t.file !== claude.file) Object.assign(t, { file: claude.file, offset: 0 });
  const { lines, next } = readNew(claude.file, t.offset ?? 0);
  const scan = scanWorker(lines, t.instruction, t.scan ?? WORKER_SCAN_START);
  Object.assign(t, { offset: next, scan });

  if (claude.status === 'busy') {
    idleStreak.set(t.id, 0);
    if (t.state !== 'working' && (scan.consumed || t.state === 'waiting_prompt')) update(t, { state: 'working' });
    return;
  }
  if (claude.status === 'waiting' && (await currentPrompt(t.sessionId, claude))) {
    idleStreak.set(t.id, 0);
    if (t.state !== 'waiting_prompt') update(t, { state: 'waiting_prompt' });
    return;
  }
  // 쉬는 중 — 지시가 읽혔고 그 뒤 답이 나왔으면 끝 후보. 못 맞췄어도 오래 지났고 답이 있으면 끝으로 본다
  const age = Date.now() - t.createdAt;
  const answered = (scan.consumed && scan.replied) || (scan.anyReply && age > UNMATCHED_GRACE_MS);
  if (!answered) {
    if (!scan.consumed && age > UNREAD_GIVE_UP_MS) {
      update(t, { state: 'done', note: '지시가 읽힌 흔적을 대화 기록에서 찾지 못했습니다 — 워커 탭을 확인해 주세요.' });
    }
    return;
  }
  const streak = (idleStreak.get(t.id) ?? 0) + 1;
  idleStreak.set(t.id, streak);
  if (streak >= IDLE_STREAK_DONE) await finish(t, claude);
}

async function tick(): Promise<void> {
  const open = load().filter(isOpenTask);
  if (!open.length) {
    stopTimer();
    return;
  }
  const before = JSON.stringify(open.map(toPublic));
  const beforeAll = JSON.stringify(open);
  const alive = new Set(listSessions().map((s) => s.id));
  const roots = new Map<string, number>();
  for (const t of open) {
    if (!alive.has(t.sessionId) || roots.has(t.sessionId)) continue;
    const pid = await sessionRootPid(t.sessionId);
    if (pid) roots.set(t.sessionId, pid);
  }
  const claudes = await findClaudeMany(roots);
  const peers = open.some((t) => t.state === 'report_requested') ? await newPeerMessages() : [];

  for (const t of open) {
    if (!alive.has(t.sessionId)) {
      update(t, { state: 'gone', note: '탭이 닫혔습니다.' });
      continue;
    }
    const claude = claudes.get(t.sessionId);
    if (!claude) {
      const miss = (missStreak.get(t.id) ?? 0) + 1;
      missStreak.set(t.id, miss);
      if (miss >= MISS_STREAK_GONE) update(t, { state: 'gone', note: '탭의 claude 가 끝났습니다.' });
      continue;
    }
    missStreak.set(t.id, 0);
    if (t.state === 'report_requested') {
      const since = (t.reportRequestedAt ?? 0) - 5_000;
      if (peers.some((p) => p.pid === t.workerPid && (p.at === 0 || p.at >= since))) {
        update(t, { state: 'reported', note: undefined });
      } else if (await reportTurnEnded(t, claude)) {
        update(t, { state: 'done', note: '워커가 보고를 보내지 않고 턴을 마쳤습니다 — read_session 으로 마지막 답을 확인하세요.' });
      } else if (Date.now() - (t.reportRequestedAt ?? 0) > REPORT_WAIT_MS) {
        update(t, { state: 'done', note: '보고 요청 뒤 30분 동안 보고가 오지 않았습니다.' });
      }
      continue;
    }
    await watchWork(t, claude);
  }
  // 감시용 값(offset 등)만 바뀐 틱은 방송하지 않는다 — 저장만. 아무것도 안 바뀐 틱은 쓰지도 않는다
  if (JSON.stringify(open.map(toPublic)) !== before) save();
  else if (JSON.stringify(open) !== beforeAll) writeUserJson(FILE, { tasks: load() });
}

function ensureTimer(): void {
  if (timer) return;
  timer = setInterval(() => {
    if (ticking) return; // 앞 틱이 아직 — ps·파일 읽기가 느린 순간 겹치지 않게
    ticking = true;
    tick()
      .catch((err: unknown) => console.error('[orchestrator] 작업 감시 실패:', err))
      .finally(() => (ticking = false));
  }, TICK_MS);
}

function stopTimer(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

/** 앱 시작 — 남은 열린 일이 있으면 감시를 다시 건다 */
export function startTaskWatcher(): void {
  if (load().some(isOpenTask)) ensureTimer();
}

export const stopTaskWatcher = stopTimer;
