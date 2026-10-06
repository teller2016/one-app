// 세션 현황(⌘⇧P 빠른 전환)용 대화 기록 요약 — **순수 함수만** 둔다(파일·프로세스는 overview.ts, 테스트는 sessionDigest.test.ts).
//
// 실측(Claude Code 2.1.290~291, 2026-10-06 — 로컬 기록 3534줄):
// - `{"type":"ai-title","aiTitle":"fix-order-filter-network-error",…}` — claude 가 붙인 작업 제목. 턴마다 다시 쓰이며
//   바뀔 수 있어 **마지막 것**이 정답이다. ⚠️ `--agent` 세션 등 아예 없는 기록도 많다(살아 있는 6개 중 3개) → 첫 요청으로 대신한다.
// - `{"type":"last-prompt","lastPrompt":"…",…}` — 사용자가 마지막으로 보낸 글(원문 — `[Image #N]` 자리 표시 포함).
// - 제목 계열 줄은 ai-title 하나뿐이다(`custom-title`·`summary` 0건).
// - ⚠️ last-prompt 엔 **사람이 아닌 입력도** 남는다 — 다른 claude 세션이 보낸 메시지(`Another Claude session sent a message:
//   <teammate-message …>`)가 사람 요청을 덮었다(실측). 그런 줄은 건너뛰어 직전 사람 요청을 남긴다(`isPeerMessage`).
// - 붙여넣은 글은 `<pasted_content id=…>…</pasted_content>` 로 감싸여 있다 — 걷어내고 사람이 직접 친 글을 쓴다.
// - 슬래시 명령으로 시작한 세션(`/플러그인:dev SSB-9 — [식단 주문] 배송일별 …`)엔 ai-title 이 안 생겼다 — 그 인자가 곧 작업 설명이다.
// ⚠️ Claude Code 내부 형식이다 — 모르는 줄·깨진 줄은 조용히 건너뛴다(transcript.ts 와 같은 방침).
import { parseTranscript } from './transcript';

/** 표시 상한 — 한 줄 요약이라 길게 보낼 이유가 없다 */
const TEXT_MAX = 200;
/** 마지막 답변 상한 — 알림 카드에서 두 줄까지 보인다 */
const REPLY_MAX = 300;

export type TranscriptDigest = {
  aiTitle?: string;
  lastPrompt?: string;
};

/** 다른 claude 세션·백그라운드 작업이 사람 입력 자리에 넣은 글인가 */
const PEER_RE = /^(Another Claude session sent a message:|<(teammate-message|task-notification)\b)/;
export const isPeerMessage = (text: string) => PEER_RE.test(text.trim());

// ⚠️ 닫는 태그에도 id 가 붙는다(`</pasted_content id="ad9c">` — 실측)
const PASTED_RE = /<pasted_content\b[^>]*>([\s\S]*?)<\/pasted_content\b[^>]*>/g;

/** 사람 요청 → 한 줄 — 붙여넣은 덩어리는 빼고 직접 친 글을, 붙여넣기뿐이면 그 내용을 */
export function promptLine(text: string): string | undefined {
  return oneLine(text.replace(PASTED_RE, ' ')) ?? oneLine(text.replace(PASTED_RE, '$1'));
}

/** 여러 줄 글 → 한 줄(공백 접기·이미지 자리 표시 제거·길이 상한) — 빈 글이면 undefined */
export function oneLine(text: string, max = TEXT_MAX): string | undefined {
  const t = text
    .replace(/\[Image #\d+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return undefined;
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/**
 * jsonl 줄들을 훑어 제목·마지막 요청을 갱신한다 — 증분 읽기라 **뒤에 온 것이 이긴다**.
 * 모든 줄을 JSON 으로 풀지 않는다(도구 결과 한 줄이 수백 KB) — 유형 문자열이 든 줄만.
 */
export function digestLines(lines: string[], into: TranscriptDigest): TranscriptDigest {
  for (const raw of lines) {
    const isTitle = raw.includes('"ai-title"');
    if (!isTitle && !raw.includes('"last-prompt"')) continue;
    let o: { type?: unknown; aiTitle?: unknown; lastPrompt?: unknown };
    try {
      o = JSON.parse(raw) as typeof o;
    } catch {
      continue;
    }
    if (o.type === 'ai-title' && typeof o.aiTitle === 'string') {
      const t = oneLine(o.aiTitle);
      if (t) into.aiTitle = t;
    } else if (o.type === 'last-prompt' && typeof o.lastPrompt === 'string' && !isPeerMessage(o.lastPrompt)) {
      const t = promptLine(o.lastPrompt);
      if (t) into.lastPrompt = t;
    }
  }
  return into;
}

/**
 * 대화 첫머리 줄들 → 첫 요청 — 제목이 없을 때 '무슨 작업인가'를 대신 말한다.
 * 사람이 친 글, 또는 **글로 된 인자가 있는 슬래시 명령**의 인자(`/dev SSB-9 — 주문 필터 오류` → `SSB-9 — 주문 필터 오류`).
 * `/model opus`·`/add-dir /경로` 처럼 인자가 한 낱말인 설정 명령은 건너뛴다. 주입물·셸 명령은 채팅 파서(`parseTranscript`)의 판정을 따른다.
 */
export function firstPromptOf(lines: string[]): string | undefined {
  for (const it of parseTranscript(lines, '').items) {
    if (it.kind === 'user' && !isPeerMessage(it.text)) {
      const t = promptLine(it.text);
      if (t) return t;
    } else if (it.kind === 'command') {
      const args = it.text.match(/^\/\S+\s+([\s\S]+)$/)?.[1]?.trim();
      if (args && /\s/.test(args)) return promptLine(args);
    }
  }
  return undefined;
}

/**
 * 대화 끝머리 줄들 → claude 의 마지막 답변 한 줄 — 입력 대기 알림 카드의 '무엇이 끝났나'.
 * 마크다운 표식(굵게·코드·제목 #·목록 기호)은 걷어 평문으로 접는다(알림에서 두 줄까지 보인다).
 */
export function lastReplyOf(lines: string[]): string | undefined {
  const items = parseTranscript(lines, '').items;
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const it = items[i];
    if (it.kind !== 'assistant') continue;
    const plain = it.text
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/^\s{0,3}(#{1,6}|[-*+]|\d+\.|>)\s+/gm, '')
      .replace(/\*\*|__|`/g, '');
    const t = oneLine(plain, REPLY_MAX);
    if (t) return t;
  }
  return undefined;
}
