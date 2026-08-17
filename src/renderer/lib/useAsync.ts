// 비동기 조회 한 건의 loading·error·data 를 묶는 공용 훅.
//
// 섹션마다 `useState(false)`(loading) + `useState('')`(error) + `useState<T|null>(null)`(data) 를
// 손으로 들고 try/catch/finally 를 반복하고 있었다(9개 컴포넌트). 반복 자체보다,
// **늦게 도착한 응답이 최신 화면을 덮어쓰는 문제**를 각자 방어해야 한다는 게 진짜 비용이었다
// (DeploySection 은 ref 로 대상 id 를 비교해 손으로 막고 있다).
//
// ⚠️ `usePolling` 과 같은 규칙 — `fn` 은 반드시 `useCallback` 으로 안정화해 넘긴다.
// 인라인 화살표를 주면 `immediate` 재실행이 매 렌더마다 돌아 IPC 왕복 주기로 폭주한다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { errMsg } from './errMsg';

export type AsyncState<T> = {
  data: T | null;
  loading: boolean;
  /** 실패 문구 — 성공하면 빈 문자열 */
  error: string;
  /** 다시 조회 (성공·실패 모두 상태에 반영) */
  reload: () => Promise<void>;
  /** 화면에서 직접 값을 갈아끼울 때 (낙관적 갱신 등) */
  setData: React.Dispatch<React.SetStateAction<T | null>>;
};

export function useAsync<T>(
  fn: () => Promise<T>,
  {
    immediate = true,
    errorFallback,
  }: { immediate?: boolean; errorFallback?: string } = {},
): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(immediate);
  const [error, setError] = useState('');

  // 응답 순서 보장 — 이 세대보다 오래된 응답은 버린다.
  // (연달아 호출하면 먼저 보낸 요청이 나중에 도착할 수 있다)
  const generation = useRef(0);
  // 언마운트 뒤 setState 방지
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    const mine = ++generation.current;
    setLoading(true);
    try {
      const value = await fn();
      if (!alive.current || mine !== generation.current) return;
      setData(value);
      setError('');
    } catch (e) {
      if (!alive.current || mine !== generation.current) return;
      setError(errMsg(e, errorFallback));
    } finally {
      if (alive.current && mine === generation.current) setLoading(false);
    }
  }, [fn, errorFallback]);

  useEffect(() => {
    if (immediate) void reload();
  }, [immediate, reload]);

  return { data, loading, error, reload, setData };
}
