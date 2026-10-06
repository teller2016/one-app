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
//    ⚠️ 2.1.290 부터는 그 아래에 입력 상자 위 경계(이름표가 박힌 `──── 세션이름 ─`)가 한 줄 더 그려진다 — 경계 줄은 건너뛴다.
// 2.1.290 의 다른 선택 화면(2026-10-06 실측) — 안내 줄이 `Enter to …` 가 아니다:
//   권한 확인  ` Do you want to create hello.txt?` / ` ❯ 1. Yes` … / ` Esc to cancel · Tab to amend`
//              (위에 명령·파일 내용 미리보기가 `╌` 점선 사이에 있다 — 점선에서 질문 모으기를 멈춘다)
//   플랜 승인  `   Claude has written up a plan … Would you like to proceed?` / `   ❯ 1. Yes, …` … /
//              `     3. Tell Claude what to change`(커서를 두고 글을 치는 자리 = 직접 답) / `   ctrl+g to edit in Vim · <계획 파일>`
// ⚠️ 읽지 못하면 null — 호출부는 '터미널에서 답 필요' 카드로 물러난다(틀린 버튼보다 버튼 없음이 낫다).
// 다중 선택(AskUserQuestion multiSelect — 2026-10-06 실측):
//   ←  ☒ 과일  ✔ Submit  →          ← 탭 줄(마지막 '✔ Submit' 탭은 검토 화면)
//   ❯ 1. [✔] 사과                   ← 번호 키 = 체크 토글(고르기가 아니다)
//     4. [ ] Type something
//        Submit                      ← 제출 줄(번호 없음) — 이 줄이 있으면 다중 선택. → 키로 Submit 탭(검토 화면)에 간다
//   검토 화면: `Review your answers` / ` ● 질문` / `   → 사과, 체리` / `Ready to submit your answers?` / `1. Submit answers` `2. Cancel`
// 데스크톱 입력 대기 알림(2026-10-06 — 알림에서 바로 답하기)도 같은 결과를 쓴다: 권한 확인이면 **무엇을 허용하는지**
// (질문 위 미리보기 — 위 경계 `─` 줄 아래부터)를 `preview` 로 함께 준다 — 그게 없으면 뭘 허용하는지 모르고 누르게 된다.
import type { ChatPrompt } from '../../../shared/terminal-protocol';

const HINT_RE = /Enter to (select|confirm)|Esc to cancel|ctrl\+g to edit/;
const OPTION_RE = /^\s*(?:❯\s*)?(\d{1,2})\.\s+(.+?)\s*$/;
const SEPARATOR_RE = /^\s*[─━╌-]{3,}\s*$/;
/** claude 가 그리는 경계 — 입력 상자 위 경계엔 이름표가 박힐 수 있다(`──── 세션이름 ─`) */
const BORDER_RE = /^\s*─{3,}.*─$/;
/** 여러 질문의 탭 줄(☐ 미답 · ☒ 답함 · ✔ Submit) — 질문 위의 머리 */
const TAB_RE = /[☐☒✔]/;
/** 직접 답하는 자리 — 질문의 'Type something.' · 플랜 승인의 'Tell Claude what to change' */
const FREE_TEXT_RE = /^(Type something|Tell Claude what to change)/i;
/** 다중 선택 체크박스 — `[✔] 사과` · `[ ] 바나나` */
const CHECK_RE = /^\[([ ✔✓xX])\]\s+(.*)$/;
/** 다중 선택의 제출 줄 — 선택지 아래 번호 없이 `Submit` 한 낱말 */
const SUBMIT_ROW_RE = /^\s*Submit\s*$/;
/** 검토 화면 — 고른 답 요약이 그 위에 있다 */
const REVIEW_Q_RE = /^Ready to submit your answers\?/;
const REVIEW_HEAD_RE = /^\s*Review your answers\s*$/;
/** 권한 확인 미리보기의 위 경계(상자 맨 위 `─` 줄)와 그 안의 구분 점선(`╌`) */
const BOX_TOP_RE = /^\s*─{3,}/;
const DASHED_RE = /^\s*╌{3,}\s*$/;
/** 미리보기 상한 — 파일 내용이 길게 따라올 수 있다(앞부분이 도구·대상이다) */
const PREVIEW_LINES = 6;

