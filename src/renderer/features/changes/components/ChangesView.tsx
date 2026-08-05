// 변경사항 뷰 — 워킹트리 파일 목록 + unified diff + 푸시.
// "AI 작업 → 변경 확인 → AI 커밋 → 푸시" 루프의 확인·푸시 화면으로,
// 터미널 드로어(sessionId 대상)와 MO '변경' 탭(projectId 대상)이 공용으로 쓴다.
// 커밋은 만들지 않는다 — 커밋이 생기면 파일 목록이 비고 미푸시 커밋 줄로 나타난다.
import { useCallback, useRef, useState } from 'react';
import type {
  ChangedFile,
  ChangedFileKind,
  ChangesDiffResult,
  ChangesStatus,
  ChangesTarget,
} from '../../../../shared/types';
import { Button } from '../../../components/Button';
import { useConfirm } from '../../../components/ConfirmDialog';
import { EmptyState } from '../../../components/EmptyState';
import { Icon } from '../../../components/Icon';
import { RefreshButton } from '../../../components/RefreshButton';
import { useToast } from '../../../components/Toast';
import { usePolling } from '../../../lib/usePolling';

const POLL_MS = 5000; // 로컬 git status 는 수십 ms — 보이는 동안만 도는 폴링이라 부담 없음

const KIND_CHAR: Record<ChangedFileKind, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  conflict: 'U',
};

/** diff 한 줄의 표시 분류 — 색은 SCSS 토큰(--ok/--danger 등)에서 */
function lineClass(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return 'changes__dline--meta';
  if (line.startsWith('+')) return 'changes__dline--add';
  if (line.startsWith('-')) return 'changes__dline--del';
  if (line.startsWith('@@')) return 'changes__dline--hunk';
  if (line.startsWith('diff ') || line.startsWith('index ')) return 'changes__dline--meta';
  return '';
}

