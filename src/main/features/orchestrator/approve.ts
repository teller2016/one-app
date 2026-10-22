// 무인 연쇄 가드 — 루트의 이번 턴이 사람이 아니라 워커 보고(세션 간 메시지)로 시작됐으면, 상태를 바꾸는 도구
// (send_to_session·run_preset·close_session)를 원앱 승인 창에 올린다(2026-10-22 사용자 결정: 상태 바꾸는 도구 전부).
//
// 판정은 루트 대화 기록의 **마지막 입력 줄의 origin.kind**(taskScan.lastInputKind) — 글자 패턴이 아니라 claude 가 남긴 출처다.
// 승인 창은 메인 창의 모달(렌더러 RootConfirmHost)이다. 요청이 오면 메인 창을 앞으로 가져온다.
// ⚠️ 승인을 기다리는 동안 MCP 호출이 열려 있다 — Claude Code 는 HTTP MCP 호출에 '첫 바이트 60초'를 건다(공식 문서 mcp.md).
//    SDK 가 SSE 헤더를 바로 보내고 15초마다 keepalive 를 쓰며, mcp.json 에 서버별 timeout 도 늘려 둔다(root.ts).
import { app } from 'electron';
import { broadcast } from '../../lib/broadcast';
import { completeLines, fileSize, findClaude, readRange } from '../terminal';
import { getNotifyWindow } from '../notify/notify';
import type { OrchestratorConfirmPicks } from '../../../shared/types';
import { createConfirmQueue, type ConfirmInput, type ConfirmOutcome } from './confirm';
import { getRootSessionId } from './store';
import { lastInputKind } from './taskScan';

/** 승인 창 응답 대기 — 자리를 비운 사이 쌓인 요청이 나중에 실행되지 않게 짧게(비서 브랜치와 같은 값) */
export const CONFIRM_TIMEOUT_MS = 3 * 60_000;

/** 마지막 입력을 찾는 꼬리 — 입력 뒤 도구 결과 몇 줄이 클 수 있다 */
const ROOT_TAIL_BYTES = 256 * 1024;

/** 메인 창을 앞으로 — 다른 앱 뒤에 있어도 승인 창이 보이게 (notify 알럿과 같은 방식) */
function bringMainWindowToFront(): void {
  const win = getNotifyWindow();
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  app.focus({ steal: true });
}

const queue = createConfirmQueue({
  timeoutMs: CONFIRM_TIMEOUT_MS,
  onChange: (pending) => broadcast('orchestrator:confirm:changed', pending),
  onRequest: () => bringMainWindowToFront(),
});

export const answerConfirm = (id: string, approved: boolean, picks?: OrchestratorConfirmPicks): boolean =>
  queue.answer(id, approved, picks);
export const listConfirms = () => queue.list();
export const clearConfirms = (): void => queue.clear();

/** 루트의 마지막 입력 출처 — 'human' · 'peer' · 그 밖. 대화 기록을 못 읽으면 null */
export async function rootInputKind(): Promise<string | null> {
  const rootId = getRootSessionId();
  const claude = rootId ? await findClaude(rootId) : null;
  if (!claude) return null;
  try {
    const size = fileSize(claude.file);
    const start = Math.max(0, size - ROOT_TAIL_BYTES);
    let text = readRange(claude.file, start, size);
    if (start > 0) text = text.slice(text.indexOf('\n') + 1); // 꼬리 첫 조각은 줄 중간이다
    return lastInputKind(completeLines(text).lines);
  } catch {
    return null;
  }
}

export const DECLINED: Record<'rejected' | 'timeout' | 'cancelled', string> = {
  rejected: '사용자가 승인하지 않았습니다 — 다시 시도하지 말고 사용자에게 어떻게 할지 물어보세요.',
  timeout: `${CONFIRM_TIMEOUT_MS / 60_000}분 안에 승인이 없어 취소했습니다 — 다시 시도하지 말고 사용자에게 알리세요.`,
  cancelled: '승인 요청이 취소됐습니다.',
};

/**
 * 상태를 바꾸는 도구의 관문 — 사람이 시킨 턴이면 바로 통과(null), 아니면 승인 창을 띄워 결정을 기다린다.
 * 통과하면 null, 막히면 루트에 돌려줄 이유 문장.
 * 대화 기록을 못 읽으면(첫 메시지 전·파일 이동) 사람 턴으로 본다 — 출처를 모르는 것을 이유로 매번 막지 않는다.
 */
export async function gateIfChained(input: ConfirmInput, signal?: AbortSignal): Promise<string | null> {
  const kind = await rootInputKind();
  if (kind === null || kind === 'human') return null;
  const decision = await queue.request(
    {
      ...input,
      note:
        input.note ??
        '워커의 보고를 받은 루트가 스스로 하려는 일입니다(사람이 시킨 턴이 아님). 내용을 확인하고 [실행]을 누르세요.',
    },
    signal,
  );
  return decision === 'approved' ? null : DECLINED[decision];
}

const CHAINED_NOTE = '워커의 보고를 받은 루트가 스스로 하려는 일입니다(사람이 시킨 턴이 아님).';

/**
 * 세션·워크트리 만들기 승인 — 무인 연쇄 여부와 관계없이 **늘** 묻는다(기획 결정: 생성만 승인).
 * 사람이 시킨 턴이 아니면 그 사실을 맨 위에 덧붙인다. 항목·선택지가 있으면 고른 값이 함께 온다.
 */
export async function askApproval(input: ConfirmInput, signal?: AbortSignal): Promise<ConfirmOutcome> {
  const kind = await rootInputKind();
  const chained = kind !== null && kind !== 'human';
  const note = [chained ? CHAINED_NOTE : null, input.note].filter(Boolean).join('\n') || undefined;
  return queue.ask({ ...input, note }, signal);
}
