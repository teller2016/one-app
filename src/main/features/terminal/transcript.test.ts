// claude 대화 기록 파서 테스트 — 줄 모양은 Claude Code 2.1.x jsonl 실측을 줄인 것이다.
import { describe, expect, it } from 'vitest';
import { RESULT_MAX, applyQueueOps, describeTool, parseTranscript } from './transcript';

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

  it('사람 입력에는 보낸 시각(ISO)을 싣는다', () => {
    const { items } = parseTranscript(
      [line({ type: 'user', uuid: 'u', timestamp: '2026-10-01T05:02:00.000Z', message: { content: '안녕' } })],
      CWD,
    );
    expect(items).toEqual([{ kind: 'user', key: 'u', text: '안녕', ts: '2026-10-01T05:02:00.000Z' }]);
  });

  it('이미지가 붙은 입력은 [Image #N] 자리 표시를 걷는다(이미지 N장 머리가 대신)', () => {
    const { items } = parseTranscript(
      [
        line({
          type: 'user',
          uuid: 'm',
          message: {
            content: [
              { type: 'text', text: '[Image #1] [Image #2] 두 이미지 색은?' },
              { type: 'image', source: {} },
              { type: 'image', source: {} },
            ],
          },
        }),
      ],
      CWD,
    );
    expect(items).toEqual([{ kind: 'user', key: 'm', text: '두 이미지 색은?', images: 2 }]);
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

// 일하는 중에 보낸 메시지 — 2026-10-02 실측 줄(Claude Code 2.1.286)을 줄인 것
describe('대기열(일하는 중에 보낸 메시지)', () => {
  const enqueue = (text: string, ts: string) => line({ type: 'queue-operation', operation: 'enqueue', timestamp: ts, content: text });
  const make = (text: string, ts: string | undefined, n: number) => ({ key: `q:${ts}:${n}`, text, ts });

  it('enqueue 는 대기열에 넣고, 진행 중인 턴에 끼워 읽히면(remove + queued_command) 보통 말풍선이 된다', () => {
    const first = parseTranscript([enqueue('둘째 메시지', '2026-10-02T00:41:20.942Z')], CWD);
    expect(first.items).toEqual([]);
    const q = applyQueueOps([], first.queueOps, make);
    expect(q.map((x) => x.text)).toEqual(['둘째 메시지']);

    const later = parseTranscript(
      [
        line({ type: 'queue-operation', operation: 'remove', content: '둘째 메시지', reason: 'absorbed_mid_turn' }),
        line({
          type: 'attachment',
          uuid: 'att1',
          timestamp: '2026-10-02T00:41:20.942Z',
          attachment: {
            type: 'queued_command',
            prompt: '둘째 메시지',
            commandMode: 'prompt',
            origin: { kind: 'human' },
            timestamp: '2026-10-02T00:41:20.942Z',
          },
        }),
      ],
      CWD,
    );
    expect(applyQueueOps(q, later.queueOps, make)).toEqual([]);
    expect(later.items).toEqual([{ kind: 'user', key: 'att1', text: '둘째 메시지', ts: '2026-10-02T00:41:20.942Z' }]);
  });

  it('턴이 끝나고 꺼내 가면(dequeue) 앞에서부터 빠진다', () => {
    const { queueOps } = parseTranscript(
      [enqueue('하나', 't1'), enqueue('둘', 't2'), line({ type: 'queue-operation', operation: 'dequeue' })],
      CWD,
    );
    expect(applyQueueOps([], queueOps, make).map((x) => x.text)).toEqual(['둘']);
  });

  it('모르는 연산은 대기열을 비운다', () => {
    const { queueOps } = parseTranscript([enqueue('하나', 't1'), line({ type: 'queue-operation', operation: 'popAll' })], CWD);
    expect(applyQueueOps([], queueOps, make)).toEqual([]);
  });

  it('사람이 아닌 끼워 넣기(queued_command — 작업 알림 등)는 말풍선으로 만들지 않는다', () => {
    const { items } = parseTranscript(
      [line({ type: 'attachment', uuid: 'x', attachment: { type: 'queued_command', prompt: '<task-notification>…', origin: { kind: 'task' } } })],
      CWD,
    );
    expect(items).toEqual([]);
  });

  it('백그라운드 작업 완료(<task-notification>)는 내 말풍선이 아니라 알림 줄', () => {
    const { items } = parseTranscript(
      [
        line({
          type: 'user',
          uuid: 'n1',
          message: {
            content:
              '<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n<summary>Background command "sleep 10" completed (exit code 0)</summary>\n</task-notification>',
          },
        }),
      ],
      CWD,
    );
    expect(items).toEqual([{ kind: 'notice', key: 'n1', text: '백그라운드 작업 — Background command "sleep 10" completed (exit code 0)' }]);
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
