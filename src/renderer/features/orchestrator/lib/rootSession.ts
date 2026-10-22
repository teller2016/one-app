// 루트 세션 렌더러 훅 — 지금 루트 세션 id 구독 · '루트 열기' 동작(⌘P 명령과 터미널 LNB 고정 칸이 같은 것을 쓴다).
import { useCallback, useEffect, useState } from 'react';
import { useToast } from '../../../components/Toast';
import { errMsg } from '../../../lib/errMsg';
import { openTerminalSession } from '../../../lib/sectionNav';

/** 지금 루트 세션 id — 아직 연 적이 없으면 null. 그 세션이 살아 있는지는 세션 목록으로 따로 본다 */
export function useRootSessionId(): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    const api = window.oneApp?.orchestrator;
    if (!api) return;
    let alive = true;
    void api.rootSessionId().then((v) => {
      if (alive) setId(v);
    });
    const off = api.onRootChanged(setId);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return id;
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
