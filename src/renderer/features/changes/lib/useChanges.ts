// 변경사항 상태 훅 — 드로어(ChangesView)와 전체화면(ChangesOverlay)이 공유하는 로직.
// 상태 폴링 + 모드(작업 중/베이스 대비) + 커밋 목록/선택 + 파일 선택/diff 를 한 곳에서.
// 확인 다이얼로그·토스트는 뷰의 몫 — 훅은 IPC 와 상태만 담당한다.
import { useCallback, useMemo, useRef, useState } from 'react';
import type {
  ChangedFile,
  ChangesCommitResult,
  ChangesDiffResult,
  ChangesDiffScope,
  ChangesLogEntry,
  ChangesMode,
  ChangesPushResult,
  ChangesStatus,
  ChangesTarget,
} from '../../../../shared/types';
import { usePolling } from '../../../lib/usePolling';

const POLL_MS = 5000; // 로컬 git status 는 수십 ms — 보이는 동안만 도는 폴링이라 부담 없음

export function useChanges(
  target: ChangesTarget,
  {
    enabled = true,
    fullDiff = false,
  }: {
    enabled?: boolean;
    /** true 면 diff 를 전체 파일 context 로 — 분할 뷰의 '변경 전/후 파일' 표시용 */
    fullDiff?: boolean;
  } = {}
) {
  const { projectId, sessionId, workspaceId, worktreePath } = target;
  // target 객체는 렌더마다 새로 오므로 필드 기준으로 안정화
  const tgt = useMemo<ChangesTarget>(
    () => ({ projectId, sessionId, workspaceId, worktreePath }),
    [projectId, sessionId, workspaceId, worktreePath]
  );

  const [status, setStatus] = useState<ChangesStatus | null>(null);
  const [mode, setModeState] = useState<ChangesMode>('work');
  const [log, setLog] = useState<ChangesLogEntry[]>([]);
  const [commitSel, setCommitSel] = useState<ChangesLogEntry | null>(null);
  const [commitFiles, setCommitFiles] = useState<ChangedFile[] | null>(null);
  const [selected, setSelected] = useState<ChangedFile | null>(null);
  const [diff, setDiff] = useState<ChangesDiffResult | null>(null);
  const [committing, setCommitting] = useState(false);
  const [pushing, setPushing] = useState(false);

  // 폴링 콜백이 최신 선택을 보게 하는 참조 (의존성 루프 방지 — 기존 ChangesView 패턴)
  const modeRef = useRef(mode);
  const commitSelRef = useRef(commitSel);
  const selectedRef = useRef(selected);
  // ⚠️ 내용이 같으면 이전 객체를 유지한다 — IPC 응답은 매번 새 객체라 그대로 set 하면
  // 5초마다 diff 전체(수천 DOM 노드)가 재렌더되고 memo 자식이 전부 무력화된다.
  const statusKeyRef = useRef('');
  const logKeyRef = useRef('');
  // 증분 diff — 화면에 떠 있는 diff 의 (파일+기준) 키와 그 내용 해시.
  // ⚠️ 키가 맞을 때만 해시를 보낸다 — 다른 파일에 보내면 우연히 해시가 같을 때
  // (빈 diff 등) main 이 '변경 없음'을 돌려줘 남의 diff 가 화면에 남는다.
  const diffKeyRef = useRef('');
  const diffHashRef = useRef('');

  const applyStatus = (s: ChangesStatus) => {
    const key = JSON.stringify(s);
    if (key === statusKeyRef.current) return;
    statusKeyRef.current = key;
    setStatus(s);
  };

  /** 지금 보고 있는 기준의 diff scope — 커밋 선택 > branch 모드 > 워킹트리 */
  const scopeNow = (): ChangesDiffScope | undefined => {
    const base: ChangesDiffScope = commitSelRef.current
      ? { commit: commitSelRef.current.hash }
      : modeRef.current === 'branch'
        ? { mode: 'branch' }
        : {};
    if (fullDiff) base.full = true;
    return base.mode || base.commit || base.full ? base : undefined;
  };

  const loadDiff = useCallback(
    async (file: ChangedFile) => {
      const scope = scopeNow();
      const key = `${file.path}|${file.untracked ? 'u' : ''}|${JSON.stringify(scope ?? {})}`;
      const known = diffKeyRef.current === key ? diffHashRef.current : undefined;
      let r: ChangesDiffResult;
      try {
        r = await window.oneApp.changes.diff(
          tgt,
          { path: file.path, origPath: file.origPath, untracked: file.untracked },
          scope,
          known || undefined
        );
      } catch (err) {
        // 세션 종료 등으로 대상이 사라진 레이스 — 에러 상태로 담는다
        r = { ok: false, error: (err as Error).message };
      }
      // 그 사이 다른 파일을 선택했으면 버린다 (뒤늦은 응답 무시)
      if (selectedRef.current?.path !== file.path) return;

      // 내용이 그대로면 본문이 오지 않는다 — 화면에 있는 것을 그대로 둔다.
      // (폴링의 정상 경로다. 여기서 setDiff 를 부르면 diff 가 사라진다.)
      if (r.unchanged) return;

      diffKeyRef.current = key;
      diffHashRef.current = r.hash ?? '';
      // 내용이 같으면 이전 객체 유지 — SplitDiff/UnifiedDiff 의 memo 가 재렌더를 건너뛴다.
      // (main 이 해시로 걸러 주지만, 에러 응답처럼 해시가 없는 경로도 있어 남겨 둔다.)
      setDiff((prev) =>
        prev &&
        prev.ok === r.ok &&
        prev.diff === r.diff &&
        prev.binary === r.binary &&
        prev.truncated === r.truncated &&
        prev.error === r.error
          ? prev
          : r
      );
    },
    [tgt]
  );

  /**
   * diff 를 비운다 — 증분 캐시 키도 함께 지운다.
   * ⚠️ 둘이 어긋나면(state 는 null 인데 키는 남음) 다음 조회가 '변경 없음'을 받아
   * 화면이 빈 채로 굳는다.
   */
  const clearDiff = useCallback(() => {
    diffKeyRef.current = '';
    diffHashRef.current = '';
    setDiff(null);
  }, []);

  /** 모드를 인자로 받는 이유 — setMode 직후 stale ref 로 옛 모드를 조회하지 않게 */
  const doRefresh = useCallback(
    async (m: ChangesMode) => {
      let s: ChangesStatus;
      let lg: ChangesLogEntry[] = [];
      try {
        const [sr, lr] = await Promise.all([
          window.oneApp.changes.status(tgt, m),
          window.oneApp.changes.log(tgt),
        ]);
        s = sr;
        lg = lr.ok ? (lr.commits ?? []) : [];
      } catch (err) {
        // 폴링 도중 세션이 죽으면 대상 해석이 실패한다 — 조용히 에러 화면으로
        applyStatus({ ok: false, repo: true, error: (err as Error).message });
        return;
      }
      applyStatus(s);
      const logKey = JSON.stringify(lg);
      if (logKey !== logKeyRef.current) {
        logKeyRef.current = logKey;
        setLog(lg);
      }
      // 커밋을 보는 중이면 워킹트리 갱신과 무관 (커밋 내용은 불변)
      if (commitSelRef.current) return;
      const cur = selectedRef.current;
      if (!cur) return;
      const still = s.files?.find((f) => f.path === cur.path);
      if (still) {
        selectedRef.current = still;
        setSelected(still);
        void loadDiff(still); // 에이전트가 계속 고치는 중 — 열린 diff 도 따라간다
      } else {
        // 커밋되거나 되돌려져 목록에서 사라짐 — 선택 해제
        selectedRef.current = null;
        setSelected(null);
        clearDiff();
      }
    },
    [tgt, loadDiff, clearDiff]
  );

  const refresh = useCallback(
    (): Promise<void> => doRefresh(modeRef.current),
    [doRefresh]
  );
  // ⚠️ usePolling 에는 안정된 콜백만 — 인라인 화살표를 넘기면 매 렌더마다 identity 가
  // 바뀌어 인터벌 재시작 + immediate 즉시 실행이 반복되고, 응답의 setState 가 다시
  // 렌더를 일으켜 IPC 왕복 주기로 폴링이 폭주한다 (2026-08-06 CPU 폭주 실측 원인).
  const tick = useCallback((): void => {
    void refresh();
  }, [refresh]);
  usePolling(tick, POLL_MS, { enabled });

  /** 모드 전환 — 커밋·파일 선택을 접고 새 기준으로 즉시 재조회 */
  const setMode = useCallback(
    (m: ChangesMode) => {
      if (m === modeRef.current) return;
      modeRef.current = m;
      setModeState(m);
      commitSelRef.current = null;
      setCommitSel(null);
      setCommitFiles(null);
      selectedRef.current = null;
      setSelected(null);
      clearDiff();
      void doRefresh(m);
    },
    [doRefresh, clearDiff]
  );

  /** 커밋 선택 — null 이면 해제(모드 기준 목록으로 복귀) */
  const selectCommit = useCallback(
    (entry: ChangesLogEntry | null) => {
      commitSelRef.current = entry;
      setCommitSel(entry);
      setCommitFiles(null); // 로딩 표시
      selectedRef.current = null;
      setSelected(null);
      clearDiff();
      if (!entry) return;
      window.oneApp.changes
        .commitFiles(tgt, entry.hash)
        .then((r) => {
          if (commitSelRef.current?.hash === entry.hash)
            setCommitFiles(r.ok ? (r.files ?? []) : []);
        })
        .catch(() => {
          if (commitSelRef.current?.hash === entry.hash) setCommitFiles([]);
        });
    },
    [tgt, clearDiff]
  );

  /** 파일 선택 — null 이면 diff 닫기 */
  const selectFile = useCallback(
    (file: ChangedFile | null) => {
      selectedRef.current = file;
      setSelected(file);
      clearDiff();
      if (file) void loadDiff(file);
    },
    [loadDiff, clearDiff]
  );

  /** 전체 일괄 커밋 — 결과를 돌려주고 성공 시 재조회 (토스트는 뷰가) */
  const commit = useCallback(
    async (message: string): Promise<ChangesCommitResult> => {
      setCommitting(true);
      try {
        const r = await window.oneApp.changes.commit(tgt, message);
        if (r.ok) void refresh();
        return r;
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      } finally {
        setCommitting(false);
      }
    },
    [tgt, refresh]
  );

  /** git push — 결과를 돌려주고 성공 시 재조회 (확인 다이얼로그·토스트는 뷰가) */
  const push = useCallback(async (): Promise<ChangesPushResult> => {
    setPushing(true);
    try {
      const r = await window.oneApp.changes.push(tgt);
      if (r.ok) void refresh();
      return r;
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    } finally {
      setPushing(false);
    }
  }, [tgt, refresh]);

  return {
    status,
    mode,
    setMode,
    log,
    commitSel,
    selectCommit,
    /** 표시할 파일 목록 — 커밋 선택 중엔 그 커밋의 파일 (null = 로딩) */
    files: commitSel ? commitFiles : (status?.files ?? null),
    selected,
    selectFile,
    diff,
    refresh,
    commit,
    committing,
    push,
    pushing,
  };
}
