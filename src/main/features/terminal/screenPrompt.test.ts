// claude 번호 선택 화면 읽기 테스트 — 화면은 Claude Code 2.1.286 실측(폰 폭 54열, `capture-pane -p -J`)을
// 빈 줄까지 그대로 옮겼다. 빈 줄을 빼고 옮기면 질문을 놓치는 버그가 테스트에서 안 보인다(2026-10-01 실제로 그랬다).
import { describe, expect, it } from 'vitest';
import { parseScreenPrompt, parseScreenStatus } from './screenPrompt';

const QUESTION_SCREEN = [
  '❯ AskUserQuestion 도구로 질문 1개만 해줘: 좋아하는',
  '  계절(여름/겨울). 다른 말 없이 바로 호출해.',
  '───────────────────────────────────────────────────────',
  ' ☐ 계절 ',
  '',
  '좋아하는 계절은?',
  '',
  '❯ 1. 여름',
  '     따뜻하고 햇빛이 풍부한 계절',
  '  2. 겨울',
  '     쌀쌀하고 눈이 오는 계절',
  '  3. Type something.',
  '───────────────────────────────────────────────────────',
  '  4. Chat about this',
  '',
  'Enter to select · ↑/↓ to navigate · Esc to cancel',
  '',
  '',
].join('\n');

describe('parseScreenPrompt', () => {
  it('AskUserQuestion 화면 — 머리·질문·선택지·설명·직접 입력 자리', () => {
    expect(parseScreenPrompt(QUESTION_SCREEN)).toEqual({
      header: '계절',
      question: '좋아하는 계절은?',
      options: [
        { n: 1, label: '여름', description: '따뜻하고 햇빛이 풍부한 계절', current: true },
        { n: 2, label: '겨울', description: '쌀쌀하고 눈이 오는 계절' },
        { n: 3, label: 'Type something.' },
        { n: 4, label: 'Chat about this' },
      ],
      freeText: 3,
    });
  });

  it('여러 질문의 검토 화면 — 안내 줄이 없고 선택지로 끝난다(실측 그대로)', () => {
    const screen = [
      '  과일(사과/배). 바로 호출해.                          ',
      '',
      '───────────────────────────────────────────────────────',
      '←  ☒ 색상  ☒ 과일  ✔ Submit  →',
      '',
      'Review your answers',
      '',
      ' ● 어떤 색을 선호하시나요?    ',
      '   → 파랑',
      ' ● 어떤 과일을 좋아하시나요?',
      '   → 사과           ',
      '',
      'Ready to submit your answers?',
      '',
      '❯ 1. Submit answers                                   ',
      '  2. Cancel',
      '',
      '',
    ].join('\n');
    expect(parseScreenPrompt(screen)).toEqual({
      question: 'Ready to submit your answers?',
      options: [
        { n: 1, label: 'Submit answers', current: true },
        { n: 2, label: 'Cancel' },
      ],
    });
  });

  // ── 2.1.290 실측(2026-10-06, 140열) — 안내 줄이 `Enter to …` 가 아니거나 끝에 경계가 붙는 화면들 ──

  it('검토 화면 아래에 입력 상자 위 경계(이름표)가 붙어도 읽는다', () => {
    const screen = [
      '─'.repeat(140),
      '←  ☒ 시간대  ☒ 문화생활  ✔ Submit  →',
      '',
      'Review your answers',
      '',
      ' ● 아침형 인간인가요 밤형 인간인가요?',
      '   → 아침형',
      '',
      'Ready to submit your answers?',
      '',
      '❯ 1. Submit answers',
      '  2. Cancel',
      '',
      '─'.repeat(116) + ' create-hello-txt-file ─',
    ].join('\n');
    expect(parseScreenPrompt(screen)).toEqual({
      question: 'Ready to submit your answers?',
      options: [
        { n: 1, label: 'Submit answers', current: true },
        { n: 2, label: 'Cancel' },
      ],
    });
  });

  it('권한 확인 — 안내 줄이 Esc to cancel, 점선 사이 미리보기는 질문에 넣지 않는다', () => {
    const screen = [
      '⏺ Write(hello.txt)',
      '',
      '─'.repeat(140),
      ' Create file',
      ' hello.txt',
      '╌'.repeat(140),
      '  1 hi',
      '╌'.repeat(140),
      ' Do you want to create hello.txt?',
      ' ❯ 1. Yes',
      '   2. Yes, and switch to accept edits (auto-approve file edits and common file commands) for this session (shift+tab)',
      '   3. No',
      '',
      ' Esc to cancel · Tab to amend',
    ].join('\n');
    expect(parseScreenPrompt(screen)).toEqual({
      question: 'Do you want to create hello.txt?',
      options: [
        { n: 1, label: 'Yes', current: true },
        {
          n: 2,
          label: 'Yes, and switch to accept edits (auto-approve file edits and common file commands) for this session (shift+tab)',
        },
        { n: 3, label: 'No' },
      ],
    });
  });

  it('플랜 승인 — 안내 줄이 ctrl+g, 3번(고칠 점 쓰기)이 직접 답 자리', () => {
    const screen = [
      '   - hello.txt 를 읽어 내용이 hi 인지 확인한다.',
      '  ' + '╌'.repeat(136),
      '',
      '',
      '  ' + '─'.repeat(136),
      '   Claude has written up a plan and is ready to execute. Would you like to proceed?',
      '',
      '   ❯ 1. Yes, and switch to BYPASS PERMISSIONS (no further prompts) for this session',
      '     2. Yes, manually approve edits',
      '     3. Tell Claude what to change',
      '        shift+tab to approve with this feedback',
      '',
      '   ctrl+g to edit in Vim · ~/.claude/plans/hello-txt-hi-wondrous-badger.md',
    ].join('\n');
    expect(parseScreenPrompt(screen)).toEqual({
      question: 'Claude has written up a plan and is ready to execute. Would you like to proceed?',
      options: [
        { n: 1, label: 'Yes, and switch to BYPASS PERMISSIONS (no further prompts) for this session', current: true },
        { n: 2, label: 'Yes, manually approve edits' },
        { n: 3, label: 'Tell Claude what to change', description: 'shift+tab to approve with this feedback' },
      ],
      freeText: 3,
    });
  });

  it('안내 줄이 없고 마지막 줄도 선택지가 아니면 읽지 않는다', () => {
    expect(parseScreenPrompt('❯ 1. 목록\n  2. 둘째\n\n그 아래 다른 글\n')).toBeNull();
  });

  it('번호 없는 선택 화면(폴더 신뢰)은 읽지 않는다 — 호출부가 터미널 안내로 물러난다', () => {
    const screen = [
      ' Quick safety check: Is this a project you created or one you trust?',
      ' ❯ No, exit',
      '   Yes, I trust this folder',
      ' Enter to confirm · Esc to cancel',
    ].join('\n');
    expect(parseScreenPrompt(screen)).toBeNull();
  });

  it('번호가 이어지지 않는 줄은 설명으로 붙인다(1. 다음 3. 같은 오인 방지)', () => {
    const screen = ['질문?', '❯ 1. 가', '  3. 본문 속 번호', '  2. 나', 'Enter to select'].join('\n');
    expect(parseScreenPrompt(screen)?.options).toEqual([
      { n: 1, label: '가', description: '3. 본문 속 번호', current: true },
      { n: 2, label: '나' },
    ]);
  });
});

