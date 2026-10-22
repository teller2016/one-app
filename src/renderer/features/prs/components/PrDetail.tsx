import { useCallback, useEffect, useRef, useState } from 'react';
import {
  isMergeCommit,
  type DeployCommit,
  type JiraIssueStatus,
  type PrChangedFile,
  type PrItem,
  type PrMergeInfoResult,
  type PrMergeMethod,
} from '../../../../shared/types';
import { Badge } from '../../../components/Badge';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { Icon } from '../../../components/Icon';
import { Segment } from '../../../components/Segment';
import { IssueChip } from '../../../components/IssueChip';
import { useConfirm } from '../../../components/ConfirmDialog';
import { errMsg } from '../../../lib/errMsg';
import { usePolling } from '../../../lib/usePolling';
import { statusBadgeVariant } from '../../jira';
import { needsBaseConfirm } from '../lib/baseBranches';
import { RECHECK_POLL_MS } from '../lib/conflictRecheck';
import { prIssueKeys } from '../lib/prIssueKeys';
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
  jiraUrl,
  issueStatuses,
  hasToken,
  conflictPending,
  initialMethod,
  autoConfirm = false,
  onAutoConfirmed,
  onMerged,
}: {
  pr: PrItem;
  /** 프로젝트 레지스트리의 기본 브랜치 — 그 외 브랜치로 가는 PR 경고용 */
  defaultBranch?: string;
  /** 환경설정의 Jira 주소 — 있으면 제목의 이슈 키를 티켓 칩(클릭 = Jira 열기)으로 붙인다 */
  jiraUrl?: string;
  /** 티켓 키 → Jira 상태 — 칩마다 상태 뱃지를 붙인다(목록은 첫 키만, 여기는 전부) */
  issueStatuses: Record<string, JiraIssueStatus>;
  hasToken: boolean;
  /** 머지 직후 Gitea 재검사 창 — 이때의 mergeable=false 는 충돌로 단정하지 않는다 */
  conflictPending?: boolean;
  /** 머지 성공 — 부모가 토스트·목록 갱신·Jira 해결 제안을 이어간다 */
  /** 루트 세션이 골라 둔 머지 방식(prRequest.ts) — 없으면 merge */
  initialMethod?: PrMergeMethod;
  /** 루트 세션의 머지 요청 — 머지 가능이 확인되면 [머지] 확인 창을 바로 띄운다(머지는 확인 창에서 사용자가) */
  autoConfirm?: boolean;
  /** 확인 창을 띄웠다(또는 띄울 수 없었다) — 부모가 요청을 비워 다시 마운트돼도 또 뜨지 않게 */
  onAutoConfirmed?: () => void;
  onMerged: (pr: PrItem) => void;
}) {
  const [info, setInfo] = useState<PrMergeInfoResult | null>(null);
  const [commits, setCommits] = useState<DeployCommit[] | null>(null);
  const [files, setFiles] = useState<PrChangedFile[]>([]);
  const [stats, setStats] = useState<{ additions: number; deletions: number } | null>(null);
  const [commitsError, setCommitsError] = useState('');
  const [method, setMethod] = useState<PrMergeMethod>(initialMethod ?? 'merge');
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState('');
  const confirmDialog = useConfirm();

  // 목록이 이미 아는 값을 우선 쓰고, merge-info 응답이 오면 그것이 정본
  const head = pr.head ?? (info?.ok ? info.head : undefined);
  const base = pr.base ?? (info?.ok ? info.base : undefined);
  const rawMergeable = info?.ok ? info.mergeable : pr.mergeable;
  // 재검사 창 동안의 false 는 '재계산 중'일 수 있어 모름으로 낮춘다 — 뱃지는 '확인 중'이
  // 되고 충돌 배너는 뜨지 않는다 (머지 버튼은 그대로 비활성)
  const mergeable =
    conflictPending && rawMergeable === false ? undefined : rawMergeable;

  // PR 마다 key 로 재마운트되므로(부모) 이 인스턴스의 repo·number 는 바뀌지 않는다
  const loadInfo = useCallback(() => {
    void window.oneApp.prs.getMergeInfo(pr.repo, pr.number).then(setInfo);
  }, [pr.repo, pr.number]);

  // 진입 시 1회 정본 확인 + 재검사 창 동안만 짧은 주기로 재확인 (확정되면 바로 반영)
  useEffect(() => {
    loadInfo();
  }, [loadInfo]);
  usePolling(loadInfo, RECHECK_POLL_MS, {
    enabled: !!conflictPending,
    immediate: false,
  });

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

  // 프로젝트 기본이 아닌 주요 브랜치(main 등)로 머지할 때는 브랜치명 타이핑 확인 — 오머지 방지.
  // 보호 여부는 base 후보 채널로 본다(메인 프로세스 60초 캐시). 조회가 실패해도 관례 이름 판정은 남는다.
  // 레지스트리 밖 저장소는 생성 모달과 같이 develop 을 기본으로 간주한다
  const mustTypeBase = async () => {
    const projectDefault = defaultBranch || 'develop';
    if (!base || base === projectDefault) return false;
    const res = await window.oneApp.prs.getBaseBranches(pr.repo).catch(() => null);
    const candidate = res?.ok ? res.branches?.find((b) => b.name === base) : undefined;
    return needsBaseConfirm(base, projectDefault, candidate);
  };

  const merge = async () => {
    const mustType = await mustTypeBase();
    const ok = await confirmDialog({
      title: `${base ?? '대상 브랜치'} 로 머지할까요?`,
      // 방식도 적는다 — 루트 요청으로 바로 뜬 확인 창은 사용자가 방식을 고르기 전이다
      message: `#${pr.number} · ${pr.title} · ${METHOD_OPTIONS.find((o) => o.value === method)?.label ?? method}`,
      confirmLabel: '머지',
      ...(mustType && {
        warn: true,
        warning: (
          <>
            <b>{base} 브랜치로 머지합니다.</b> 프로젝트 기본 브랜치(
            {defaultBranch || 'develop'})가 아닙니다.
          </>
        ),
        requireText: base,
      }),
    });
    if (!ok) return;
    setMerging(true);
    setMergeError('');
    // invoke 거부(폰 셸 WS 끊김 등)도 잡는다 — 안 잡으면 merging 스피너가 영영 남는다
    try {
      const res = await window.oneApp.prs.merge(pr.repo, pr.number, method);
      if (!res.ok) {
        setMergeError(res.error ?? '머지에 실패했습니다.');
        return;
      }
    } catch (err) {
      setMergeError(errMsg(err, '머지에 실패했습니다.'));
      return;
    } finally {
      setMerging(false);
    }
    onMerged(pr);
  };

  // 루트 세션의 머지 요청 — merge-info(정본)가 온 뒤 머지할 수 있으면 [머지]를 누른 것과 같은 확인 창을 띄운다(한 번만).
  // 충돌이면 띄우지 않고 패널만 남긴다(충돌 배너가 이유를 보인다). ⚠️ 토큰 여부(부모가 설정에서 늦게 읽는다)·머지 가능 여부
  // (재검사 중이면 모름)가 정해질 때까지 기다린다 — 먼저 판정하면 토큰이 있는데도 확인 창을 건너뛴다
  const mergeRef = useRef(merge);
  useEffect(() => {
    mergeRef.current = merge;
  });
  const autoFired = useRef(false);
  useEffect(() => {
    if (!autoConfirm || autoFired.current || info === null || merging || !hasToken || mergeable === undefined) return;
    autoFired.current = true;
    onAutoConfirmed?.();
    if (mergeable === true) void mergeRef.current();
  }, [autoConfirm, info, mergeable, hasToken, merging, onAutoConfirmed]);

  const off = !!base && !!defaultBranch && base !== defaultBranch;
  // 주요 브랜치(main 등)로 가는 PR 은 [머지]를 누르기 전부터 주황으로 — 배포 PROD 버튼과 같은 신호.
  // 렌더 중이라 관례 이름만 본다(보호 여부는 클릭 때 확인창 판정에서 본다)
  const riskyBase = !!base && needsBaseConfirm(base, defaultBranch || 'develop', undefined);
  // Jira 이슈 키(브랜치 우선 → 제목) — 주소 미설정이면 클릭할 수 없는 키를 되풀이할 뿐이라 칩을 그리지 않는다
  const issueKeys = jiraUrl ? prIssueKeys({ head, title: pr.title }) : [];

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
        {issueKeys.map((k) => {
          const issue = issueStatuses[k];
          return (
            <span key={k} className="prs__detail-issue">
              <IssueChip issueKey={k} jiraUrl={jiraUrl} />
              {issue && (
                <Badge variant={statusBadgeVariant(issue)} dot={false} title="Jira 상태">
                  {issue.status}
                </Badge>
              )}
            </span>
          );
        })}
        {pr.url && (
          <button
            type="button"
            className="prs__link"
            onClick={() => void window.oneApp.openExternal(pr.url)}
          >
            브라우저에서 열기
            <Icon name="arrow-up-right" size={11} />
          </button>
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
                <Icon className="prs__branch-arrow" name="arrow-right" size={12} />
              </>
            )}
            <span className="prs__branch-base">{base}</span>
          </span>
        )}
        {pr.approvals != null && pr.approvals > 0 ? (
          <Badge variant="ok">승인 {pr.approvals}</Badge>
        ) : (
          <Badge variant="pill">리뷰 대기</Badge>
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
                <li
                  key={c.id}
                  className={
                    // 머지 커밋과 같은 수준으로 가라앉힘 — 실제 새 작업 커밋만 도드라지게
                    isMergeCommit(c)
                      ? 'prs__commit--merge'
                      : c.alreadyIn
                        ? 'prs__commit--already'
                        : undefined
                  }
                >
                  <span className="prs__commit-msg">{c.message.split('\n')[0]}</span>
                  {c.alreadyIn && <Badge variant="pill">{c.alreadyIn} 포함</Badge>}
                </li>
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
            variant={riskyBase ? 'warn' : 'primary'}
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
