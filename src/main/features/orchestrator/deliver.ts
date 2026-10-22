// 워커에 글 넣기 — send_to_session 과 작업 감시의 보고 요청(tasks.ts)이 같은 길을 쓴다.
//
// 폰 채팅과 같은 sendChatText(붙여넣기 + Enter)다. 넣기 전에 guard.ts checkSend 로 막을 곳(질문 창·입력 상자 없음)을 거르고,
// 사용자가 입력란에 쓰던 글이 있으면 claude 의 입력 보관(Ctrl+S)으로 치운 뒤 넣는다(orchestrator 규칙 '지시 입력').
import type { ChatPrompt } from '../../../shared/terminal-protocol';
import { sleep } from '../../lib/util';
import {
  dockShellId,
  findClaude,
  listSessions,
  parseScreenPrompt,
  sendChatText,
  sessionScreen,
  sessionStyledScreen,
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
  | { ok: true; queued: boolean; stashed: boolean; claude: ClaudeProcess }
  | { ok: false; reason: string };

/** 워커 입력란에 글을 넣는다 — 작업 중이면 claude 대기열로 간다(queued) */
export async function deliver(sessionId: string, text: string): Promise<Delivered> {
  const s = listSessions().find((x) => x.id === sessionId);
  if (!s) return { ok: false, reason: NO_SESSION };
  const instruction = sanitizeInstruction(text);
  if (!instruction.trim()) return { ok: false, reason: '넣을 글이 비었습니다.' };
  const claude = await findClaude(sessionId);
  const [prompt, styled] = await Promise.all([currentPrompt(sessionId, claude), sessionStyledScreen(sessionId)]);
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
  sendChatText(sessionId, instruction);
  return { ok: true, queued, stashed: check.stashDraft, claude };
}