describe('parseScreenStatus', () => {
  it('작업 중 상태 줄 — 스피너 기호·동사가 바뀌어도 말줄임 + 괄호로 읽는다(실측)', () => {
    const screen = [
      '⏺ User answered Claude\'s questions:',
      '  ⎿  · 좋아하는 계절이 무엇인가요? → 겨울',
      '· Precipitating… (7s · ↓ 252 tokens · thinking)',
      '────────────────────────────────────────',
      '❯ ',
      '────────────────────────────────────────',
    ].join('\n');
    expect(parseScreenStatus(screen)).toBe('Precipitating… · 7s · ↓ 252 tokens · thinking');
    expect(parseScreenStatus('✶ Garnishing… (7s · ↓ 527 tokens)\n❯ ')).toBe('Garnishing… · 7s · ↓ 527 tokens');
  });

  it('상태 줄이 없으면 null — 일반 글의 말줄임은 기호로 시작하지 않으면 걸리지 않는다', () => {
    expect(parseScreenStatus('그래서 이렇게 했습니다…\n❯ ')).toBeNull();
    expect(parseScreenStatus('❯ 입력 중\n')).toBeNull();
    // 입력창에 친 글이 '…' 로 끝나도 상태로 읽지 않는다 — 위의 진짜 상태 줄을 읽는다
    expect(parseScreenStatus('✶ Garnishing… (3s)\n───\n❯ 그래서 이렇게…\n───')).toBe('Garnishing… · 3s');
  });
});
