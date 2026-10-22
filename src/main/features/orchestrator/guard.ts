// 루트 세션의 지시 입력 가드 — 순수 판정(guard.test.ts). 화면·입력 기록을 읽어 오는 쪽은 tools.ts.
//
// 지시는 폰 채팅 입력과 같은 길(붙여넣기 + Enter, terminal/chat.ts sendChatText)로 워커 터미널에 들어간다.
// - 작업 중이어도 넣는다 — claude 가 입력을 대기열에 두었다가 턴이 끝나면 실행한다(슬래시 명령도, 2026-10-22 실측).
// - 사용자가 그 탭에 쓰는 중이어도 막지 않는다(사용자 결정 10-22) — 쓰던 글이 있으면 claude 의 **입력 보관(Ctrl+S)**
//   으로 치운 뒤 넣는다. claude 가 다음 제출 뒤 그 글을 입력란에 되돌려 놓는다(쉬는 중·작업 중 모두, 10-22 실측).
//   안 치우면 쓰던 글 뒤에 지시가 붙어 둘이 한꺼번에 제출된다.
// - 질문·권한·플랜 창이 떠 있거나 입력 상자를 못 찾으면(신뢰 확인 창 등) 넣지 않는다 — Enter 가 선택지를 고른다.
import { issueKeysIn, leadingIssueKey } from '../../../shared/jira-url';
import type { ChatPrompt } from '../../../shared/terminal-protocol';

/** 지시 길이 상한 — 길면 claude 가 `[Pasted text]` 로 접을 뿐이지만, 실수로 거대한 글을 붓지 않게 */
export const MAX_INSTRUCTION_CHARS = 8_000;
/** claude 의 입력 보관 키(Ctrl+S) — 입력란의 글을 치웠다가 다음 제출 뒤 되돌린다 */
export const STASH_KEY = '\x13';

export type SendCheckInput = {
  isRoot: boolean;
  isDockShell: boolean;
  hasClaude: boolean;
  /** 지금 떠 있는 질문·권한·플랜 창 (screenPrompt.ts) — 없으면 null */
  prompt: ChatPrompt | null;
  /** 입력 상자의 진한 글자(흐린 제안 문구 제외) — 입력 상자를 못 찾으면 null */
  inputText: string | null;
};

/**
 * stashDraft = 입력란에 사용자가 쓰던 글이 있어 먼저 보관(Ctrl+S)해야 한다.
 * ⚠️ 입력란이 비었을 때는 누르지 않는다 — 이미 보관된 글이 있으면 그 글을 되살릴 수 있다.
 */
export type SendCheck = { ok: true; stashDraft: boolean } | { ok: false; reason: string };

const no = (reason: string): SendCheck => ({ ok: false, reason });
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

function promptReason(p: ChatPrompt): string {
  if (p.kind === 'permission') return '권한 확인 창이 떠 있어 넣지 않았습니다 — 사용자가 직접 답해야 합니다.';
  if (p.kind === 'plan') return '플랜 승인 창이 떠 있어 넣지 않았습니다 — 사용자가 직접 답해야 합니다.';
  return `질문이 떠 있어 넣지 않았습니다("${clip(p.question, 60)}") — 사용자가 직접 답해야 합니다.`;
}

/** 지금 이 세션에 지시를 넣어도 되는가 — 위에서부터 처음 걸리는 이유 하나를 돌려준다 */
export function checkSend(i: SendCheckInput): SendCheck {
  if (i.isRoot) return no('루트 세션 자신에게는 보낼 수 없습니다.');
  if (i.isDockShell) return no('독 패널의 개인 셸에는 보내지 않습니다.');
  if (!i.hasClaude) return no('이 세션에는 claude 가 떠 있지 않습니다.');
  if (i.prompt) return no(promptReason(i.prompt));
  if (i.inputText === null) {
    return no('입력 상자를 찾지 못해 넣지 않았습니다 — claude 가 아직 뜨는 중이거나 확인 창이 떠 있습니다.');
  }
  return { ok: true, stashDraft: i.inputText !== '' };
}

/**
 * 지시 글 정리 — 제어 문자를 걷는다(줄바꿈·탭만 남긴다).
 * ⚠️ 붙여넣기 끝 표시(`ESC[201~`)가 글 안에 있으면 그 뒤가 **키 입력으로** 들어간다 — ESC 를 반드시 뺀다.
 */
export function sanitizeInstruction(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '');
}

