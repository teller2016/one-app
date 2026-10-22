import { describe, expect, it } from 'vitest';
import { lastInputKind, matchesInstruction, peerMessages, scanWorker, WORKER_SCAN_START } from './taskScan';

const line = (v: unknown) => JSON.stringify(v);
const user = (content: unknown, extra: Record<string, unknown> = {}) =>
  line({ type: 'user', message: { content }, timestamp: '2026-10-22T03:00:00.000Z', ...extra });
const assistant = (text = '끝났습니다') => line({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const queued = (prompt: string, origin?: unknown) => line({ type: 'attachment', attachment: { type: 'queued_command', prompt, origin } });

describe('matchesInstruction', () => {
  it('앞머리가 같으면 우리 지시다 — 공백 차이는 무시', () => {
    expect(matchesInstruction({ text: 'SSB-137  작업해 줘\n자세히', origin: undefined }, 'SSB-137 작업해 줘 자세히')).toBe(true);
    expect(matchesInstruction({ text: '다른 일', origin: undefined }, 'SSB-137 작업해 줘')).toBe(false);
  });

  it('슬래시 명령은 명령 이름으로 맞춘다', () => {
    const text = '<command-message>run-ticket</command-message>\n<command-name>/run-ticket</command-name>\n<command-args>SSB-137</command-args>';
    expect(matchesInstruction({ text, origin: undefined }, '/run-ticket SSB-137')).toBe(true);
    expect(matchesInstruction({ text, origin: undefined }, '/qa SSB-137')).toBe(false);
  });

  it('여러 줄 붙여넣기의 감싸개(pasted_content)를 벗겨 맞춘다', () => {
    const text = '\n\n<pasted_content id="54d4">\nSSB-137 작업해 줘\n둘째 줄\n</pasted_content>';
    expect(matchesInstruction({ text, origin: { kind: 'human' } }, 'SSB-137 작업해 줘\n둘째 줄')).toBe(true);
  });

  it('세션 간 메시지는 같은 글이어도 우리 지시가 아니다', () => {
    expect(matchesInstruction({ text: 'SSB-137 작업해 줘', origin: { kind: 'peer' } }, 'SSB-137 작업해 줘')).toBe(false);
  });
});

describe('scanWorker', () => {
  const start = WORKER_SCAN_START;

  it('지시가 읽히고 그 뒤 답이 나오면 replied', () => {
    const r = scanWorker([assistant('이전 답'), user('SSB-137 작업해 줘'), assistant()], 'SSB-137 작업해 줘', start);
    expect(r).toEqual({ consumed: true, replied: true, anyReply: true });
  });

  it('지시 전의 답(이전 턴)은 replied 로 세지 않는다 — anyReply 만', () => {
    expect(scanWorker([assistant('이전 답')], 'SSB-137 작업해 줘', start)).toEqual({ ...start, anyReply: true });
  });

  it('진행 중인 턴에 끼워 넣어 읽힌 지시(queued_command)도 읽힘으로 본다', () => {
    const r = scanWorker([queued('SSB-137 작업해 줘'), assistant()], 'SSB-137 작업해 줘', start);
    expect(r).toEqual({ consumed: true, replied: true, anyReply: true });
  });

  it('조각으로 나눠 읽어도 이어진다', () => {
    const a = scanWorker([user('SSB-137 작업해 줘')], 'SSB-137 작업해 줘', start);
    expect(a).toEqual({ consumed: true, replied: false, anyReply: false });
    expect(scanWorker([assistant()], 'SSB-137 작업해 줘', a)).toEqual({ consumed: true, replied: true, anyReply: true });
  });

  it('도구 결과·주입물·서브에이전트 줄·깨진 줄은 입력이 아니다', () => {
    const lines = [
      user([{ type: 'tool_result', content: 'SSB-137 작업해 줘' }]),
      user('SSB-137 작업해 줘', { isMeta: true }),
      user('SSB-137 작업해 줘', { isSidechain: true }),
      '{깨진 줄',
    ];
    expect(scanWorker(lines, 'SSB-137 작업해 줘', start)).toEqual(start);
  });
});

describe('peerMessages', () => {
  it('실측 모양 — isMeta 인 user 줄 + origin peer(2026-10-22 root-dev 기록)', () => {
    const real = user('Another Claude session sent a message:\n<cross-session-message from="uds:/tmp/cc-socks/81395.sock">…', {
      isMeta: true,
      origin: { kind: 'peer', from: 'uds:/tmp/cc-socks/81395.sock', verifiedPeerPid: 81395, name: 'one-app-77', fromMode: 'bypass' },
    });
    expect(peerMessages([real])).toEqual([{ pid: 81395, name: 'one-app-77', at: Date.parse('2026-10-22T03:00:00.000Z') }]);
    expect(lastInputKind([user('사람'), assistant(), real])).toBe('peer');
  });


  it('루트가 바쁠 때 대기열에 들어간 메시지도 센다 — pid 는 소켓 이름에서', () => {
    const enq = line({
      type: 'queue-operation',
      operation: 'enqueue',
      timestamp: '2026-10-22T03:50:30.648Z',
      content: '<cross-session-message from="uds:/tmp/cc-socks/81395.sock" from-name="one-app-77">보고</cross-session-message>',
    });
    const humanEnq = line({ type: 'queue-operation', operation: 'enqueue', content: '사람이 친 글' });
    expect(peerMessages([enq, humanEnq])).toEqual([{ pid: 81395, name: 'one-app-77', at: Date.parse('2026-10-22T03:50:30.648Z') }]);
  });

  it('peer 출처의 입력만 — pid·이름·시각', () => {
    const lines = [
      user('사람이 친 글'),
      user('<cross-session-message>보고</cross-session-message>', { origin: { kind: 'peer', name: 'fo-bbj', verifiedPeerPid: 4242 } }),
      queued('끼워 넣은 보고', { kind: 'peer', verifiedPeerPid: 77 }),
    ];
    expect(peerMessages(lines)).toEqual([
      { pid: 4242, name: 'fo-bbj', at: Date.parse('2026-10-22T03:00:00.000Z') },
      { pid: 77, name: null, at: 0 },
    ]);
  });
});

describe('lastInputKind', () => {
  it('마지막 입력의 출처 — 도구 결과·답변은 건너뛴다', () => {
    const peer = user('보고', { origin: { kind: 'peer', verifiedPeerPid: 1 } });
    expect(lastInputKind([user('사람'), assistant(), peer, assistant(), user([{ type: 'tool_result' }])])).toBe('peer');
    expect(lastInputKind([peer, user('사람이 다시'), assistant()])).toBe('human');
  });

  it('진행 중에 끼워 들어온 보고도 마지막 입력이다', () => {
    expect(lastInputKind([user('사람'), assistant(), queued('보고', { kind: 'peer' })])).toBe('peer');
  });

  it('입력이 없으면 null', () => {
    expect(lastInputKind([assistant()])).toBeNull();
  });
});
