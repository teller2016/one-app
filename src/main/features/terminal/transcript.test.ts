// claude 대화 기록 파서 테스트 — 줄 모양은 Claude Code 2.1.x jsonl 실측을 줄인 것이다.
import { describe, expect, it } from 'vitest';
import { RESULT_MAX, describeTool, parseTranscript } from './transcript';

const CWD = '/Users/me/proj';
const line = (o: unknown) => JSON.stringify(o);

describe('parseTranscript', () => {
  it('사람 입력·답변 텍스트·도구 호출·결과를 순서대로 뽑는다', () => {
    const { items, results } = parseTranscript(
      [
        line({ type: 'user', uuid: 'u1', message: { content: '안녕' } }),
        line({ type: 'assistant', uuid: 'a1', message: { content: [{ type: 'thinking', thinking: '…' }] } }),
        line({ type: 'assistant', uuid: 'a2', message: { content: [{ type: 'text', text: '확인합니다' }] } }),
        line({
          type: 'assistant',
          uuid: 'a3',
          message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: `${CWD}/src/a.ts` } }] },
        }),
        line({
          type: 'user',
          uuid: 'u2',
          message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: '내용' }] }] },
        }),
      ],
      CWD,
    );
    expect(items).toEqual([
      { kind: 'user', key: 'u1', text: '안녕' },
      { kind: 'assistant', key: 'a2:0', text: '확인합니다' },
      { kind: 'tool', key: 'a3:0', toolId: 't1', name: 'Read', summary: 'src/a.ts' },
    ]);
    expect(results).toEqual([{ toolId: 't1', text: '내용' }]);
  });

  it('서브에이전트(isSidechain)·주입문(isMeta)·기타 줄 type 은 숨긴다', () => {
    const { items } = parseTranscript(
      [
        line({ type: 'user', uuid: 'x', isSidechain: true, message: { content: '서브' } }),
        line({ type: 'user', uuid: 'y', isMeta: true, message: { content: '<local-command-caveat>…' } }),
        line({ type: 'attachment', uuid: 'z' }),
        line({ type: 'permission-mode', permissionMode: 'default' }),
      ],
      CWD,
    );
    expect(items).toEqual([]);
  });

  it('깨진 줄(쓰는 중인 마지막 줄)은 건너뛰고 나머지는 살린다', () => {
    const { items } = parseTranscript(
      [line({ type: 'user', uuid: 'u1', message: { content: '하나' } }), '{"type":"user","mess'],
      CWD,
    );
    expect(items).toHaveLength(1);
  });

  it('슬래시 명령은 명령 한 줄로, 명령 출력은 숨긴다', () => {
    const { items } = parseTranscript(
      [
        line({
          type: 'user',
          uuid: 'c1',
          message: { content: '<command-name>/commit</command-name>\n<command-args>메시지</command-args>' },
        }),
        line({ type: 'user', uuid: 'c2', message: { content: '<local-command-stdout>ok</local-command-stdout>' } }),
      ],
      CWD,
    );
    expect(items).toEqual([{ kind: 'command', key: 'c1', text: '/commit 메시지' }]);
  });

  it('중단 표식은 말풍선이 아니라 흐름 표식으로', () => {
    const { items } = parseTranscript(
      [
        line({ type: 'user', uuid: 'i1', message: { content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] } }),
        line({ type: 'user', uuid: 'i2', message: { content: '[Request interrupted by user]' } }),
      ],
      CWD,
    );
    expect(items).toEqual([
      { kind: 'notice', key: 'i1', text: '중단됨' },
      { kind: 'notice', key: 'i2', text: '중단됨' },
    ]);
  });

  it('AskUserQuestion 은 선택지 항목으로', () => {
    const { items } = parseTranscript(
      [
        line({
          type: 'assistant',
          uuid: 'q',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'tq',
                name: 'AskUserQuestion',
                input: {
                  questions: [
                    { question: '색?', header: '색', multiSelect: false, options: [{ label: '빨강', description: 'r' }, { label: '파랑' }] },
                  ],
                },
              },
            ],
          },
        }),
      ],
      CWD,
    );
    expect(items).toEqual([
      {
        kind: 'ask',
        key: 'q:0',
        toolId: 'tq',
        questions: [
          {
            question: '색?',
            header: '색',
            multiSelect: false,
            options: [{ label: '빨강', description: 'r' }, { label: '파랑', description: undefined }],
          },
        ],
      },
    ]);
  });

  it('이미지가 붙은 입력은 개수를 남긴다 · 긴 결과는 자른다', () => {
    const { items, results } = parseTranscript(
      [
        line({
          type: 'user',
          uuid: 'i',
          message: { content: [{ type: 'image', source: {} }, { type: 'text', text: '이거 봐' }] },
        }),
        line({
          type: 'user',
          uuid: 'r',
          message: { content: [{ type: 'tool_result', tool_use_id: 't', is_error: true, content: 'x'.repeat(RESULT_MAX + 10) }] },
        }),
      ],
      CWD,
    );
    expect(items).toEqual([{ kind: 'user', key: 'i', text: '이거 봐', images: 1 }]);
    expect(results[0].isError).toBe(true);
    expect(results[0].text.length).toBeLessThan(RESULT_MAX + 30);
  });
});

describe('describeTool', () => {
  it('Bash 는 설명이 있으면 설명, 없으면 명령 첫 줄', () => {
    expect(describeTool('Bash', { command: 'npm test', description: '테스트 실행' }, CWD).summary).toBe('테스트 실행');
    expect(describeTool('Bash', { command: '\nnpm test\nnpm run lint' }, CWD).summary).toBe('npm test');
  });

  it('Edit 는 diff 형태 상세', () => {
    expect(describeTool('Edit', { file_path: `${CWD}/a.ts`, old_string: 'a', new_string: 'b' }, CWD)).toEqual({
      summary: 'a.ts',
      detail: '- a\n+ b',
    });
  });

  it('모르는 도구(MCP)는 첫 문자열 값', () => {
    expect(describeTool('mcp__x__y', { n: 1, q: '검색어' }, CWD).summary).toBe('검색어');
  });
});
