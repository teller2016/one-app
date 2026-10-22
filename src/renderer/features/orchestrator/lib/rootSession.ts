// 루트 세션 렌더러 훅 — 지금 루트 세션 id 구독 · '루트 열기' 동작(⌘P 명령과 터미널 LNB 고정 칸이 같은 것을 쓴다).
import { useCallback, useSyncExternalStore } from 'react';
import { useToast } from '../../../components/Toast';
import { errMsg } from '../../../lib/errMsg';
import { openTerminalSession } from '../../../lib/sectionNav';

// 창 하나에 구독 하나 — 훅을 쓰는 곳(LNB·탭바·알림 카드)마다 IPC 를 따로 묻고 구독하지 않게 모듈에 둔다.
// ⚠️ 처음 묻는 응답이 그 사이 온 방송보다 늦게 오면 옛 값으로 덮는다 — 방송을 한 번이라도 받았으면 그 응답은 버린다.
let rootId: string | null = null;
let started = false;
let heard = false;
const subscribers = new Set<() => void>();

function setRootId(next: string | null): void {
  if (next === rootId) return;
  rootId = next;
  for (const fn of subscribers) fn();
}

function startWatching(): void {
  if (started) return;
  started = true;
  const api = window.oneApp?.orchestrator;
  if (!api) return;
  api.onRootChanged((v) => {
    heard = true;
    setRootId(v);
  });
  void api.rootSessionId().then((v) => {
    if (!heard) setRootId(v);
  });
}

function subscribe(fn: () => void): () => void {
  startWatching();
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

/** 지금 루트 세션 id — 아직 연 적이 없으면 null. 그 세션이 살아 있는지는 세션 목록으로 따로 본다 */
export function useRootSessionId(): string | null {
  return useSyncExternalStore(subscribe, () => rootId);
}

/** 루트 탭 열기 — 떠 있으면 그 탭으로, 없으면 main 이 새로 띄운다. 실패는 토스트 */
export function useOpenRoot(): () => void {
  const toast = useToast();
  return useCallback(() => {
    void (async () => {
      try {
        const res = await window.oneApp?.orchestrator?.openRoot();
        if (!res) return;
        if (!res.ok) {
          toast(res.error, 'fail');
          return;
        }
        openTerminalSession({ sessionId: res.sessionId, cwd: res.cwd });
      } catch (err) {
        toast(errMsg(err, '루트 세션을 열지 못했습니다.'), 'fail');
      }
    })();
  }, [toast]);
}