export function parseScreenPrompt(screen: string): ChatPrompt | null {
  const lines = screen.split('\n').map((l) => l.replace(/\s+$/, ''));
  let end = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (HINT_RE.test(lines[i])) {
      end = i;
      break;
    }
  }
  const hint = end >= 0 ? lines[end] : '';
  const kind = /Tab to amend/.test(hint) ? 'permission' : /ctrl\+g to edit/.test(hint) ? 'plan' : undefined;
  if (end < 0) {
    // 안내 줄 없는 선택 화면(검토) — 마지막 글자 줄이 선택지여야 한다(아래에 붙은 경계 줄은 건너뛴다)
    let last = lines.length - 1;
    while (last >= 0 && (!lines[last].trim() || BORDER_RE.test(lines[last]))) last -= 1;
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

  // 화면 폭 — 경계 줄이 끝까지 그려진다. 폭 끝까지 찬 줄은 claude 가 **글자 단위로 접은** 줄이다(경로·명령이 둘로 갈린다)
  const width = Math.max(...lines.map((l) => l.length));
  const wrapped = (line: string) => line.length >= width - 2;
  const options: ChatPrompt['options'] = [];
  let prevWrapped = false;
  let submitRow = false;
  for (let i = start; i < end; i += 1) {
    const line = lines[i];
    if (!line.trim() || SEPARATOR_RE.test(line)) {
      prevWrapped = false;
      continue;
    }
    const m = line.match(OPTION_RE);
    if (m && Number(m[1]) === options.length + 1) {
      const check = m[2].match(CHECK_RE);
      options.push({
        n: Number(m[1]),
        label: check ? check[2] : m[2],
        ...(check ? { checked: check[1] !== ' ' } : {}),
        ...(/^\s*❯/.test(line) ? { current: true } : {}),
      });
    } else if (options.length && SUBMIT_ROW_RE.test(line)) {
      // 다중 선택의 제출 줄 — 앞 선택지의 설명이 아니다
      submitRow = true;
    } else if (options.length && prevWrapped && !options[options.length - 1].description) {
      // 앞 선택지 줄이 폭 끝에서 잘렸다 — 이 줄은 설명이 아니라 라벨의 나머지(2026-10-06 실측: 권한 '항상 허용' 경로)
      options[options.length - 1].label += line.trim();
    } else if (options.length) {
      // 선택지 아래 들여쓴 줄 = 설명(폭이 좁으면 여러 줄로 감긴다)
      const last = options[options.length - 1];
      last.description = last.description ? `${last.description} ${line.trim()}` : line.trim();
    }
    prevWrapped = wrapped(line);
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
  const preview = kind === 'permission' ? permissionPreview(lines, i, wrapped) : undefined;
  skipBlank();
  if (i >= 0 && TAB_RE.test(lines[i])) {
    // 마지막 '✔ Submit' 탭(검토 화면 자리)은 질문 이름이 아니다
    header =
      lines[i]
        .replace(/✔\s*Submit\s*(?=→|$)/, ' ')
        .replace(/[☐☒✔←→]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() || undefined;
  }
  const freeText = options.find((o) => FREE_TEXT_RE.test(o.label))?.n;
  const question = q.join(' ');
  const multiSelect = submitRow || options.some((o) => o.checked !== undefined);
  // 검토 화면이면 고른 답 요약을 미리보기로 — 무엇을 제출하는지 보고 누르게
  const reviewed = REVIEW_Q_RE.test(question) ? reviewSummary(lines, start) : undefined;
  return {
    question,
    ...(header ? { header } : {}),
    options,
    ...(freeText ? { freeText } : {}),
    ...(kind ? { kind } : {}),
    ...(preview || reviewed ? { preview: preview ?? reviewed } : {}),
    ...(multiSelect ? { multiSelect: true as const } : {}),
  };
}

/** 검토 화면의 고른 답 요약 — `Review your answers` 아래부터 질문 위까지, `●`(질문 머리)를 걷어 `질문` / `→ 답` 줄로 */
function reviewSummary(lines: string[], start: number): string | undefined {
  let head = -1;
  for (let k = start - 1; k >= 0 && start - k <= 30; k -= 1) {
    if (REVIEW_HEAD_RE.test(lines[k])) {
      head = k;
      break;
    }
  }
  if (head < 0) return undefined;
  const out: string[] = [];
  for (let k = head + 1; k < start; k += 1) {
    const t = lines[k].trim().replace(/^●\s*/, '');
    if (!t || REVIEW_Q_RE.test(t)) continue;
    out.push(t);
  }
  return out.length ? out.slice(0, PREVIEW_LINES).join('\n') : undefined;
}

/**
 * 권한 확인 질문 위 미리보기 — 무엇을 허용하는지. 실측 모양(2.1.291, 2026-10-06):
 *   ────────────── (상자 위 경계)
 *    Bash command                         ← 제목(도구)
 *    Tip: auto mode handles these …       ← 안내(접혀 두 줄) — 버린다
 *    below
 *    권한 알림 테스트용 빈 파일 생성        ← 설명 · 파일 권한이면 파일 이름
 *   ╌╌╌╌╌╌╌╌╌╌╌╌╌╌
 *    │ touch /private/tmp/…-a14b-4ab       ← 내용(명령·파일 앞부분) — `│` 를 걷고, 폭 끝에서 접힌 줄은 잇는다
 *    │ b-88c4-…/perm-test.txt
 *   ╌╌╌╌╌╌╌╌╌╌╌╌╌╌
 *    Do you want to proceed?
 * → 제목 · 점선 위 **마지막 줄**(설명·파일 이름 — 안내 문구는 그 위에 온다) · 점선 안 내용. 점선이 없으면 안내만 걸러 그대로.
 */
function permissionPreview(
  lines: string[],
  from: number,
  wrapped: (line: string) => boolean,
): string | undefined {
  let top = -1;
  for (let k = from; k >= 0 && from - k <= 30; k -= 1) {
    if (BOX_TOP_RE.test(lines[k])) {
      top = k;
      break;
    }
  }
  const block = lines.slice(top + 1, from + 1);
  const firstDash = block.findIndex((l) => DASHED_RE.test(l));
  const text = (l: string) => l.trim().replace(/^│\s?/, '');
  const filled = (ls: string[]) => ls.filter((l) => l.trim() && !DASHED_RE.test(l));
  const out: string[] = [];
  if (firstDash < 0) {
    out.push(...filled(block).map(text).filter((t) => !/^Tip:/.test(t)));
  } else {
    const head = filled(block.slice(0, firstDash));
    if (head.length) out.push(text(head[0]));
    if (head.length > 1) out.push(text(head[head.length - 1]));
    let join = false;
    for (const l of block.slice(firstDash + 1)) {
      if (DASHED_RE.test(l)) break;
      if (!l.trim()) {
        join = false;
        continue;
      }
      if (join) out[out.length - 1] += text(l);
      else out.push(text(l));
      join = wrapped(l);
    }
  }
  return out.length ? out.slice(0, PREVIEW_LINES).join('\n') : undefined;
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
