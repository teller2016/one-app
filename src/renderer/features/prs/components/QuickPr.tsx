import { useCallback, useEffect, useRef, useState } from 'react';
import type { PrBranch } from '../../../../shared/types';
import { Button } from '../../../components/Button';
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

/** 빠른 PR 대상 — 프로젝트 레지스트리의 Gitea 프로젝트에서 파생 (PrSection 이 계산) */
export type QuickPrRepo = {
  repo: string; // "owner/repo"
  base: string; // 프로젝트 defaultBranch (빈 값은 develop 폴백) — 모달의 초기 대상·타이핑 확인 기준
  name: string; // 프로젝트 표시명
};

/**
 * 빠른 PR — 프로젝트 레지스트리의 Gitea 프로젝트별로 가장 최근 push 브랜치를 보여주고
 * [PR 만들기]로 생성 모달을 연다 (원본·대상 브랜치 선택은 모달에서 한다).
 * 저장소 관리는 프로젝트 탭에서 한다 — 여기엔 추가/삭제 UI 가 없다.
 */
export function QuickPr({
  repos,
  onCreate,
}: {
  repos: QuickPrRepo[];
  /** 모달 열기 — 조회해 둔 최근 브랜치 목록을 그대로 넘겨 재조회를 막는다 */
  onCreate: (repo: string, base: string, branches: PrBranch[]) => void;
}) {
  const [branches, setBranches] = useState<Record<string, BranchState>>({});
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
  }, []);

  // 레지스트리에서 새로 파생된 저장소의 브랜치 로드
  useEffect(() => {
    repos.forEach((r) => {
      if (loadedRef.current.has(r.repo)) return;
      loadedRef.current.add(r.repo);
      void loadBranches(r.repo);
    });
  }, [repos, loadBranches]);

  return (
    <div className="prs__quick">
      <div className="prs__quick-head">
        <span className="form-label">빠른 PR</span>
        <span className="hint">
          push 한 브랜치로 PR 을 만들고 바로 머지까지 — 브랜치는 다음 화면에서 고릅니다.
        </span>
      </div>

      {repos.length === 0 && (
        <p className="hint">
          <b>프로젝트</b> 탭에서 Gitea 원격이 있는 프로젝트를 등록하면 여기
          자동으로 표시됩니다.
        </p>
      )}

      {repos.map((r) => {
        const st = branches[r.repo];
        const list = st?.list ?? [];
        const latest = list[0];
        return (
          <div key={r.repo} className="prs__quick-row">
            <span className="prs__repo" title={r.repo}>
              {r.name}
            </span>
            {st?.loading ? (
              <span className="hint">브랜치 확인 중...</span>
            ) : st?.error ? (
              <span className="prs__quick-error">{st.error}</span>
            ) : !latest ? (
              <span className="hint">PR 가능한 브랜치가 없습니다.</span>
            ) : (
              <span className="prs__quick-latest">
                <span className="prs__quick-branch">{latest.name}</span>
                {latest.committedAt && (
                  <span className="prs__quick-when">{rel(latest.committedAt)}</span>
                )}
              </span>
            )}
            {/* 액션 클러스터 — 오른쪽 끝 정렬 (PR 목록 행의 머지 버튼과 동일 패턴) */}
            <div className="prs__quick-actions">
              <RefreshButton
                size={12}
                spinning={!!st?.loading}
                onClick={() => void loadBranches(r.repo)}
                title="브랜치 목록 새로고침 (push 직후 누르세요)"
              />
              <Button
                size="sm"
                variant="primary"
                disabled={!latest}
                onClick={() => onCreate(r.repo, r.base, list)}
              >
                PR 만들기
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
