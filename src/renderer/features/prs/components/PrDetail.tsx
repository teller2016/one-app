import { useEffect, useState } from 'react';
import type {
  DeployCommit,
  PrChangedFile,
  PrItem,
  PrMergeInfoResult,
  PrMergeMethod,
} from '../../../../shared/types';
import { Badge } from '../../../components/Badge';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { Icon } from '../../../components/Icon';
import { Segment } from '../../../components/Segment';
import { TextLink } from '../../../components/TextLink';
import { useConfirm } from '../../../components/ConfirmDialog';
import { rel } from '../lib/relTime';

const METHOD_OPTIONS: { value: PrMergeMethod; label: string }[] = [
  { value: 'merge', label: 'Merge' },
  { value: 'squash', label: 'Squash' },
  { value: 'rebase', label: 'Rebase' },
];

const statusLetter = (s: string) =>
  s === 'added' ? 'A' : s === 'removed' || s === 'deleted' ? 'D' : s === 'renamed' ? 'R' : 'M';

/**
 * PR 상세 패널 (마스터-디테일의 우측) — 머지 방향·승인·충돌과 커밋·변경 파일을 한자리에
 * 보여주고 방식 선택 후 바로 머지한다. 충돌 여부는 merge-info(정본)가 오기 전까지
 * 목록 조회 때 받은 mergeable 로 우선 표시한다.
 */
