// 워커에 글 넣기 — send_to_session 과 작업 감시의 보고 요청(tasks.ts)이 같은 길을 쓴다.
//
// 폰 채팅과 같은 sendChatText(붙여넣기 + Enter)다. 넣기 전에 guard.ts checkSend 로 막을 곳(질문 창·입력 상자 없음)을 거르고,
// 사용자가 입력란에 쓰던 글이 있으면 claude 의 입력 보관(Ctrl+S)으로 치운 뒤 넣는다(orchestrator 규칙 '지시 입력').
// ⚠️ 같은 세션에 넣는 것은 **한 번에 하나** — 지시와 보고 요청이 겹치면 확인(화면 읽기)과 붙여넣기 사이에 다른 붙여넣기가 끼어
//    두 글이 한 입력란에 섞여 제출된다. 세션별로 줄을 세우고, Enter 가 나갈 때까지 다음 글을 기다리게 한다.
import type { ChatPrompt } from '../../../shared/terminal-protocol';
import { sleep } from '../../lib/util';
import {
  CHAT_SUBMIT_DELAY_MS,
  dockShellId,
  fileSize,
  findClaude,
  listSessions,
  parseScreenPrompt,
  sendChatText,
  sessionScreen,
  writeSession,
  type ClaudeProcess,
} from '../terminal';
import { checkSend, inputBoxText, sanitizeInstruction, STASH_KEY } from './guard';
import { getRootSessionId } from './store';
import { NO_SESSION, stateOf } from './toolKit';

/** 보관(Ctrl+S) 뒤 붙여넣기까지 — claude 가 입력란을 비우고 다시 그릴 틈 */
const STASH_SETTLE_MS = 150;

/** 지금 떠 있는 질문·권한·플랜 창 — claude 가 'waiting' 일 때만 읽는다(답변 속 '1. …' 오인 방지, waitCard.ts 와 같은 게이트) */
export async function currentPrompt(id: string, claude: ClaudeProcess | null): Promise<ChatPrompt | null> {
  if (claude?.status !== 'waiting') return null;
  const screen = await sessionScreen(id);
  return screen ? parseScreenPrompt(screen) : null;
}

export type Delivered =
  /** offset = 붙여넣기 직전 대화 기록 크기 — 그 뒤에 쓰인 줄부터가 이번 글의 일이다(작업 원장이 거기서 읽는다) */
  | { ok: true; queued: boolean; stashed: boolean; claude: ClaudeProcess; offset: number }
  | { ok: false; reason: string };

function transcriptSize(file: string): number {
  try {
    return fileSize(file);
  } catch {
    return 0; // 첫 메시지 전이라 아직 없다
  }
}

/** 세션별 넣기 줄 — 앞 것이 끝나야(Enter 까지) 다음 것을 확인하고 넣는다 */
const lanes = new Map<string, Promise<unknown>>();

/** 워커 입력란에 글을 넣는다 — 작업 중이면 claude 대기열로 간다(queued) */
export function deliver(sessionId: string, text: string): Promise<Delivered> {
  const run = (lanes.get(sessionId) ?? Promise.resolve()).catch(() => undefined).then(() => deliverNow(sessionId, text));
  lanes.set(sessionId, run);
  run
    .finally(() => {
      if (lanes.get(sessionId) === run) lanes.delete(sessionId);
    })
    .catch(() => undefined); // 실패는 호출한 쪽이 받는다 — 여기서는 줄만 정리
  return run;
}

async function deliverNow(sessionId: string, text: string): Promise<Delivered> {
  const s = listSessions().find((x) => x.id === sessionId);
  if (!s) return { ok: false, reason: NO_SESSION };
  const instruction = sanitizeInstruction(text);
  if (!instruction.trim()) return { ok: false, reason: '넣을 글이 비었습니다.' };
  const claude = await findClaude(sessionId);
  const [prompt, styled] = await Promise.all([currentPrompt(sessionId, claude), sessionScreen(sessionId, { styled: true })]);
  const check = checkSend({
    isRoot: sessionId === getRootSessionId(),
    isDockShell: sessionId === dockShellId(),
    hasClaude: !!claude,
    prompt,
    inputText: styled === null ? null : inputBoxText(styled),
  });
  if (!check.ok) return { ok: false, reason: check.reason };
  if (!claude) return { ok: false, reason: '이 탭에는 claude 가 떠 있지 않습니다.' }; // checkSend 가 이미 거른다 — 타입 좁히기
  const queued = stateOf(s, claude.status) === 'working';
  // 쓰던 글이 있으면 먼저 보관 — 안 하면 그 글 뒤에 지시가 붙어 한꺼번에 제출된다
  if (check.stashDraft) {
    writeSession(sessionId, STASH_KEY);
    await sleep(STASH_SETTLE_MS);
  }
  const offset = transcriptSize(claude.file);
  sendChatText(sessionId, instruction);
  await sleep(CHAT_SUBMIT_DELAY_MS + 50); // Enter 가 나간 뒤에 줄을 비운다
  return { ok: true, queued, stashed: check.stashDraft, claude, offset };
}
