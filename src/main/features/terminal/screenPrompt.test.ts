// claude 번호 선택 화면 읽기 테스트 — 화면은 Claude Code 2.1.286 실측(폰 폭 54열, `capture-pane -p -J`)을
// 빈 줄까지 그대로 옮겼다. 빈 줄을 빼고 옮기면 질문을 놓치는 버그가 테스트에서 안 보인다(2026-10-01 실제로 그랬다).
import { describe, expect, it } from 'vitest';
import { parseScreenPrompt } from './screenPrompt';

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
