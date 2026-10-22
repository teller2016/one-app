// 루트 세션 입력 가드 테스트 — guard.ts 의 순수 함수만 다룬다.
// 화면 예시의 SGR 은 2026-10-22 실측(capture-pane -e, Claude Code 2.1.307) 그대로다.
import { describe, expect, it } from 'vitest';
import type { ChatPrompt } from '../../../shared/terminal-protocol';
import {
  checkSend,
  inputBoxText,
  sanitizeInstruction,
  solidText,
  ticketKeyOf,
  type SendCheckInput,
} from './guard';

const ok: SendCheckInput = { isRoot: false, isDockShell: false, hasClaude: true, prompt: null, inputText: '' };
const reason = (r: ReturnType<typeof checkSend>) => (r.ok ? '' : r.reason);

describe('checkSend', () => {
  it('빈 입력란이면 그대로 넣는다(보관 없음)', () => {
    expect(checkSend(ok)).toEqual({ ok: true, stashDraft: false });
  });

  it('사용자가 쓰던 글이 있어도 막지 않고, 먼저 보관하게 한다(10-22 사용자 결정)', () => {
    expect(checkSend({ ...ok, inputText: '이거 고쳐줘' })).toEqual({ ok: true, stashDraft: true });
  });

  it('루트 자신·독 셸·claude 없는 세션은 막는다', () => {
    expect(reason(checkSend({ ...ok, isRoot: true }))).toMatch('루트 세션 자신');
    expect(reason(checkSend({ ...ok, isDockShell: true }))).toMatch('독 패널');
    expect(reason(checkSend({ ...ok, hasClaude: false }))).toMatch('claude 가 떠 있지 않');
  });

  it('질문·권한·플랜 창이 떠 있으면 막는다 — Enter 가 선택지를 고른다', () => {
    const q: ChatPrompt = { question: '어느 쪽으로 할까요?', options: [{ n: 1, label: 'A' }] };
    expect(reason(checkSend({ ...ok, prompt: q }))).toMatch('질문이 떠 있어');
    expect(reason(checkSend({ ...ok, prompt: { ...q, kind: 'permission' } }))).toMatch('권한 확인 창');
    expect(reason(checkSend({ ...ok, prompt: { ...q, kind: 'plan' } }))).toMatch('플랜 승인 창');
  });

  it('입력 상자를 못 찾으면(신뢰 확인 창 등) 막는다', () => {
    expect(reason(checkSend({ ...ok, inputText: null }))).toMatch('입력 상자를 찾지 못해');
  });
});

describe('sanitizeInstruction', () => {
  it('ESC 를 걷어 붙여넣기 끝 표시로 빠져나가지 못하게 한다', () => {
    expect(sanitizeInstruction('a\x1b[201~\rrm -rf ~\x1b[200~')).toBe('a[201~\nrm -rf ~[200~');
  });

  it('줄바꿈·탭·한글은 그대로', () => {
    expect(sanitizeInstruction('/run-ticket SSB-137\n\t부가 설명')).toBe('/run-ticket SSB-137\n\t부가 설명');
  });
});

describe('solidText', () => {
  it('흐린 글자만 뺀다', () => {
    expect(solidText('\x1b[39m❯\xa0\x1b[2mTry "fix lint errors"\x1b[0m')).toBe('❯\xa0');
    expect(solidText('\x1b[39m❯\xa0\x1b[2mTry\x1b[0m', true)).toBe('❯\xa0Try');
  });

  it('트루컬러 인자의 2 를 흐림으로 읽지 않는다', () => {
    expect(solidText('\x1b[38;2;2;2;2m진한\x1b[0m')).toBe('진한');
    expect(solidText('\x1b[2m흐림\x1b[22m진함')).toBe('진함');
  });
});

const W = 60;
const border = '─'.repeat(W);
const named = `${'─'.repeat(W - 8)} root ─`;
const screen = (...input: string[]) =>
  [
    '\x1b[48;5;237m❯ \x1b[38;5;231m지난 요청\x1b[39m',
    '⏺ 답변 한 줄',
    '',
    named,
    ...input,
    border,
    '  ⏵⏵ bypass permissions on (shift+tab to cycle)',
  ].join('\n');

describe('inputBoxText', () => {
  it('제안 문구만 있으면 빈 칸', () => {
    expect(inputBoxText(screen('\x1b[39m❯\xa0\x1b[2mTry "fix lint errors"\x1b[0m'))).toBe('');
  });

  it('직접 친 글은 그대로', () => {
    expect(inputBoxText(screen('\x1b[39m❯\xa0hello typed'))).toBe('hello typed');
  });

  it('아무것도 없으면 빈 칸', () => {
    expect(inputBoxText(screen('\x1b[39m❯'))).toBe('');
  });

  it('여러 줄 입력은 이어 붙인다', () => {
    expect(inputBoxText(screen('\x1b[39m❯\xa0첫 줄', '  둘째 줄'))).toBe('첫 줄\n둘째 줄');
  });

  it('대화 기록의 지난 입력 줄을 입력 상자로 오인하지 않는다', () => {
    expect(inputBoxText(screen('\x1b[39m❯'))).not.toContain('지난 요청');
  });

  it('입력 상자가 없으면(질문 창 등) null', () => {
    expect(inputBoxText(['⏺ 질문', border, ' ☐ 머리', ' 1. 예', 'Enter to select · Esc to cancel'].join('\n'))).toBeNull();
    expect(inputBoxText('')).toBeNull();
  });
});

describe('ticketKeyOf', () => {
  const s = { tabTitle: 'babybonjuk-metacommerce-vue-store', branch: null, title: null, firstPrompt: null };

  it('탭 제목 앞머리 → 브랜치 → 대화 제목·첫 요청 순', () => {
    expect(ticketKeyOf({ ...s, tabTitle: 'SSB-137 결제 재시도' })).toBe('SSB-137');
    expect(ticketKeyOf({ ...s, branch: 'feature/SSB-137' })).toBe('SSB-137');
    expect(ticketKeyOf({ ...s, branch: 'bugfix/bbj-1125' })).toBe('BBJ-1125');
    expect(ticketKeyOf({ ...s, firstPrompt: '/run-ticket SSB-9 — 쿠폰 필터' })).toBe('SSB-9');
  });

  it('저장소 이름·키 없는 브랜치는 키가 아니다', () => {
    expect(ticketKeyOf(s)).toBeNull();
    expect(ticketKeyOf({ ...s, tabTitle: 'fo-bbj-2', branch: 'develop' })).toBeNull();
  });
});
