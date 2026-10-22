// 루트 작업 원장 렌더러 쪽 — 루트가 맡긴 일 중 아직 닫히지 않은 것의 세션 id(워커 탭의 '루트' 표시) · 탭 순서 보고.
import { useEffect, useMemo, useState } from 'react';
import { isOpenTask, type OrchestratorTask } from '../../../../shared/types';

/** 루트가 맡긴 일이 아직 열려 있는(지시~보고받기 전) 세션 id — 워커 탭에 '루트' 표시를 붙인다 */
export function useRootTaskSessionIds(): ReadonlySet<string> {
  const [tasks, setTasks] = useState<OrchestratorTask[]>([]);
  useEffect(() => {
    const api = window.oneApp?.orchestrator;
    if (!api) return;
    let alive = true;
    void api.tasks().then((v) => {
      if (alive) setTasks(v);
    });
    const off = api.onTasksChanged(setTasks);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return useMemo(() => new Set(tasks.filter(isOpenTask).map((t) => t.sessionId)), [tasks]);
}

/** 탭 순서(워크트리 경로 → 세션 id)를 main 에 알린다 — 루트의 list_sessions 가 "두 번째 세션"을 풀 때 쓴다 */
export function reportTabOrders(orders: Record<string, string[]>): void {
  window.oneApp?.orchestrator?.reportTabOrders(orders);
}
