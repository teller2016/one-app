// 입력 대기 알림 카드 + 알림에서 바로 답하기 (2026-10-06 — 사용자가 시안 C 를 골랐다, 캔버스 '입력 대기 알림 시안').
//
// 카드 = 저장소(색 타일)·브랜치·작업 제목 + ① 번호 선택 화면(질문·권한 확인·플랜 승인)이면 그 선택지, ② 아니면 claude 의
// 마지막 답변 한 줄. 선택 화면은 폰 채팅 보기와 같은 화면 읽기(`parseScreenPrompt`)이고, 답하기도 같은 방식 — **그 번호 키를
// PTY 에 쓴다**. ⚠️ 알림은 몇 초~몇 분 묵을 수 있다(그새 터미널·폰에서 답했을 수 있다) → 보내기 직전에 화면을 다시 읽어
// **알림이 보여 준 질문과 같을 때만** 보낸다(`promptKey` 비교 — 커서 위치는 빼고).
import { PROMPT_SUBMIT, type ChatPrompt } from '../../../shared/terminal-protocol';
import { promptKey } from '../../../shared/types';
import type { TerminalPromptAnswerResult, TerminalWaitCard } from '../../../shared/types';
import { sleep } from '../../lib/util';
import { completeLines, fileSize, findClaude, readRange } from './claudeFiles';
import { digestFile, placeOf } from './overview';
import { listSessions, markAnswerSubmitted, sessionScreen, writeSession } from './pty';
import { parseScreenPrompt } from './screenPrompt';
import { lastReplyOf } from './sessionDigest';

/** 마지막 답변을 찾는 꼬리 — 답변은 맨 끝에 있지만 그 앞 도구 결과 한 줄이 클 수 있다 */
const REPLY_TAIL_BYTES = 512 * 1024;
/** 번호 키를 보낸 뒤 claude 가 다음 화면을 그릴 때까지 기다리는 간격·횟수 */
const SETTLE_MS = 300;
const SETTLE_TRIES = 6;

/** 지금 화면의 번호 선택 화면 — 선택지가 없으면(못 읽음) null */
async function currentPrompt(id: string): Promise<ChatPrompt | null> {
  const screen = await sessionScreen(id);
  const p = screen ? parseScreenPrompt(screen) : null;
  return p && p.options.length ? p : null;
}

function lastReply(file: string): string | null {
  try {
    const size = fileSize(file);
    const start = Math.max(0, size - REPLY_TAIL_BYTES);
    let text = readRange(file, start, size);
    if (start > 0) text = text.slice(text.indexOf('\n') + 1); // 꼬리 첫 조각은 줄 중간이다
    return lastReplyOf(completeLines(text).lines) ?? null;
  } catch {
    return null;
  }
}

/** 입력 대기 알림 카드 — 세션이 없으면 null */
export async function waitCard(id: string): Promise<TerminalWaitCard | null> {
  const s = listSessions().find((x) => x.id === id);
  if (!s) return null;
  const [claude, place] = await Promise.all([findClaude(id), placeOf(s.cwd, new Map())]);
  // 선택 화면은 claude 가 '답 대기'라고 남겼을 때만 읽는다(채팅 보기와 같은 게이트) — 한가한 화면의 번호 목록
  // (답변 속 '1. …')을 선택지로 오인하지 않게
  const prompt = claude?.status === 'waiting' ? await currentPrompt(id) : null;
  const d = claude ? digestFile(claude.file)?.digest : undefined;
  return {
    ...place,
    title: d?.aiTitle ?? d?.firstPrompt ?? s.title,
    prompt,
    reply: prompt || !claude ? null : lastReply(claude.file),
  };
}

/**
 * 알림에서 고른 번호로 답한다 — 화면이 알림의 질문(`key`)과 같을 때만 번호 키를 보낸다.
 * `n = PROMPT_SUBMIT` 은 다중 선택의 '선택 완료'(→ 키).
 * 보낸 뒤엔 화면이 바뀔 때까지 잠깐 기다려 다음 선택 화면(여러 질문 → 검토 화면)을 돌려준다.
 * 끝까지 같은 화면이면 그대로 돌려준다 — 렌더러가 '터미널에서 확인'으로 물러난다(두 번 보내지 않게).
 */
export async function answerPrompt(id: string, key: string, n: number): Promise<TerminalPromptAnswerResult> {
  if (!listSessions().some((x) => x.id === id)) return { ok: false, reason: 'gone', prompt: null };
  const prompt = await currentPrompt(id);
  if (!prompt || promptKey(prompt) !== key) return { ok: false, reason: 'stale', prompt };
  const submit = n === PROMPT_SUBMIT && !!prompt.multiSelect;
  if (!submit && (n === prompt.freeText || !prompt.options.some((o) => o.n === n))) {
    return { ok: false, reason: 'invalid', prompt };
  }
  // 다중 선택: 번호 = 체크 토글, '선택 완료' = → 키(Submit 탭의 검토 화면으로 — 2026-10-06 실측)
  writeSession(id, submit ? '\x1b[C' : String(n));
  let next: ChatPrompt | null = prompt;
  for (let i = 0; i < SETTLE_TRIES && promptKey(next) === key; i += 1) {
    await sleep(SETTLE_MS);
    next = await currentPrompt(id);
  }
  // 선택 화면이 사라졌다 = 답이 끝났다 → 제출로 친다(이어진 작업이 끝나면 다시 알림이 나가게 — 번호 키만으로는
  // waiting 이 안 내려간다). 다음 질문·토글 결과·검토 화면이 떠 있으면 아직 답하는 중이라 치지 않는다
  if (!next) markAnswerSubmitted(id);
  return { ok: true, next };
}
