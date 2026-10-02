// MO 터미널 순수 로직 — 키 매핑·수정 키·DA 필터·자동 attach 순서·입력 대기 안정화
import { describe, expect, it } from 'vitest';
import type { ChatItem } from '../../shared/terminal-protocol';
import type { TerminalSessionInfo } from '../../shared/types';
import {
  CHAT_MAX_ITEMS,
  KEY_SEQ,
  StableWaiting,
  applyModifiers,
  base64UrlToBytes,
  defaultView,
  mergeChat,
  pickAutoAttach,
  sameKey,
  stripDaReplies,
  visibleSessions,
} from './logic';

const sess = (id: string, cwd = '/a', status: TerminalSessionInfo['status'] = 'idle'): TerminalSessionInfo => ({
  id,
  title: id,
  cwd,
  cols: 80,
  rows: 24,
  agentId: 'claude',
  status,
  working: false,
  createdAt: 0,
});

describe('KEY_SEQ', () => {
  it('2단 키 바의 이동·제어 키', () => {
    expect(KEY_SEQ.home).toBe('\x1b[H');
    expect(KEY_SEQ.end).toBe('\x1b[F');
    expect(KEY_SEQ.pgup).toBe('\x1b[5~');
    expect(KEY_SEQ.pgdn).toBe('\x1b[6~');
    expect(KEY_SEQ['ctrl-c']).toBe('\x03');
    expect(KEY_SEQ['shift-tab']).toBe('\x1b[Z');
  });
});

describe('applyModifiers', () => {
  it('수정 키가 없으면 그대로', () => {
    expect(applyModifiers('a', { ctrl: false, alt: false })).toEqual({ data: 'a', used: false });
  });
  it('ctrl 은 한 글자를 제어문자로 (대소문자 무관)', () => {
    expect(applyModifiers('c', { ctrl: true, alt: false })).toEqual({ data: '\x03', used: true });
    expect(applyModifiers('C', { ctrl: true, alt: false }).data).toBe('\x03');
    expect(applyModifiers('[', { ctrl: true, alt: false }).data).toBe('\x1b');
  });
  it('ctrl 은 @~_ 범위 밖 글자를 그대로 두지만 소비는 한다', () => {
    expect(applyModifiers('1', { ctrl: true, alt: false })).toEqual({ data: '1', used: true });
  });
  it('ctrl 은 여러 글자(붙여넣기·이스케이프 시퀀스)에 걸지 않는다', () => {
    expect(applyModifiers('ab', { ctrl: true, alt: false })).toEqual({ data: 'ab', used: false });
  });
  it('alt 는 ESC 접두', () => {
    expect(applyModifiers('b', { ctrl: false, alt: true })).toEqual({ data: '\x1bb', used: true });
    expect(applyModifiers('\x1b[A', { ctrl: false, alt: true }).data).toBe('\x1b\x1b[A');
  });
  it('ctrl + alt = ESC + 제어문자', () => {
    expect(applyModifiers('c', { ctrl: true, alt: true }).data).toBe('\x1b\x03');
  });
});

describe('stripDaReplies', () => {
  it('DA1·DA2 자동 응답만 걸러낸다', () => {
    expect(stripDaReplies('\x1b[?1;2c\x1b[>0;276;0c')).toBe('');
    expect(stripDaReplies('ls\x1b[?1;2c')).toBe('ls');
  });
  it('키 바의 esc 한 글자·방향키는 건드리지 않는다', () => {
    expect(stripDaReplies('\x1b')).toBe('\x1b');
    expect(stripDaReplies('\x1b[A')).toBe('\x1b[A');
  });
});

describe('visibleSessions / pickAutoAttach', () => {
  const list = [sess('x', '/a'), sess('y', '/b'), sess('z', '/b')];
  it('작업 영역이 있으면 그 위치 세션만', () => {
    expect(visibleSessions(list, '/b').map((s) => s.id)).toEqual(['y', 'z']);
    expect(visibleSessions(list, null)).toHaveLength(3);
  });
  it('알림 세션 → 마지막 세션 → 영역 첫 세션', () => {
    expect(pickAutoAttach(list, { wanted: 'z', last: 'x', scopePath: '/b' })).toBe('z');
    expect(pickAutoAttach(list, { wanted: null, last: 'x', scopePath: '/b' })).toBe('x'); // 영역과 무관하게 이어본다
    expect(pickAutoAttach(list, { wanted: 'gone', last: 'gone2', scopePath: '/b' })).toBe('y');
    expect(pickAutoAttach([], { wanted: 'z', last: 'x', scopePath: null })).toBeNull();
  });
});

