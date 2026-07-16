import { useCallback, useEffect, useRef, useState } from 'react';
import type { PrBranch } from '../../../../shared/types';
import { Button } from '../../../components/Button';
import { Icon } from '../../../components/Icon';
import { Input } from '../../../components/Input';
import { RefreshButton } from '../../../components/RefreshButton';

const rel = (ts?: number) => {
  if (!ts) return '';
  const min = Math.floor((Date.now() - ts) / 60000);
  if (min < 1) return '방금 전';
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  return `${Math.floor(hr / 24)}일 전`;
};

type BranchState = { loading: boolean; list?: PrBranch[]; error?: string };

/**
 * 빠른 PR — 등록한 저장소의 최근 push 브랜치를 자동으로 찾아
 * [PR 만들기]로 생성 모달을 연다 (push → PR → 머지 루프의 진입점).
 */
export function QuickPr({
  repos,
  onAddRepo,
  onRemoveRepo,
  onCreate,
}: {
  repos: string[];
  onAddRepo: (repo: string) => void;
  onRemoveRepo: (repo: string) => void;
  onCreate: (repo: string, head: string) => void;
}) {
  const [branches, setBranches] = useState<Record<string, BranchState>>({});
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [repoInput, setRepoInput] = useState('');
  const loadedRef = useRef<Set<string>>(new Set());

  const loadBranches = useCallback(async (repo: string) => {
    setBranches((prev) => ({ ...prev, [repo]: { loading: true } }));
    const res = await window.oneApp.prs.getBranches(repo);
    setBranches((prev) => ({
      ...prev,
      [repo]: {
        loading: false,
        list: res.branches,
        error: res.ok ? undefined : res.error ?? '브랜치 조회 실패',
      },
    }));
    // 최신 브랜치를 기본 선택
    if (res.ok && res.branches?.length) {
      setSelected((prev) =>
        prev[repo] ? prev : { ...prev, [repo]: (res.branches as PrBranch[])[0].name },
      );
    }
  }, []);

  // 새로 등록된 저장소의 브랜치 로드
  useEffect(() => {
    repos.forEach((repo) => {
      if (loadedRef.current.has(repo)) return;
      loadedRef.current.add(repo);
      void loadBranches(repo);
    });
  }, [repos, loadBranches]);

  const add = () => {
    const repo = repoInput.trim().replace(/^\/+|\/+$/g, '');
    if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) return;
    onAddRepo(repo);
    setRepoInput('');
  };

  return (
    <div className="prs__quick">
      <div className="prs__quick-head">
        <span className="form-label">빠른 PR</span>
        <span className="hint">
          push 한 브랜치를 골라 develop 으로 PR 을 만들고 바로 머지까지.
        </span>
      </div>

      {repos.map((repo) => {
        const st = branches[repo];
        const list = st?.list ?? [];
        return (
          <div key={repo} className="prs__quick-row">
            <span className="prs__repo">{repo.split('/').pop()}</span>
            {st?.loading ? (
              <span className="hint">브랜치 확인 중...</span>
            ) : st?.error ? (
              <span className="prs__quick-error">{st.error}</span>
            ) : list.length === 0 ? (
              <span className="hint">develop 외 브랜치가 없습니다.</span>
            ) : (
              <select
                className="prs__branch-select"
                value={selected[repo] ?? list[0].name}
                onChange={(e) =>
                  setSelected((prev) => ({ ...prev, [repo]: e.target.value }))
                }
              >
                {list.map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name}
                    {b.committedAt ? ` · ${rel(b.committedAt)}` : ''}
                  </option>
                ))}
              </select>
            )}
            {/* 액션 클러스터 — 오른쪽 끝 정렬 (PR 목록 행의 머지 버튼과 동일 패턴) */}
            <div className="prs__quick-actions">
              <RefreshButton
                size={12}
                spinning={!!st?.loading}
                onClick={() => void loadBranches(repo)}
                title="브랜치 목록 새로고침 (push 직후 누르세요)"
              />
              <Button
                size="sm"
                variant="primary"
                disabled={!selected[repo] && list.length === 0}
                onClick={() => onCreate(repo, selected[repo] ?? list[0]?.name)}
              >
                PR 만들기
              </Button>
              <button
                type="button"
                className="icon-btn"
                title="저장소 제거"
                aria-label="저장소 제거"
                onClick={() => onRemoveRepo(repo)}
              >
                <Icon name="x" size={12} />
              </button>
            </div>
          </div>
        );
      })}

      <div className="prs__quick-add">
        <Input
          small
          type="text"
          value={repoInput}
          onChange={(e) => setRepoInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="owner/repo (예: babybonjuk_forbiz/babybonjuk-metacommerce-fe-store)"
        />
        <Button size="sm" onClick={add} disabled={!repoInput.trim()}>
          <Icon name="plus" size={12} />
          저장소 추가
        </Button>
      </div>
    </div>
  );
}
