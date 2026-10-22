import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrchestratorConfirmRequest } from '../../../shared/types';
import { createConfirmQueue } from './confirm';

const INPUT = { title: '워커에 지시', fields: [{ label: '대상', value: 'SSB-137 · FO-BBJ' }] };

function setup(timeoutMs = 1000) {
  const changes: OrchestratorConfirmRequest[][] = [];
  const requests: OrchestratorConfirmRequest[] = [];
  let n = 0;
  const queue = createConfirmQueue({
    timeoutMs,
    onChange: (list) => changes.push(list),
    onRequest: (req) => requests.push(req),
    newId: () => `id${++n}`,
  });
  return { queue, changes, requests };
}

describe('승인 대기열', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('[실행] 이면 approved, 대기열에서 빠진다', async () => {
    const { queue, changes, requests } = setup();
    const p = queue.request(INPUT);
    expect(queue.list().map((r) => r.id)).toEqual(['id1']);
    expect(requests).toHaveLength(1);
    expect(queue.answer('id1', true)).toBe(true);
    await expect(p).resolves.toBe('approved');
    expect(queue.list()).toEqual([]);
    expect(changes.at(-1)).toEqual([]);
  });

  it('[취소] 면 rejected', async () => {
    const { queue } = setup();
    const p = queue.request(INPUT);
    queue.answer('id1', false);
    await expect(p).resolves.toBe('rejected');
  });

  it('답이 없으면 timeout — 늦게 누른 응답은 false', async () => {
    const { queue } = setup(1000);
    const p = queue.request(INPUT);
    vi.advanceTimersByTime(1000);
    await expect(p).resolves.toBe('timeout');
    expect(queue.answer('id1', true)).toBe(false);
  });

  it('요청 쪽이 끊으면 cancelled 로 거둔다', async () => {
    const { queue } = setup();
    const ac = new AbortController();
    const p = queue.request(INPUT, ac.signal);
    ac.abort();
    await expect(p).resolves.toBe('cancelled');
    expect(queue.list()).toEqual([]);
  });

  it('이미 끊긴 요청은 대기열에 넣지 않는다', async () => {
    const { queue, requests } = setup();
    const ac = new AbortController();
    ac.abort();
    await expect(queue.request(INPUT, ac.signal)).resolves.toBe('cancelled');
    expect(requests).toHaveLength(0);
  });

  it('여러 건은 들어온 순서로 보이고 clear 는 전부 cancelled', async () => {
    const { queue } = setup();
    const a = queue.request(INPUT);
    vi.advanceTimersByTime(10);
    const b = queue.request({ ...INPUT, title: '탭 닫기' });
    expect(queue.list().map((r) => r.title)).toEqual(['워커에 지시', '탭 닫기']);
    queue.clear();
    await expect(a).resolves.toBe('cancelled');
    await expect(b).resolves.toBe('cancelled');
    expect(queue.list()).toEqual([]);
  });

  it('한 번 정해진 결정은 바뀌지 않는다 (응답 뒤 만료 타이머 무시)', async () => {
    const { queue } = setup(1000);
    const p = queue.request(INPUT);
    queue.answer('id1', true);
    vi.advanceTimersByTime(2000);
    await expect(p).resolves.toBe('approved');
  });
});
