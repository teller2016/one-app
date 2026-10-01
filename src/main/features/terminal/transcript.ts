// claude 대화 기록(jsonl) → 채팅 항목 — **순수 함수만** 둔다(파일·타이머 없음, transcript.test.ts).
//
// 기록 위치·구독은 chat.ts 가 맡는다. 여기는 jsonl 한 줄 한 줄을 MO 채팅 말풍선으로 바꾼다.
// ⚠️ jsonl 은 Claude Code 내부 형식이다 — 버전이 바뀌면 필드가 달라질 수 있으므로 **모르는 줄·블록은
//    조용히 건너뛴다**(throw 금지 — 한 줄이 깨졌다고 대화 전체가 안 보이면 안 된다).
//
// 실측(Claude Code 2.1.x):
// - 줄 type: user · assistant · attachment · system · permission-mode · file-history-snapshot … — user·assistant 만 쓴다
// - assistant 는 **블록 하나당 한 줄**로 스트리밍된다(같은 message.id 에 text·tool_use·thinking 이 줄을 나눠 온다)
// - user 의 content 가 문자열이면 사람이 친 입력, 배열이면 tool_result(도구 결과)·이미지가 섞인다
// - isSidechain = 서브에이전트 내부 대화 · isMeta = 명령 안내문 같은 주입물 — 둘 다 숨긴다
import path from 'node:path';
import type { ChatItem, ChatQuestion, ChatToolResult } from '../../../shared/terminal-protocol';

/** 펼친 상세·결과 상한 — 폰으로 보내는 양을 묶는다(빌드 로그 한 덩어리가 수 MB 일 수 있다) */
export const DETAIL_MAX = 3000;
export const RESULT_MAX = 3000;

type Block = {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
};

type Line = {
  type?: string;
  uuid?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  isCompactSummary?: boolean;
  message?: { content?: unknown };
};

