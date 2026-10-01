// claude 의 **번호 선택 화면**(AskUserQuestion·검토 화면·권한 확인 등)을 터미널 화면 글자에서 읽는다 —
// 순수 함수(screenPrompt.test.ts). 화면 캡처는 chat.ts 가 한다.
//
// 왜 화면인가: Claude Code(2.1.286)는 AskUserQuestion 질문을 **답하기 전까지 대화 기록(jsonl)에 쓰지 않는다**
// (2026-10-01 실측 — 질문이 떠 있는 2분 동안 마지막 기록이 사람 입력이었다). 대기 중이라는 사실만
// sessions/<pid>.json 의 `status: 'waiting'` 으로 알 수 있다. 그래서 그 상태일 때만 화면 끝을 읽는다.
//
// 화면 모양(실측):
//    ☐ 계절                       ← 머리(여러 질문이면 탭 줄: ☐ ☒ ✔)
//                                  ← 빈 줄
//   좋아하는 계절은?               ← 질문
//                                  ← 빈 줄
//   ❯ 1. 여름                     ← 선택지(❯ = 현재 커서)
//        따뜻하고 …               ← 설명(들여쓴 줄)
//     2. 겨울
//     3. Type something.          ← 직접 입력 자리
//   ──────────
//     4. Chat about this
//   Enter to select · ↑/↓ to navigate · Esc to cancel   ← 안내 줄
// ⚠️ 여러 질문의 **검토 화면('Ready to submit your answers?')에는 안내 줄이 없다** — 화면이 `2. Cancel` 로 끝난다(실측).
//    그래서 안내 줄이 없으면 **화면 마지막 글자 줄이 선택지일 때만** 선택 화면으로 본다(호출 자체가 status 'waiting' 일 때뿐이다).
// ⚠️ 읽지 못하면 null — 호출부는 '터미널에서 답 필요' 카드로 물러난다(틀린 버튼보다 버튼 없음이 낫다).
import type { ChatPrompt } from '../../../shared/terminal-protocol';

const HINT_RE = /Enter to (select|confirm)/;
const OPTION_RE = /^\s*(?:❯\s*)?(\d{1,2})\.\s+(.+?)\s*$/;
const SEPARATOR_RE = /^\s*[─━-]{3,}\s*$/;
/** 여러 질문의 탭 줄(☐ 미답 · ☒ 답함 · ✔ Submit) — 질문 위의 머리 */
const TAB_RE = /[☐☒✔]/;
const FREE_TEXT_RE = /^Type something/i;

export function parseScreenPrompt(screen: string): ChatPrompt | null {
  const lines = screen.split('\n').map((l) => l.replace(/\s+$/, ''));
  let end = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (HINT_RE.test(lines[i])) {
      end = i;
      break;
    }
  }
  if (end < 0) {
    // 안내 줄 없는 선택 화면(검토) — 마지막 글자 줄이 선택지여야 한다
    let last = lines.length - 1;
    while (last >= 0 && !lines[last].trim()) last -= 1;
    if (last < 0 || !OPTION_RE.test(lines[last])) return null;
    end = last + 1;
  }

  // 안내 줄 위로 올라가며 '1.' 선택지를 찾는다 — 선택 화면은 화면 맨 아래에 붙어 있다
  let start = -1;
  for (let i = end - 1; i >= 0 && end - i <= 60; i -= 1) {
    const m = lines[i].match(OPTION_RE);
    if (m && m[1] === '1') {
      start = i;
      break;
    }
  }
  if (start < 0) return null;

  const options: ChatPrompt['options'] = [];
  for (let i = start; i < end; i += 1) {
    const line = lines[i];
    if (!line.trim() || SEPARATOR_RE.test(line)) continue;
    const m = line.match(OPTION_RE);
    if (m && Number(m[1]) === options.length + 1) {
      options.push({ n: Number(m[1]), label: m[2], ...(/^\s*❯/.test(line) ? { current: true } : {}) });
    } else if (options.length) {
      // 선택지 아래 들여쓴 줄 = 설명(폭이 좁으면 여러 줄로 감긴다)
      const last = options[options.length - 1];
      last.description = last.description ? `${last.description} ${line.trim()}` : line.trim();
    }
  }
  if (!options.length) return null;

  // 질문 — 선택지 위로 올라간다. ⚠️ 실제 화면은 머리·질문·선택지 사이에 **빈 줄**이 있다(실측) —
  // 선택지 바로 위 빈 줄은 건너뛰고, 질문 줄을 모은 뒤 다시 빈 줄을 건너 탭 줄이 있으면 머리로 쓴다
  const q: string[] = [];
  let header: string | undefined;
  let i = start - 1;
  const skipBlank = () => {
    while (i >= 0 && start - i <= 10 && !lines[i].trim()) i -= 1;
  };
  skipBlank();
  for (; i >= 0 && start - i <= 10; i -= 1) {
    const line = lines[i];
    if (!line.trim() || SEPARATOR_RE.test(line) || TAB_RE.test(line)) break;
    q.unshift(line.trim());
  }
  skipBlank();
  if (i >= 0 && TAB_RE.test(lines[i])) {
    header = lines[i].replace(/[☐☒✔←→]/g, ' ').replace(/\s+/g, ' ').trim() || undefined;
  }
  const freeText = options.find((o) => FREE_TEXT_RE.test(o.label))?.n;
  return {
    question: q.join(' '),
    ...(header ? { header } : {}),
    options,
    ...(freeText ? { freeText } : {}),
  };
}

// ── 작업 중 상태 줄 ──
// claude 가 일하는 동안 입력창 위에 도는 한 줄(2026-10-01 실측):
//   `✶ Garnishing… (7s · ↓ 527 tokens)` · `· Precipitating… (7s · ↓ 252 tokens · thinking)`
// 기호(스피너 글자)는 매 프레임 바뀌고 동사도 매번 다르다 — '…'(말줄임) + 괄호 꼬리로 알아본다.
// 채팅 보기의 '작업 중…' 자리에 그대로 보여 준다. 못 읽으면 null(그 자리는 '작업 중…' 으로 둔다).
const STATUS_RE = /^\s*\S\s+([^\s()][^()]*…)\s*(?:\(([^)]*)\))?\s*$/;

export function parseScreenStatus(screen: string): string | null {
  const lines = screen.split('\n');
  for (let i = lines.length - 1; i >= 0 && lines.length - i <= 30; i -= 1) {
    // 입력창 줄(❯ …)은 사용자가 친 글이다 — '…' 로 끝나도 상태가 아니다(입력창이 상태 줄보다 아래라 먼저 걸린다)
    if (/^\s*[❯>]/.test(lines[i])) continue;
    const m = lines[i].match(STATUS_RE);
    if (!m) continue;
    return m[2] ? `${m[1]} · ${m[2]}` : m[1];
  }
  return null;
}