export function ChangesView({ target }: { target: ChangesTarget }) {
  const confirm = useConfirm();
  const toast = useToast();
  const [status, setStatus] = useState<ChangesStatus | null>(null);
  const [selected, setSelected] = useState<ChangedFile | null>(null);
  const [diff, setDiff] = useState<ChangesDiffResult | null>(null);
  const [pushing, setPushing] = useState(false);
  // 폴링 새로고침에서 선택 파일의 diff 도 함께 갱신하기 위한 참조 (의존성 루프 방지)
  const selectedRef = useRef<ChangedFile | null>(null);

  const { projectId, sessionId } = target;

  const loadDiff = useCallback(
    async (file: ChangedFile) => {
      let r: ChangesDiffResult;
      try {
        r = await window.oneApp.changes.diff(
          { projectId, sessionId },
          { path: file.path, origPath: file.origPath, untracked: file.untracked }
        );
      } catch (err) {
        // 세션 종료 등으로 대상이 사라진 레이스 — 에러 상태로 담는다 (unhandled rejection 방지)
        r = { ok: false, error: (err as Error).message };
      }
      // 그 사이 다른 파일을 선택했으면 버린다 (뒤늦은 응답 무시)
      if (selectedRef.current?.path === file.path) setDiff(r);
    },
    [projectId, sessionId]
  );

  const refresh = useCallback(async () => {
    let s: ChangesStatus;
    try {
      s = await window.oneApp.changes.status({ projectId, sessionId });
    } catch (err) {
      // 폴링 도중 세션이 죽으면 대상 해석이 실패한다 — 드로어는 곧 언마운트되지만
      // 그 사이 몇 틱은 조용히 에러 화면으로 (매 틱 unhandled rejection 이 쌓이면 안 됨)
      setStatus({ ok: false, repo: true, error: (err as Error).message });
      return;
    }
    setStatus(s);
    const cur = selectedRef.current;
    if (!cur) return;
    const still = s.files?.find((f) => f.path === cur.path);
    if (still) {
      selectedRef.current = still;
      void loadDiff(still); // 에이전트가 계속 고치는 중 — 열린 diff 도 따라간다
    } else {
      // 커밋되거나 되돌려져 목록에서 사라짐 — 선택 해제
      selectedRef.current = null;
      setSelected(null);
      setDiff(null);
    }
  }, [projectId, sessionId, loadDiff]);

  usePolling(() => void refresh(), POLL_MS);

  const select = (file: ChangedFile) => {
    if (selectedRef.current?.path === file.path) {
      // 같은 파일 다시 클릭 = 닫기
      selectedRef.current = null;
      setSelected(null);
      setDiff(null);
      return;
    }
    selectedRef.current = file;
    setSelected(file);
    setDiff(null);
    void loadDiff(file);
  };

  const push = async () => {
    if (!status) return;
    const count = status.unpushed?.length ?? 0;
    const ok = await confirm({
      title: '원격으로 푸시',
      message: status.upstream
        ? `${status.branch} → ${status.upstream} 로 커밋 ${count}개를 푸시합니다.`
        : `'${status.branch}' 는 원격에 없는 새 브랜치입니다 — origin 에 브랜치를 만들며 푸시합니다.`,
      confirmLabel: '푸시',
    });
    if (!ok) return;
    setPushing(true);
    try {
      const r = await window.oneApp.changes.push({ projectId, sessionId });
      if (r.ok) {
        toast('푸시 완료');
        void refresh();
      } else {
        toast(`푸시 실패: ${r.error ?? '알 수 없는 오류'}`, 'fail');
      }
    } catch (err) {
      toast(`푸시 실패: ${(err as Error).message}`, 'fail');
    } finally {
      setPushing(false);
    }
  };

  if (!status) {
    return (
      <div className="changes changes--center">
        <span className="spinner" />
      </div>
    );
  }
  if (!status.repo) {
    return (
      <div className="changes changes--center">
        <EmptyState
          icon="folder"
          message="git 저장소가 아닙니다"
          hint="이 위치에는 변경사항을 표시할 저장소가 없습니다."
        />
      </div>
    );
  }
  if (!status.ok) {
    return (
      <div className="changes changes--center">
        <EmptyState icon="alert-triangle" message="상태 조회 실패" hint={status.error} />
      </div>
    );
  }

  const files = status.files ?? [];
  const unpushed = status.unpushed ?? [];
  // upstream 이 없으면 ahead 를 알 수 없다 — 새 브랜치는 항상 푸시 허용
  const canPush = status.upstream ? (status.ahead ?? 0) > 0 : !!status.branch;

  return (
    <div className="changes">
      <div className="changes__head">
        <Icon name="git-branch" size={13} />
        <span
          className="changes__branch"
          title={
            status.branch
              ? status.upstream
                ? `${status.branch} → ${status.upstream}`
                : status.branch
              : undefined
          }
        >
          {status.branch ?? '(브랜치 없음)'}
        </span>
        {(status.behind ?? 0) > 0 && (
          <span className="changes__ab changes__ab--behind">↓{status.behind}</span>
        )}
        <span className="changes__spacer" />
        <div className="changes__actions">
          <RefreshButton onClick={() => void refresh()} />
          <Button size="sm" variant="primary" loading={pushing} disabled={!canPush} onClick={() => void push()}>
            푸시{(status.ahead ?? 0) > 0 ? ` ↑${status.ahead}` : ''}
          </Button>
        </div>
      </div>

      {unpushed.length > 0 && (
        <div className="changes__commits">
          <span className="changes__commits-title">푸시 대기 커밋</span>
          {unpushed.map((c) => (
            <div key={c.hash} className="changes__commit">
              <code>{c.hash}</code>
              <span title={c.subject}>{c.subject}</span>
            </div>
          ))}
        </div>
      )}

      {files.length === 0 ? (
        <div className="changes--center">
          <EmptyState
            icon="check"
            message="변경사항이 없습니다"
            hint={unpushed.length > 0 ? '커밋이 푸시를 기다리고 있습니다.' : '워킹트리가 깨끗합니다.'}
          />
        </div>
      ) : (
        <div className="changes__files">
          {files.map((f) => (
            <button
              key={f.path}
              type="button"
              className={`changes__file${selected?.path === f.path ? ' changes__file--active' : ''}`}
              title={f.origPath ? `${f.origPath} → ${f.path}` : f.path}
              onClick={() => select(f)}
            >
              <span className={`changes__kind changes__kind--${f.kind}`}>
                {KIND_CHAR[f.kind]}
              </span>
              <span className="changes__path">{f.path}</span>
              {(f.additions ?? f.deletions) !== undefined && (
                <span className="changes__counts">
                  +{f.additions ?? 0} −{f.deletions ?? 0}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {selected && (
        <pre className="changes__diff">
          {!diff && <span className="changes__dline--meta">불러오는 중…</span>}
          {diff && !diff.ok && (
            <span className="changes__dline--meta">diff 실패: {diff.error}</span>
          )}
          {diff?.ok && diff.binary && (
            <span className="changes__dline--meta">바이너리 파일 — diff 를 표시할 수 없습니다.</span>
          )}
          {diff?.ok && !diff.binary && (
            <>
              {(diff.diff ?? '').split('\n').map((line, i) => (
                <span key={i} className={`changes__dline ${lineClass(line)}`}>
                  {line}
                  {'\n'}
                </span>
              ))}
              {diff.truncated && (
                <span className="changes__dline--meta">… (너무 길어 잘렸습니다)</span>
              )}
            </>
          )}
        </pre>
      )}
    </div>
  );
}