// ── 입력 상자 읽기 (capture-pane -e) ──
//
// 2026-10-22 실측(Claude Code 2.1.307):
//   제안 문구  '\x1b[39m❯\xa0\x1b[2mTry "fix lint errors"\x1b[0m'   ← 흐린 글자(SGR 2)
//   직접 친 글 '\x1b[39m❯\xa0hello typed'
//   빈 칸     '\x1b[39m❯'
//   지난 입력  '\x1b[48;5;237m❯ \x1b[38;5;231m…'                   ← 대화 기록 쪽(배경색) — 입력 상자 아님
// 입력 상자는 화면 아래쪽의 **전체 폭 `─` 경계 바로 다음 줄**이 `❯`(셸 모드는 `!`)로 시작하는 곳이다
// (renderer `claudeLiveRegion.ts` 와 같은 모양 규칙). 경계에는 세션 이름표가 박힐 수 있다(`──── root ─`).

// eslint-disable-next-line no-control-regex
const CSI_RE = /\x1b\[([0-9;?]*)([A-Za-z])/g;

/** SGR 을 걷은 글자 — 흐린 글자(SGR 2)는 `keepDim` 이 아니면 뺀다 */
export function solidText(line: string, keepDim = false): string {
  let out = '';
  let dim = false;
  let last = 0;
  for (const m of line.matchAll(CSI_RE)) {
    const chunk = line.slice(last, m.index);
    if (keepDim || !dim) out += chunk;
    last = (m.index ?? 0) + m[0].length;
    if (m[2] !== 'm') continue; // SGR 이 아닌 제어열은 버린다
    const ps = m[1] === '' ? [0] : m[1].split(';').map(Number);
    for (let k = 0; k < ps.length; k += 1) {
      const p = ps[k];
      if (p === 0 || p === 22) dim = false;
      else if (p === 2) dim = true;
      // 색 지정의 인자는 건너뛴다 — `38;2;r;g;b` 의 2 를 흐림으로 읽지 않게
      else if (p === 38 || p === 48 || p === 58) k += ps[k + 1] === 2 ? 4 : ps[k + 1] === 5 ? 2 : 0;
    }
  }
  const tail = line.slice(last);
  if (keepDim || !dim) out += tail;
  return out;
}

const isBorder = (plain: string, width: number) => {
  const t = plain.trimEnd();
  return /^─{3,}/.test(t) && t.endsWith('─') && t.length >= width * 0.8;
};

/**
 * 입력 상자에 들어 있는 글(흐린 제안 문구 제외, 앞뒤 공백 정리) — 비었으면 '', 입력 상자를 못 찾으면 null
 * (질문·권한 창이 입력 상자 자리를 차지했거나 claude 화면이 아닐 때).
 */
export function inputBoxText(styledScreen: string): string | null {
  const lines = styledScreen.split('\n');
  const plain = lines.map((l) => solidText(l, true));
  const width = Math.max(0, ...plain.map((l) => l.trimEnd().length));
  if (!width) return null;
  for (let i = lines.length - 2; i >= 0; i -= 1) {
    if (!isBorder(plain[i], width) || !/^[❯!]/.test(plain[i + 1])) continue;
    const parts: string[] = [];
    for (let j = i + 1; j < lines.length && !isBorder(plain[j], width); j += 1) {
      let t = solidText(lines[j]);
      if (j === i + 1) t = t.replace(/^[❯!]/, '');
      parts.push(t.replace(/\u00a0/g, ' ').trim());
    }
    return parts.filter(Boolean).join('\n');
  }
  return null;
}

// ── 티켓 키 ──

/**
 * 세션이 맡은 티켓 키 — 탭 제목 앞머리(Jira [작업]이 키로 단다) → 브랜치 마지막 조각(`feature/SSB-137`)
 * → 대화 제목·첫 요청 속 첫 키. 없으면 null.
 */
export function ticketKeyOf(s: {
  tabTitle: string;
  branch: string | null;
  title: string | null;
  firstPrompt: string | null;
}): string | null {
  const fromTab = leadingIssueKey(s.tabTitle);
  if (fromTab) return fromTab;
  const seg = s.branch?.split('/').pop();
  const fromBranch = seg ? leadingIssueKey(seg) : undefined;
  if (fromBranch) return fromBranch;
  for (const text of [s.title, s.firstPrompt]) {
    const key = text ? issueKeysIn(text)[0] : undefined;
    if (key) return key;
  }
  return null;
}
