// 무인 연쇄 가드의 승인 대기열 — 순수 로직(electron 없음, 단위 테스트 대상).
// 보류 중인 비서 브랜치(feat/assistant-mcp)의 대기열을 그대로 가져왔다. 창 앞으로·방송은 `approve.ts` 가 onChange/onRequest 로 붙인다.
//
// 결정은 네 가지다:
//   approved  — 사용자가 [실행]
//   rejected  — 사용자가 [취소]·Escape
//   timeout   — 정해진 시간 안에 답이 없음 (자리를 비운 사이 쌓여 있다가 나중에 실행되지 않게)
//   cancelled — 요청한 쪽이 먼저 끊었다(루트 claude 에서 Esc) 또는 서버 종료
import crypto from 'node:crypto';
import type {
  OrchestratorConfirmField,
  OrchestratorConfirmRequest,
} from '../../../shared/types';

export type ConfirmDecision = 'approved' | 'rejected' | 'timeout' | 'cancelled';

/** 도구가 넘기는 승인 요청 내용 — id·시각은 대기열이 붙인다 */
export type ConfirmInput = {
  title: string;
  fields: OrchestratorConfirmField[];
  note?: string;
  danger?: boolean;
};

type Entry = {
  req: OrchestratorConfirmRequest;
  settle: (d: ConfirmDecision) => void;
};

export type ConfirmQueueOptions = {
  timeoutMs: number;
  /** 대기열이 바뀔 때마다 (추가·응답·만료) — 오래된 순 목록 */
  onChange: (pending: OrchestratorConfirmRequest[]) => void;
  /** 새 요청이 들어왔을 때만 (창을 앞으로 가져오기 등) */
  onRequest?: (req: OrchestratorConfirmRequest) => void;
  now?: () => number;
  newId?: () => string;
};

export function createConfirmQueue(opts: ConfirmQueueOptions) {
  const now = opts.now ?? Date.now;
  const newId = opts.newId ?? (() => crypto.randomUUID());
  const pending = new Map<string, Entry>();

  const list = (): OrchestratorConfirmRequest[] =>
    [...pending.values()]
      .map((e) => e.req)
      .sort((a, b) => a.createdAt - b.createdAt);

  /** 승인을 요청하고 결정을 기다린다 — signal 이 끊기면 cancelled 로 거둔다 */
  function request(input: ConfirmInput, signal?: AbortSignal): Promise<ConfirmDecision> {
    if (signal?.aborted) return Promise.resolve('cancelled');
    return new Promise<ConfirmDecision>((resolve) => {
      const createdAt = now();
      const req: OrchestratorConfirmRequest = {
        ...input,
        id: newId(),
        createdAt,
        expiresAt: createdAt + opts.timeoutMs,
      };
      let done = false;
      const timer = setTimeout(() => settle('timeout'), opts.timeoutMs);
      const onAbort = () => settle('cancelled');
      function settle(d: ConfirmDecision) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        pending.delete(req.id);
        opts.onChange(list());
        resolve(d);
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      pending.set(req.id, { req, settle });
      opts.onChange(list());
      opts.onRequest?.(req);
    });
  }

  /** 사용자 응답 — 이미 만료·취소된 요청이면 false (모달이 늦게 눌렸다) */
  function answer(id: string, approved: boolean): boolean {
    const entry = pending.get(id);
    if (!entry) return false;
    entry.settle(approved ? 'approved' : 'rejected');
    return true;
  }

  /** 남은 요청을 전부 거둔다 (서버 종료) */
  function clear(): void {
    for (const entry of [...pending.values()]) entry.settle('cancelled');
  }

  return { request, answer, list, clear };
}

export type ConfirmQueue = ReturnType<typeof createConfirmQueue>;
