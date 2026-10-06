// 채팅 보기(데스크톱)의 아래 칸 — claude 화면에서 **지금 살아 있는 부분**(입력 상자·작업 중 줄·대화상자)이
// 시작하는 줄을 찾는다. 위는 채팅(대화 기록), 그 줄부터 아래는 진짜 터미널이 보인다.
// 순수 함수(claudeLiveRegion.test.ts) — 화면 글자는 TerminalView 가 xterm 버퍼에서 읽는다.
//
// 화면 모양(Claude Code 2.1.286, 2026-10-01 실측 — tmux 안에선 전체 화면 모드라 입력 상자가 늘 맨 아래다):
//   대기     ────────(전체 폭)          ← 여기부터
//            ❯ 입력                      (여러 줄이면 들여쓴 줄이 이어진다 · 셸 모드는 '!')
//            ────────
//              상태줄(여러 줄)
//   작업 중  ✳ Shimmying… (6s · ↓ 218 tokens)   ← 스피너 줄부터(기호는 프레임마다 바뀐다)
//              ⎿  Tip: …                        (팁·할 일 — 들여쓴 줄)
//            ──── ❯ ──── 상태줄
//   대화상자 ────────(전체 폭)          ← 질문(AskUserQuestion)·권한 확인·폴더 신뢰 — 입력 상자 대신 뜬다
//             ☐ 머리 / Bash command …
//            Enter to select · Esc to cancel
//   ⚠️ 대화상자 안에도 전체 폭 줄이 있다(질문의 'Chat about this' 위) — 대화 기록 줄을 만나기 전까지 **가장 위** 것.
//   ⚠️ 플랜 승인 창('Would you like to proceed?')은 경계를 **좌우 2칸씩 들여** 그린다(2.1.290, 2026-10-06 실측) —
//      0열 경계만 보면 못 찾아 직전 높이(입력 상자 몇 줄)가 남고 **선택지가 채팅 밑에 가려졌다**(사용자 신고).
//      그래서 대화상자 단계에서만 조금 들여쓴 경계도 받는다(입력 상자는 늘 0열이다).
//   ⚠️ 화면이 덜 찼으면 대화상자가 중간에 뜨고 아래는 빈 줄이다 — 그대로 둔다(아래 칸이 커질 뿐).
//   ⚠️ 작업 중인 도구 줄(`⎿ $ sleep 6 (4s)`)은 스피너 위라 넣지 않는다 — 채팅에 '진행 중' 도구로 이미 보인다.
// 못 찾으면 null — 호출부가 직전 값을 유지한다(빗나가도 모양만 어긋나고 입력은 터미널 그대로다).

/**
 * claude 가 그리는 경계 — 0열부터 전체 폭(들여쓴 마크다운 구분선과 갈린다).
 * ⚠️ 입력 상자 **위 경계엔 이름표가 박힐 수 있다** — `--agent` 세션은 `──── 플러그인:에이전트 ─` 처럼 오른쪽에
 *    이름이 들어간다(2026-10-02 사용자 화면 실측). `─` 만으로 된 줄만 경계로 보면 위 경계를 놓치고 아래 경계부터
 *    드러나 **입력 줄이 채팅에 가려졌다**. 그래서 '0열부터 ─ 3개 이상으로 시작해 ─ 로 끝나는 전체 폭 줄' 이면 경계로 본다.
 *    (─ 비율로 거르지 말 것 — 폰 크기(70열)에선 이름표가 줄의 절반을 넘는다)
 */
const RULE_RE = /^─{3,}.*─$/;
const isRuleLine = (line: string, cols: number) => line.length >= cols * 0.8 && RULE_RE.test(line);
/** 대화상자 경계 — 0열 경계 + 플랜 승인 창처럼 몇 칸 들여 그린 전체 폭 줄(위 머리말) */
const DIALOG_RULE_RE = /^ {0,4}─{3,}.*─$/;
const isDialogRuleLine = (line: string, cols: number) => line.length >= cols * 0.8 && DIALOG_RULE_RE.test(line);
/** 입력 상자 첫 줄 — 선택지 커서('❯ 1.')는 아니다 */
const INPUT_RE = /^[❯!>](?!\s*\d+\.)/;
/** 스피너 줄 — '…' 로 알아본다(완료 줄 '✻ Cogitated for 7s · done' 에는 없다) */
const SPINNER_RE = /^[·✢✳✶✻✽*]\s+\S.*…/;
/**
 * 대화 기록 줄 — 답변·도구(⏺) · 완료·스피너(✻). 이 위로는 대화상자가 아니다.
 * ⚠️ 보낸 메시지(`❯ 글`)는 넣지 않는다 — 번호 없는 선택지 커서(폴더 신뢰의 `❯ No, exit`)와 모양이 같다(실측).
 *    메시지 줄엔 0열 전체 폭 줄이 없어 지나쳐도 결과가 같다
 */
const HISTORY_RE = /^(⏺|✻ )/;
/** 입력 상자 높이 상한(경계 두 줄 사이) — 넘으면 입력 상자로 보지 않는다 */
const MAX_INPUT_LINES = 24;
/** 입력 상자 위로 스피너 줄을 찾아 올라가는 거리(팁·할 일 목록이 끼어 있다) */
const SPINNER_SCAN = 24;

export function liveRegionTop(screen: string[], cols: number): number | null {
  const lines = screen.map((l) => l.replace(/\s+$/, ''));
  const isRule = (i: number) => isRuleLine(lines[i], cols);
  const rules: number[] = [];
  lines.forEach((_, i) => isRule(i) && rules.push(i));

  // 1) 입력 상자 — 전체 폭 줄 두 개 사이 첫 줄이 프롬프트. 맨 아래 쌍
  for (let k = rules.length - 2; k >= 0; k -= 1) {
    const a = rules[k];
    const b = rules[k + 1];
    if (b - a < 2 || b - a > MAX_INPUT_LINES || !INPUT_RE.test(lines[a + 1])) continue;
    // 작업 중이면 위의 스피너 줄부터 — 그 사이엔 팁·할 일(들여쓴 줄)·빈 줄만 있다
    for (let i = a - 1; i >= 0 && a - i <= SPINNER_SCAN; i -= 1) {
      if (!lines[i] || /^\s/.test(lines[i])) continue;
      return SPINNER_RE.test(lines[i]) ? i : a;
    }
    return a;
  }

  // 2) 대화상자 — 마지막 글자 줄에서 위로, 대화 기록 줄을 만나기 전까지의 가장 위 전체 폭 줄
  let top: number | null = null;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (HISTORY_RE.test(lines[i])) break;
    if (isDialogRuleLine(lines[i], cols)) top = i;
  }
  return top;
}