describe('StableWaiting', () => {
  // 가짜 시계 — set 은 콜백을 모아 두고 테스트가 직접 흘린다
  const fakeTimers = () => {
    const pending = new Map<number, () => void>();
    let n = 0;
    return {
      pending,
      timers: {
        set: (fn: () => void) => {
          pending.set(++n, fn);
          return n;
        },
        clear: (h: unknown) => {
          pending.delete(h as number);
        },
      },
      flush: () => {
        const fns = [...pending.values()];
        pending.clear();
        fns.forEach((f) => f());
      },
    };
  };

  it('대기가 생기면 즉시 넣고 새로 든 것만 돌려준다', () => {
    const t = fakeTimers();
    const w = new StableWaiting(3000, () => undefined, t.timers);
    expect(w.update([sess('a', '/a', 'waiting')])).toEqual(['a']);
    expect(w.update([sess('a', '/a', 'waiting')])).toEqual([]); // 이미 있다 — 알림을 다시 울리지 않는다
    expect([...w.ids]).toEqual(['a']);
  });

  it('잠깐 busy 로 내려가도 유예 동안은 남고, 다시 대기면 유예를 취소한다', () => {
    const t = fakeTimers();
    let shrunk = 0;
    const w = new StableWaiting(3000, () => shrunk++, t.timers);
    w.update([sess('a', '/a', 'waiting')]);
    w.update([sess('a', '/a', 'busy')]);
    expect(w.ids.has('a')).toBe(true);
    expect(t.pending.size).toBe(1);
    w.update([sess('a', '/a', 'waiting')]); // 진동 — 빼려던 것을 취소
    expect(t.pending.size).toBe(0);
    expect(shrunk).toBe(0);
  });

  it('유예가 끝나도 대기가 아니면 뺀다', () => {
    const t = fakeTimers();
    let shrunk = 0;
    const w = new StableWaiting(3000, () => shrunk++, t.timers);
    w.update([sess('a', '/a', 'waiting')]);
    w.update([sess('a', '/a', 'idle')]);
    t.flush();
    expect(w.ids.size).toBe(0);
    expect(shrunk).toBe(1);
  });

  it('세션이 사라지면(종료) 유예 없이 뺀다', () => {
    const t = fakeTimers();
    const w = new StableWaiting(3000, () => undefined, t.timers);
    w.update([sess('a', '/a', 'waiting')]);
    w.update([]);
    expect(w.ids.size).toBe(0);
    expect(t.pending.size).toBe(0);
  });
});

describe('채팅 보기', () => {
  const tool = (key: string, toolId: string): ChatItem => ({ kind: 'tool', key, toolId, name: 'Bash', summary: 'ls' });

  it('defaultView — claude 계열은 채팅, 그 외는 터미널', () => {
    expect(defaultView('claude')).toBe('chat');
    expect(defaultView('femc')).toBe('chat');
    expect(defaultView('shell')).toBe('term');
    expect(defaultView(undefined)).toBe('term');
  });

  it('mergeChat — 덧붙이고 결과는 같은 toolId 에 단다', () => {
    const prev = [tool('a', 't1')];
    const next = mergeChat(prev, [{ kind: 'assistant', key: 'b', text: '끝' }], [{ toolId: 't1', text: 'ok' }]);
    expect(next).toHaveLength(2);
    expect(next[0]).toMatchObject({ result: { text: 'ok' } });
  });

  it('mergeChat — 무변화면 원본 참조 · 같은 key 는 교체 · 상한을 넘으면 앞에서 버린다', () => {
    const prev = [tool('a', 't1')];
    expect(mergeChat(prev, [], [])).toBe(prev);
    expect(mergeChat(prev, [], [{ toolId: 'zz', text: '' }])).toBe(prev);
    expect(mergeChat(prev, [tool('a', 't2')], [])).toEqual([tool('a', 't2')]);
    const many = Array.from({ length: CHAT_MAX_ITEMS + 5 }, (_, i) => tool(`k${i}`, `t${i}`));
    const capped = mergeChat([], many, []);
    expect(capped).toHaveLength(CHAT_MAX_ITEMS);
    expect(capped[0].key).toBe('k5');
  });
});

describe('웹 푸시 공개키', () => {
  it('URL-safe base64(패딩 없음)를 바이트로 — +/ 자리의 -_ 와 길이 맞춤', () => {
    const bytes = Uint8Array.from([251, 255, 191, 0, 1]); // 표준 base64 로는 '+/+/AAE=' 류가 나오는 값
    const url = Buffer.from(bytes).toString('base64url');
    expect(url).not.toMatch(/[+/=]/);
    expect([...base64UrlToBytes(url)]).toEqual([...bytes]);
  });

  it('65바이트 P-256 공개키 길이 그대로', () => {
    const key = Buffer.alloc(65, 7).toString('base64url');
    expect(base64UrlToBytes(key).length).toBe(65);
  });

  it('기존 구독 키 비교 — 같으면 재구독 안 함, 다르거나 없으면 재구독', () => {
    const k = Uint8Array.from([1, 2, 3]);
    expect(sameKey(Uint8Array.from([1, 2, 3]).buffer, k)).toBe(true);
    expect(sameKey(Uint8Array.from([1, 2, 4]).buffer, k)).toBe(false);
    expect(sameKey(Uint8Array.from([1, 2]).buffer, k)).toBe(false);
    expect(sameKey(null, k)).toBe(false);
  });
});