export function PrDetail({
  pr,
  defaultBranch,
  hasToken,
  onMerged,
}: {
  pr: PrItem;
  /** 프로젝트 레지스트리의 기본 브랜치 — 그 외 브랜치로 가는 PR 경고용 */
  defaultBranch?: string;
  hasToken: boolean;
  /** 머지 성공 — 부모가 토스트·목록 갱신·Jira 해결 제안을 이어간다 */
  onMerged: (pr: PrItem) => void;
}) {
  const [info, setInfo] = useState<PrMergeInfoResult | null>(null);
  const [commits, setCommits] = useState<DeployCommit[] | null>(null);
  const [files, setFiles] = useState<PrChangedFile[]>([]);
  const [stats, setStats] = useState<{ additions: number; deletions: number } | null>(null);
  const [commitsError, setCommitsError] = useState('');
  const [method, setMethod] = useState<PrMergeMethod>('merge');
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState('');
  const confirmDialog = useConfirm();

  // 목록이 이미 아는 값을 우선 쓰고, merge-info 응답이 오면 그것이 정본
  const head = pr.head ?? (info?.ok ? info.head : undefined);
  const base = pr.base ?? (info?.ok ? info.base : undefined);
  const mergeable = info?.ok ? info.mergeable : pr.mergeable;

  useEffect(() => {
    let alive = true;
    void window.oneApp.prs.getMergeInfo(pr.repo, pr.number).then((res) => {
      if (alive) setInfo(res);
    });
    return () => {
      alive = false;
    };
  }, [pr.repo, pr.number]);

  // base 대비 head 커밋·변경 파일 — 생성 미리보기와 같은 채널을 재사용한다
  useEffect(() => {
    if (!head || !base) return;
    let alive = true;
    setCommits(null);
    setCommitsError('');
    void window.oneApp.prs.getBranchCommits(pr.repo, base, head).then((res) => {
      if (!alive) return;
      if (!res.ok) {
        setCommitsError(res.error ?? '커밋 조회 실패');
        setCommits([]);
        return;
      }
      setCommits(res.commits ?? []);
      setFiles(res.files ?? []);
      setStats(res.stats ?? null);
    });
    return () => {
      alive = false;
    };
  }, [pr.repo, base, head]);

  const merge = async () => {
    const ok = await confirmDialog({
      title: `${base ?? '대상 브랜치'} 로 머지할까요?`,
      message: `#${pr.number} · ${pr.title}`,
      confirmLabel: '머지',
    });
    if (!ok) return;
    setMerging(true);
    setMergeError('');
    const res = await window.oneApp.prs.merge(pr.repo, pr.number, method);
    setMerging(false);
    if (!res.ok) {
      setMergeError(res.error ?? '머지에 실패했습니다.');
      return;
    }
    onMerged(pr);
  };

  const off = !!base && !!defaultBranch && base !== defaultBranch;

  return (
    <div className="prs__detail">
      <h3 className="prs__detail-title">{pr.title}</h3>
      <div className="prs__detail-meta">
        <span>{pr.repo}</span>
        <span className="prs__detail-num">#{pr.number}</span>
        {pr.author && (
          <span>
            {pr.author}
            {pr.createdAt ? ` · ${rel(pr.createdAt)}` : ''}
          </span>
        )}
        {pr.url && (
          <TextLink
            small
            external
            onClick={() => void window.oneApp.openExternal(pr.url)}
          >
            브라우저에서 열기
          </TextLink>
        )}
      </div>

      <div className="prs__detail-flags">
        {base && (
          <span
            className={'prs__branches' + (off ? ' prs__branches--off' : '')}
            title={`${head ?? '?'} → ${base} 로 머지`}
          >
            {head && (
              <>
                <span className="prs__branch-head">{head}</span>
                <Icon className="prs__branch-arrow" name="arrow-right" size={13} />
              </>
            )}
            <span className="prs__branch-base">{base}</span>
          </span>
        )}
        {pr.approvals != null && pr.approvals > 0 ? (
          <Badge variant="ok">승인 {pr.approvals}</Badge>
        ) : (
          <Badge variant="idle">리뷰 대기</Badge>
        )}
        {mergeable === true ? (
          <Badge variant="ok">충돌 없음</Badge>
        ) : mergeable === false ? (
          <Badge variant="fail">충돌</Badge>
        ) : (
          <Badge variant="idle">확인 중</Badge>
        )}
      </div>

      {info && !info.ok && (
        <Banner variant="danger">{info.error ?? '머지 상태 확인에 실패했습니다.'}</Banner>
      )}
      {mergeable === false && (
        <Banner variant="danger">
          <b>머지할 수 없습니다</b> — 컨플릭트 또는 보호 규칙을 확인하세요.
        </Banner>
      )}

      <div className="prs__detail-sep" />

      {!head || !base ? (
        <p className="hint">브랜치 정보를 확인하는 중...</p>
      ) : commits === null ? (
        <p className="hint">{base} 대비 커밋을 확인하는 중...</p>
      ) : commitsError ? (
        <Banner variant="danger">{commitsError}</Banner>
      ) : commits.length === 0 ? (
        <p className="hint">{base} 와 커밋 차이가 없습니다.</p>
      ) : (
        <>
          <p className="hint prs__detail-stats">
            커밋 {commits.length}개 · 변경 파일 {files.length}개
            {stats && (
              <>
                {' · '}
                <span className="prs__stat-add">+{stats.additions}</span>{' '}
                <span className="prs__stat-del">−{stats.deletions}</span>
              </>
            )}
          </p>
          <div className="prs__detail-panel">
            <ul className="prs__detail-commits">
              {commits.map((c) => (
                <li key={c.id}>{c.message.split('\n')[0]}</li>
              ))}
            </ul>
            {files.length > 0 && (
              <ul className="prs__detail-file-list">
                {files.map((f) => (
                  <li key={f.path} className={`prs__file prs__file--${f.status}`}>
                    <span className="prs__file-status">{statusLetter(f.status)}</span>
                    <span className="prs__file-path">{f.path}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {mergeError && <Banner variant="danger">{mergeError}</Banner>}

      {hasToken ? (
        <div className="prs__detail-actions">
          <Segment<PrMergeMethod>
            options={METHOD_OPTIONS}
            value={method}
            onChange={setMethod}
            disabled={merging}
          />
          <Button
            variant="primary"
            loading={merging}
            disabled={mergeable !== true}
            onClick={() => void merge()}
          >
            머지
          </Button>
        </div>
      ) : (
        <p className="hint">
          머지에는 Gitea 토큰이 필요합니다 — <b>환경설정 → 연동</b>에 저장하세요.
        </p>
      )}
    </div>
  );
}
