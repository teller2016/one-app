// 세션 현황 요약 테스트 — 줄 모양은 Claude Code 2.1.290~291 jsonl 실측을 줄인 것이다.
import { describe, expect, it } from 'vitest';
import { digestLines, firstPromptOf, lastReplyOf, oneLine, promptLine } from './sessionDigest';

const line = (o: unknown) => JSON.stringify(o);

describe('digestLines', () => {
  it('마지막 ai-title·last-prompt 가 이긴다', () => {
    const d = digestLines(
      [
        line({ type: 'ai-title', aiTitle: '옛 제목', sessionId: 's' }),
        line({ type: 'last-prompt', lastPrompt: '첫 요청', leafUuid: 'x', sessionId: 's' }),
        line({ type: 'user', message: { content: '본문' } }),
        line({ type: 'ai-title', aiTitle: 'fix-order-filter-network-error', sessionId: 's' }),
        line({ type: 'last-prompt', lastPrompt: '커밋해줘', leafUuid: 'y', sessionId: 's' }),
      ],
      {},
    );
    expect(d).toEqual({ aiTitle: 'fix-order-filter-network-error', lastPrompt: '커밋해줘' });
  });

  it('증분 읽기 — 이전 요약에 덧대고, 새 조각에 없는 항목은 그대로 둔다', () => {
    const d = digestLines([line({ type: 'ai-title', aiTitle: '제목' })], {});
    digestLines([line({ type: 'last-prompt', lastPrompt: '다음 요청' })], d);
    expect(d).toEqual({ aiTitle: '제목', lastPrompt: '다음 요청' });
  });

  it('깨진 줄·모르는 줄·글자 속 유형 문자열은 건너뛴다', () => {
    const d = digestLines(
      [
        '{"type":"ai-title","aiTi', // 쓰는 중인 줄
        line({ type: 'user', message: { content: '"ai-title" 이라는 글자를 포함한 입력' } }),
        line({ type: 'ai-title', aiTitle: 42 }),
        line({ type: 'last-prompt', lastPrompt: '   ' }),
      ],
      {},
    );
    expect(d).toEqual({});
  });
});

describe('digestLines — 사람 아닌 입력', () => {
  it('다른 claude 세션이 보낸 메시지는 마지막 요청을 덮지 않는다', () => {
    const d = digestLines(
      [
        line({ type: 'last-prompt', lastPrompt: '주문 목록 화면 옮겨줘' }),
        line({
          type: 'last-prompt',
          lastPrompt: 'Another Claude session sent a message: <teammate-message teammate_id="phase1">완료</teammate-message>',
        }),
        line({ type: 'last-prompt', lastPrompt: '<task-notification><summary>끝</summary></task-notification>' }),
      ],
      {},
    );
    expect(d.lastPrompt).toBe('주문 목록 화면 옮겨줘');
  });
});

describe('promptLine', () => {
  it('붙여넣은 덩어리는 빼고 직접 친 글을 쓴다', () => {
    expect(promptLine('<pasted_content id="ad9c">\n긴 로그\n</pasted_content id="ad9c">\n\n 이 오류 원인 찾아줘')).toBe(
      '이 오류 원인 찾아줘',
    );
  });

  it('붙여넣기뿐이면 그 내용을', () => {
    expect(promptLine('<pasted_content id="x">구글 서치콘솔 설명</pasted_content>')).toBe('구글 서치콘솔 설명');
  });
});

describe('oneLine', () => {
  it('줄바꿈·연속 공백을 접고 이미지 자리 표시를 걷는다', () => {
    expect(oneLine('[Image #1] 이 화면\n\n  고쳐줘 [Image #2]')).toBe('이 화면 고쳐줘');
  });

  it('비면 undefined, 길면 말줄임', () => {
    expect(oneLine(' \n ')).toBeUndefined();
    const long = oneLine('가'.repeat(500));
    expect(long?.length).toBe(201);
    expect(long?.endsWith('…')).toBe(true);
  });
});

describe('firstPromptOf', () => {
  it('슬래시 명령·주입물을 건너뛰고 첫 사람 입력을 고른다', () => {
    expect(
      firstPromptOf([
        line({ type: 'mode', mode: 'default' }),
        line({
          type: 'user',
          message: { content: '<command-name>/model</command-name><command-args>opus</command-args>' },
        }),
        line({ type: 'user', isMeta: true, message: { content: 'Caveat: …' } }),
        line({ type: 'user', message: { content: '<local-command-stdout>Set model</local-command-stdout>' } }),
        line({ type: 'user', message: { content: [{ type: 'text', text: '주문 목록\n필터 오류 고쳐줘' }] } }),
        line({ type: 'user', message: { content: '두 번째' } }),
      ]),
    ).toBe('주문 목록 필터 오류 고쳐줘');
  });

  it('글로 된 인자가 있는 슬래시 명령이면 그 인자가 작업 설명이다', () => {
    expect(
      firstPromptOf([
        line({ type: 'user', message: { content: '<command-name>/model</command-name><command-args>opus</command-args>' } }),
        line({
          type: 'user',
          message: {
            content:
              '<command-message>fe:dev</command-message>\n<command-name>/fe:dev</command-name>\n<command-args>SSB-9 — [식단 주문] 배송일별 팩수</command-args>',
          },
        }),
        line({ type: 'user', message: { content: '진행해' } }),
      ]),
    ).toBe('SSB-9 — [식단 주문] 배송일별 팩수');
  });

  it('다른 claude 세션의 메시지는 첫 요청이 아니다', () => {
    expect(
      firstPromptOf([
        line({ type: 'user', message: { content: 'Another Claude session sent a message: <teammate-message>hi</teammate-message>' } }),
        line({ type: 'user', message: { content: '배너 정렬 고쳐줘' } }),
      ]),
    ).toBe('배너 정렬 고쳐줘');
  });

  it('사람 입력이 없으면 undefined', () => {
    expect(firstPromptOf([line({ type: 'file-history-snapshot' })])).toBeUndefined();
  });
});

describe('lastReplyOf', () => {
  it('마지막 assistant 글을 평문 한 줄로 — 마크다운 표식·코드 블록은 걷는다', () => {
    expect(
      lastReplyOf([
        line({ type: 'assistant', uuid: 'a1', message: { content: [{ type: 'text', text: '옛 답' }] } }),
        line({ type: 'user', uuid: 'u1', message: { content: '다음' } }),
        line({
          type: 'assistant',
          uuid: 'a2',
          message: { content: [{ type: 'text', text: '## 결과\n- **커밋**했습니다 (`bff1bdc`)\n```sh\nnpm test\n```\n끝.' }] },
        }),
        line({ type: 'assistant', uuid: 'a3', message: { content: [{ type: 'tool_use', id: 't', name: 'Bash', input: {} }] } }),
      ]),
    ).toBe('결과 커밋했습니다 (bff1bdc) 끝.');
  });

  it('답변이 없으면 undefined', () => {
    expect(lastReplyOf([line({ type: 'user', message: { content: '안녕' } })])).toBeUndefined();
  });
});