export type ParsedChat = { items: ChatItem[]; results: ChatToolResult[] };

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max)}\n… (${s.length - max}자 생략)` : s);

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** 경로를 세션 위치 기준 상대 경로로 — 폰 한 줄에 절대 경로는 안 들어간다 */
const rel = (p: string, cwd: string) => {
  if (!p) return '';
  if (cwd && p.startsWith(cwd + path.sep)) return p.slice(cwd.length + 1);
  return p;
};

const firstLine = (s: string) => s.split('\n').find((l) => l.trim())?.trim() ?? '';

/** 도구 결과 content — 문자열이거나 `[{type:'text', text}]` 배열 */
function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((c: Block) => (c?.type === 'text' ? str(c.text) : c?.type === 'image' ? '[이미지]' : ''))
    .filter(Boolean)
    .join('\n');
}

/** 도구 호출 한 줄 요약 + 펼친 상세 — 도구마다 사람이 알아볼 핵심 필드가 다르다 */
export function describeTool(
  name: string,
  input: Record<string, unknown>,
  cwd: string,
): { summary: string; detail?: string } {
  const fp = rel(str(input.file_path) || str(input.notebook_path), cwd);
  switch (name) {
    case 'Bash':
      return { summary: firstLine(str(input.description) || str(input.command)), detail: str(input.command) };
    case 'Read':
      return { summary: fp };
    case 'Write':
      return { summary: fp, detail: str(input.content) };
    case 'Edit': {
      const minus = str(input.old_string).split('\n').map((l) => `- ${l}`).join('\n');
      const plus = str(input.new_string).split('\n').map((l) => `+ ${l}`).join('\n');
      return { summary: fp, detail: `${minus}\n${plus}` };
    }
    case 'Grep':
    case 'Glob': {
      const where = rel(str(input.path), cwd);
      return { summary: `${str(input.pattern)}${where ? ` · ${where}` : ''}` };
    }
    case 'WebFetch':
      return { summary: str(input.url), detail: str(input.prompt) };
    case 'WebSearch':
      return { summary: str(input.query) };
    case 'Agent':
    case 'Task':
      return { summary: str(input.description), detail: str(input.prompt) };
    case 'Skill':
      return { summary: `/${str(input.skill)}${input.args ? ` ${str(input.args)}` : ''}` };
    case 'TodoWrite': {
      const todos = Array.isArray(input.todos) ? (input.todos as { content?: string; status?: string }[]) : [];
      const mark = (st?: string) => (st === 'completed' ? '[x]' : st === 'in_progress' ? '[~]' : '[ ]');
      return {
        summary: `할 일 ${todos.length}개`,
        detail: todos.map((t) => `${mark(t.status)} ${str(t.content)}`).join('\n'),
      };
    }
    default: {
      // 모르는 도구(MCP 등) — 첫 문자열 값을 요약으로, 입력 전문을 상세로
      const firstStr = Object.values(input).find((v) => typeof v === 'string') as string | undefined;
      let detail = '';
      try {
        detail = JSON.stringify(input, null, 2);
      } catch {
        // 순환 참조 등 — 상세만 포기
      }
      return { summary: firstLine(firstStr ?? ''), detail };
    }
  }
}

function parseQuestions(input: Record<string, unknown>): ChatQuestion[] {
  const qs = Array.isArray(input.questions) ? (input.questions as Record<string, unknown>[]) : [];
  return qs.map((q) => ({
    question: str(q.question),
    header: str(q.header) || undefined,
    multiSelect: q.multiSelect === true,
    options: (Array.isArray(q.options) ? (q.options as Record<string, unknown>[]) : []).map((o) => ({
      label: str(o.label),
      description: str(o.description) || undefined,
    })),
  }));
}

/**
 * 사람이 친 문자열 입력 — 슬래시 명령은 `<command-name>` 태그로 기록된다.
 * 명령 출력(`<local-command-stdout>`)·안내문(`<local-command-caveat>`)은 숨긴다.
 */
function userTextItem(text: string, key: string, images: number): ChatItem | null {
  const t = text.trim();
  if (!t && !images) return null;
  if (t.startsWith('<local-command-') || t.startsWith('<bash-stdout') || t.startsWith('<bash-stderr')) return null;
  const cmd = t.match(/<command-name>([^<]*)<\/command-name>/);
  if (cmd) {
    const args = t.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1]?.trim();
    const name = cmd[1].trim();
    return { kind: 'command', key, text: `${name.startsWith('/') ? '' : '/'}${name}${args ? ` ${args}` : ''}` };
  }
  // [중단] 표식 — claude 가 사람 입력(type:user) 자리에 남긴다. 말풍선이 아니라 흐름 표식으로
  // ("[Request interrupted by user]" · "… for tool use]" — 2026-10-01 /test 실측, isMeta 없음)
  if (/^\[Request interrupted by user/.test(t)) return { kind: 'notice', key, text: '중단됨' };
  // `!` 셸 명령 입력
  const bash = t.match(/^<bash-input>([\s\S]*?)<\/bash-input>$/);
  if (bash) return { kind: 'command', key, text: `! ${bash[1].trim()}` };
  return { kind: 'user', key, text: t, ...(images ? { images } : {}) };
}

/**
 * jsonl 줄들 → 채팅 항목 + 도구 결과. 깨진 줄(쓰는 중인 마지막 줄 등)은 건너뛴다.
 * @param cwd 세션 위치 — 도구 요약의 경로를 상대 경로로 줄인다
 */
export function parseTranscript(lines: string[], cwd: string): ParsedChat {
  const items: ChatItem[] = [];
  const results: ChatToolResult[] = [];
  for (const raw of lines) {
    if (!raw.trim()) continue;
    let o: Line;
    try {
      o = JSON.parse(raw) as Line;
    } catch {
      continue;
    }
    if ((o.type !== 'user' && o.type !== 'assistant') || o.isSidechain || o.isMeta || o.isCompactSummary) continue;
    const uuid = o.uuid ?? `${items.length}`;
    const content = o.message?.content;
    if (o.type === 'user') {
      if (typeof content === 'string') {
        const it = userTextItem(content, uuid, 0);
        if (it) items.push(it);
        continue;
      }
      if (!Array.isArray(content)) continue;
      const texts: string[] = [];
      let images = 0;
      for (const b of content as Block[]) {
        if (b?.type === 'tool_result' && b.tool_use_id) {
          results.push({
            toolId: b.tool_use_id,
            text: clip(resultText(b.content), RESULT_MAX),
            ...(b.is_error ? { isError: true } : {}),
          });
        } else if (b?.type === 'text') texts.push(str(b.text));
        else if (b?.type === 'image') images += 1;
      }
      if (texts.length || images) {
        const it = userTextItem(texts.join('\n'), uuid, images);
        if (it) items.push(it);
      }
      continue;
    }
    // assistant — 블록 하나당 한 줄이지만 여러 블록이 한 줄에 올 수도 있어 전부 돈다
    if (!Array.isArray(content)) continue;
    (content as Block[]).forEach((b, i) => {
      const key = `${uuid}:${i}`;
      if (b?.type === 'text') {
        const text = str(b.text).trim();
        if (text) items.push({ kind: 'assistant', key, text });
      } else if (b?.type === 'tool_use' && b.id) {
        const input = b.input && typeof b.input === 'object' ? b.input : {};
        const name = str(b.name);
        if (name === 'AskUserQuestion') {
          items.push({ kind: 'ask', key, toolId: b.id, questions: parseQuestions(input) });
          return;
        }
        const { summary, detail } = describeTool(name, input, cwd);
        items.push({
          kind: 'tool',
          key,
          toolId: b.id,
          name,
          summary,
          ...(detail ? { detail: clip(detail, DETAIL_MAX) } : {}),
        });
      }
      // thinking·redacted_thinking 등은 숨긴다
    });
  }
  return { items, results };
}
