// 화면 표본은 2026-10-01 시험 세션(Claude Code 2.1.286, 100×40 tmux)에서 capture-pane 으로 뜬 것이다
import { describe, expect, it } from 'vitest';
import { liveRegionTop } from './claudeLiveRegion';

const COLS = 100;
const R = '─'.repeat(COLS);
const FOOTER = [
  '  regiontest  22.17.0 1 file changed  ·  Haiku 4.5 · xhigh · ⏺ Thinking on  ·  Context [■■······…',
  '  5h [■■········] 16% (3h 35m)  ·  Wk [■■■■······] 44% (1d 23h)',
  '  ⏸ manual mode on · ← 2 agents',
];

/** 40줄 화면 — { 줄 번호(0부터): 글 } 만 채우고 나머지는 빈 줄 */
function screen(rows: Record<number, string>, height = 40): string[] {
  return Array.from({ length: height }, (_, i) => rows[i] ?? '');
}

const HISTORY = {
  1: ' ▐▛███▛█   Claude Code v2.1.286',
  6: '❯ AskUserQuestion 도구로 나에게 좋아하는 계절을 물어봐. 선택지 3개.',
  8: "⏺ User answered Claude's questions:",
  9: '  ⎿  · 어떤 계절을 가장 좋아하시나요? → 봄',
  11: '⏺ 🎯 봄을 가장 좋아하시는군요!',
  16: '✻ Cogitated for 7s · done 오후 11:04',
};

describe('liveRegionTop', () => {
  it('대기 — 입력 상자 위 경계부터', () => {
    const s = screen({
      ...HISTORY,
      33: "  tmux detected · scroll with PgUp/PgDn · or add 'set -g mouse on' to ~/.tmux.conf for wheel scro…",
      34: R,
      35: '❯ ',
      36: R,
      37: FOOTER[0],
      38: FOOTER[1],
      39: FOOTER[2],
    });
    expect(liveRegionTop(s, COLS)).toBe(34);
  });

  it('작업 중 — 스피너 줄부터(팁 포함, 진행 중 도구 줄은 뺀다)', () => {
    const s = screen({
      ...HISTORY,
      18: '❯ Bash 로 "sleep 6 && ls" 를 실행해줘.',
      20: '  6초 대기 후 현재 디렉토리 파일 목록 표시 · 4s',
      21: '  ⎿  $ sleep 6 && ls (4s)',
      22: '     (ctrl+b ctrl+b (twice) to run in background)',
      31: '✳ Shimmying… (6s · ↓ 218 tokens)',
      32: '  ⎿  Tip: Run claude --continue or claude --resume to resume a conversation',
      33: '                                                              auto mode unavailable for this model',
      34: R,
      35: '❯ ',
      36: R,
      37: FOOTER[0],
      38: FOOTER[1],
      39: FOOTER[2],
    });
    expect(liveRegionTop(s, COLS)).toBe(31);
  });

  it('스피너 프레임이 ✻ 여도 — 완료 줄(…없음)과 갈린다', () => {
    const busy = screen({ 30: '✻ Thinking… (2s)', 34: R, 35: '❯ ', 36: R, 37: FOOTER[0] });
    expect(liveRegionTop(busy, COLS)).toBe(30);
    const done = screen({ 30: '✻ Cogitated for 7s · done 오후 11:04', 34: R, 35: '❯ ', 36: R, 37: FOOTER[0] });
    expect(liveRegionTop(done, COLS)).toBe(34);
  });

  it('여러 줄 입력 — 들여쓴 이어지는 줄이 있어도 위 경계', () => {
    const s = screen({ 31: R, 32: '❯ 첫 줄', 33: '  둘째 줄', 34: '  셋째 줄', 35: R, 36: FOOTER[0] });
    expect(liveRegionTop(s, COLS)).toBe(31);
  });

  it('입력이 "1. …" 로 시작해도(선택지처럼 보여도) 위 경계', () => {
    const s = screen({ 20: '⏺ 답변', 34: R, 35: '❯ 1. 이렇게 해줘', 36: R, 37: FOOTER[0] });
    expect(liveRegionTop(s, COLS)).toBe(34);
  });

  it('질문(AskUserQuestion) — 안쪽 구분선이 있어도 맨 위 경계, 화면이 덜 차 중간에 떠도', () => {
    const s = screen({
      1: ' ▐▛███▛█   Claude Code v2.1.286',
      6: '❯ AskUserQuestion 도구로 나에게 좋아하는 계절을 물어봐. 선택지 3개.',
      7: R,
      8: ' ☐ 계절 선호도',
      10: '어떤 계절을 가장 좋아하시나요?',
      12: '❯ 1. 봄',
      13: '     따뜻한 날씨와 새로운 생명이 피어나는 계절',
      14: '  2. 여름',
      16: '  3. 가을',
      18: '  4. Type something.',
      19: R,
      20: '  5. Chat about this',
      22: 'Enter to select · ↑/↓ to navigate · Esc to cancel',
    });
    expect(liveRegionTop(s, COLS)).toBe(7);
  });

  it('질문 — 커서가 경계 바로 아래 선택지(❯ 5.)에 있어도 입력 상자로 오인하지 않는다', () => {
    const s = screen({
      6: '❯ 계절 물어봐',
      7: R,
      8: ' ☐ 계절',
      10: '좋아하는 계절은?',
      12: '  1. 봄',
      19: R,
      20: '❯ 5. Chat about this',
      22: 'Enter to select · ↑/↓ to navigate · Esc to cancel',
    });
    expect(liveRegionTop(s, COLS)).toBe(7);
  });

  it('권한 확인 — 점선(╌)은 경계가 아니다', () => {
    const s = screen({
      22: '❯ Bash 로 "touch b.txt" 실행해줘.',
      24: '⏺ B.txt 파일 생성',
      25: '  ⎿  $ touch b.txt',
      27: R,
      28: ' Bash command',
      29: ' b.txt 파일 생성',
      30: '╌'.repeat(COLS),
      31: ' touch b.txt',
      32: '╌'.repeat(COLS),
      33: ' Do you want to proceed?',
      34: ' ❯ 1. Yes',
      35: '   2. Yes, and always allow access to /private/tmp/… from this project',
      37: '   3. No',
      39: 'Esc to cancel · Tab to amend',
    });
    expect(liveRegionTop(s, COLS)).toBe(27);
  });

  it('폴더 신뢰 — 화면 맨 위 대화상자', () => {
    const s = screen({
      1: R,
      2: ' Accessing workspace:',
      7: ' Quick safety check: Is this a project you created or one you trust? (Like your own code, a',
      15: '❯ No, exit',
      16: '  Yes, I trust this folder',
      18: 'Enter to confirm · Esc to cancel',
    });
    expect(liveRegionTop(s, COLS)).toBe(1);
  });

  it('들여쓴 구분선·짧은 구분선은 경계가 아니다 — 못 찾으면 null', () => {
    expect(liveRegionTop(screen({ 10: '⏺ 답변', 11: '  ' + '─'.repeat(COLS - 2), 12: '──────────' }), COLS)).toBeNull();
  });

  it('claude 가 아닌 화면(셸) — null', () => {
    expect(liveRegionTop(screen({ 0: 'sbjung@mac one-app % ls', 1: 'README.md  src', 2: 'sbjung@mac one-app %' }), COLS)).toBeNull();
  });
});
