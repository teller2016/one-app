import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  PrItem,
  PrListResult,
  PrsConfig,
  Project,
} from '../../../../shared/types';
import { ownerRepoFromUrl } from '../../../../shared/types';
import { SectionHeader } from '../../../components/SectionHeader';
import { Icon } from '../../../components/Icon';
import { Banner } from '../../../components/Banner';
import { RefreshButton } from '../../../components/RefreshButton';
import { Button } from '../../../components/Button';
import { Input } from '../../../components/Input';
import { Segment } from '../../../components/Segment';
import { TextLink } from '../../../components/TextLink';
import { useToast } from '../../../components/Toast';
import { useConfirm } from '../../../components/ConfirmDialog';
import { EmptyState } from '../../../components/EmptyState';
import { usePolling, useTick } from '../../../lib/usePolling';
import { CreatePrModal, CreatedPr } from './CreatePrModal';
import { PrList } from './PrList';
import { PrDetail } from './PrDetail';

const orgOf = (pr: PrItem) => pr.repo.split('/')[0];
const keyOf = (pr: PrItem) => `${pr.repo}#${pr.number}`;

/** 새 PR 이 가능한 저장소 — 프로젝트 레지스트리의 Gitea 프로젝트에서 파생 */
type RegistryRepo = { repo: string; projectDefault: string; name: string };

/**
 * PR 섹션 — push → PR 생성 → 머지 루프를 앱에서 끝낸다.
 * 최상단 저장소 탭으로 **저장소별 완전 분리**: 탭을 고르면 목록·검색·상세·생성이
 * 전부 그 저장소 스코프다 (전체 보기 없음). 탭은 프로젝트 레지스트리의 Gitea 저장소
 * 전부(PR 0건 포함 — 생성 진입점) + 레지스트리 밖인데 열린 PR 이 있는 저장소.
 * 마스터-디테일: 좌측 목록에서 고르면 우측 패널에 커밋·변경 파일·충돌 여부와 머지 버튼.
 */
export function PrSection() {
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<PrListResult | null>(null);
  const [config, setConfig] = useState<PrsConfig>({
    excludedOrgs: [],
    recentBases: {},
  });
  const [projects, setProjects] = useState<Project[]>([]);
  const [hasToken, setHasToken] = useState(false);
  const [giteaUrl, setGiteaUrl] = useState(''); // 저장소 PR 경로 링크용 (빈 값이면 링크 생략)
  const [query, setQuery] = useState('');
  // 저장소 탭(owner/repo) — 마지막 선택을 기억한다 (휘발성 UI 상태라 localStorage)
  const [repoTab, setRepoTab] = useState<string>(
    () => localStorage.getItem('prs:repoTab') ?? '',
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // 방금 만든 PR — 목록 재조회가 끝나기 전에도 상세를 띄우기 위한 낙관적 항목
  const [justCreated, setJustCreated] = useState<PrItem | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const toast = useToast();
  const confirmDialog = useConfirm();

  // 머지 직후 — PR 제목에서 Jira 이슈 키를 추출해 해결됨 전환을 제안한다
  // (새 PR 이 브랜치명의 이슈 키를 제목에 넣으므로 문자열 패턴 매칭으로 충분)
  const offerJiraResolve = async (prTitle: string) => {
    const key = prTitle.match(/[A-Z][A-Z0-9]*-\d+/)?.[0];
    if (!key) return; // 이슈 키 없는 PR 이면 조용히 넘어감
    const ok = await confirmDialog({
      title: `${key} 해결됨으로 전환할까요?`,
      message: 'PR 이 머지되었습니다. 배포 전까지 해결됨 상태로 둘 수 있어요.',
      confirmLabel: '해결됨으로',
    });
    if (!ok) return;
    const res = await window.oneApp.jira.resolve(key);
    if (res.ok) toast(`${key} → 해결됨`);
    else toast(res.error ?? '전환에 실패했습니다', 'fail');
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setResult(await window.oneApp.prs.fetch());
    } catch (err) {
      setResult({
        ok: false,
        configured: true,
        error: (err as Error).message ?? '조회 실패',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  // 진입 시 설정·토큰 여부 로드 (1회) + 프로젝트 레지스트리 구독 (새 PR 저장소 소스)
  useEffect(() => {
    window.oneApp.prs.getConfig().then(setConfig);
    window.oneApp.settings.get().then((s) => {
      setHasToken(s.hasGiteaToken);
      setGiteaUrl(s.giteaUrl.replace(/\/+$/, ''));
    });
    void window.oneApp.projects.list().then(setProjects);
    return window.oneApp.projects.onChanged(setProjects);
  }, []);
  usePolling(load, 120_000); // 조회 + 2분 주기 자동 새로고침
  useTick(60_000); // "n분 전" 갱신용 1분 틱

  const saveConfig = (next: PrsConfig) => {
    setConfig(next);
    void window.oneApp.prs.setConfig(next);
  };

  // 조직 제외 토글 — 저장은 메인(userData)에
  const toggleOrg = (org: string) => {
    const set = new Set(config.excludedOrgs);
    if (set.has(org)) set.delete(org);
    else set.add(org);
    saveConfig({ ...config, excludedOrgs: [...set] });
  };

  // 저장소의 프로젝트 기본 브랜치 — PR 이 그 외 브랜치로 가면 목록·상세에서 강조한다
  const defaultBranchOf = useCallback(
    (repo: string) =>
      projects.find((p) => ownerRepoFromUrl(p.remoteUrl) === repo)?.defaultBranch.trim() ||
      undefined,
    [projects],
  );

  // 새 PR 대상 저장소 — Gitea 원격이 있는 프로젝트만, owner/repo 기준 중복 제거
  const createRepos: RegistryRepo[] = useMemo(() => {
    const seen = new Set<string>();
    return projects.flatMap((p) => {
      if (p.remoteKind !== 'gitea') return [];
      const repo = ownerRepoFromUrl(p.remoteUrl);
      if (!repo || seen.has(repo)) return [];
      seen.add(repo);
      return [
        { repo, projectDefault: p.defaultBranch.trim() || 'develop', name: p.name },
      ];
    });
  }, [projects]);

  const prs: PrItem[] = result?.prs ?? [];
  const excluded = new Set(config.excludedOrgs);
  const orgs = [...new Set(prs.map(orgOf))].sort();
  const orgFiltered = prs.filter((pr) => !excluded.has(orgOf(pr)));

  // 저장소 탭 — 레지스트리 Gitea 저장소 전부(등록 순, PR 0건 포함) + 그 밖에 열린 PR 이 있는 저장소.
  // 기억해 둔 탭이 사라졌으면(프로젝트 삭제 등) 첫 탭으로
  const registryRepoIds = createRepos.map((r) => r.repo);
  const repoTabs = [
    ...registryRepoIds,
    ...[...new Set(orgFiltered.map((pr) => pr.repo))]
      .filter((r) => !registryRepoIds.includes(r))
      .sort(),
  ];
  // 탭 라벨 — 프로젝트 레지스트리 표시명 우선 (저장소 풀네임은 탭에 너무 길다)
  const repoTabLabel = (repo: string) =>
    createRepos.find((r) => r.repo === repo)?.name || repo.split('/').pop() || repo;
  const effectiveTab = repoTabs.includes(repoTab) ? repoTab : repoTabs[0] ?? '';
  const changeTab = (v: string) => {
    setRepoTab(v);
    localStorage.setItem('prs:repoTab', v);
  };
  // 현재 탭이 레지스트리 저장소일 때만 새 PR 가능 (기본 브랜치·표시명이 있어야 한다)
  const currentRegistry = createRepos.find((r) => r.repo === effectiveTab);

  const q = query.trim().toLowerCase();
  const visible = orgFiltered
    .filter((pr) => pr.repo === effectiveTab)
    .filter(
      (pr) =>
        !q ||
        [pr.title, pr.repo, pr.author, pr.head ?? '', pr.base ?? '', `#${pr.number}`]
          .join(' ')
          .toLowerCase()
          .includes(q),
    )
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

  // 선택 PR — 목록에서 찾고, 없으면 방금 만든 낙관적 항목(재조회 전)으로 폴백
  const selected =
    visible.find((pr) => keyOf(pr) === selectedKey) ??
    (justCreated && keyOf(justCreated) === selectedKey ? justCreated : null);

  const onCreated = (created: CreatedPr) => {
    setCreateOpen(false);
    toast(`PR #${created.number} → ${created.base} 생성됨`);
    // 고른 base 를 저장소별로 기억 (다음 PR 의 기본 선택값)
    saveConfig({
      ...config,
      recentBases: { ...config.recentBases, [created.repo]: created.base },
    });
    const item: PrItem = {
      repo: created.repo,
      number: created.number,
      title: created.title,
      author: '',
      createdAt: Date.now(),
      url: created.url ?? '',
      head: created.head,
      base: created.base,
    };
    setJustCreated(item);
    setSelectedKey(keyOf(item));
    void load();
  };

  const onMerged = (pr: PrItem) => {
    toast(`#${pr.number} 머지 완료`);
    setSelectedKey(null);
    setJustCreated(null);
    void load();
    void offerJiraResolve(pr.title);
  };

  return (
    <div className="section prs">
      <div className="prs__head">
        <SectionHeader
          icon={<Icon name="git-pull-request" size={18} />}
          title="PR"
          sub="열린 PR 을 한 화면에서 확인하고, 만들고, 바로 머지합니다."
        />
        <div className="prs__toolbar">
          <Input
            small
            className="prs__search"
            type="text"
            placeholder="제목·브랜치 검색"
            aria-label="PR 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {hasToken && (
            <Button
              variant="primary"
              size="sm"
              disabled={!currentRegistry}
              onClick={() => setCreateOpen(true)}
            >
              <Icon name="plus" size={12} /> 새 PR
            </Button>
          )}
          <RefreshButton
            bordered
            size={14}
            spinning={loading}
            onClick={() => void load()}
            disabled={loading}
            title="PR 목록 새로고침"
          />
        </div>
      </div>

      {result && !result.configured ? (
        <Banner variant="info">
          <b>환경설정 → 연동</b>에 Gitea 주소를 입력하면 PR 기능이 활성화됩니다.
        </Banner>
      ) : (
        <>
          {/* 저장소 탭 (최상단) — 여기서 고른 저장소로 아래 전부가 스코프된다 (전체 보기 없음) */}
          {repoTabs.length > 0 && (
            <div className="prs__tabs">
              <Segment
                options={repoTabs.map((r) => {
                  const count = orgFiltered.filter((pr) => pr.repo === r).length;
                  return {
                    value: r,
                    label: count > 0 ? `${repoTabLabel(r)} ${count}` : repoTabLabel(r),
                  };
                })}
                value={effectiveTab}
                onChange={changeTab}
              />
              {/* 현재 저장소의 Gitea PR 경로 — 웹에서 올리거나 훑을 때 */}
              {giteaUrl && effectiveTab && (
                <TextLink
                  small
                  external
                  className="prs__tabs-link"
                  title={`${effectiveTab}/pulls 를 브라우저에서 열기`}
                  onClick={() =>
                    void window.oneApp.openExternal(
                      `${giteaUrl}/${effectiveTab}/pulls`,
                    )
                  }
                >
                  Gitea PR 페이지
                </TextLink>
              )}
            </div>
          )}

          {!hasToken && (
            <Banner>
              PR <b>생성·머지</b>에는 Gitea 토큰이 필요합니다 —{' '}
              <b>환경설정 → 연동</b>에 토큰을 저장하세요. (목록 조회는 지금도
              가능)
            </Banner>
          )}

          {/* 조직(프로젝트) 필터 칩 — 클릭으로 목록·알림에서 제외/포함 */}
          {orgs.length > 1 && (
            <div className="prs__filters">
              {orgs.map((org) => {
                const isExcluded = excluded.has(org);
                const count = prs.filter((pr) => orgOf(pr) === org).length;
                return (
                  <button
                    type="button"
                    key={org}
                    className={'chip' + (isExcluded ? ' chip--excluded' : '')}
                    title={
                      isExcluded
                        ? '제외됨 — 클릭하면 목록·알림에 포함'
                        : '포함됨 — 클릭하면 목록·알림에서 제외'
                    }
                    onClick={() => toggleOrg(org)}
                  >
                    {org}
                    <span className="prs__chip-count">{count}</span>
                  </button>
                );
              })}
            </div>
          )}

          {result && !result.ok ? (
            <Banner variant="danger">
              {result.error ?? 'PR 조회에 실패했습니다.'}
            </Banner>
          ) : loading && prs.length === 0 ? (
            <p className="hint">불러오는 중...</p>
          ) : repoTabs.length === 0 ? (
            <EmptyState
              icon="git-pull-request"
              message="저장소가 없습니다."
              hint="프로젝트 탭에서 Gitea 원격이 있는 프로젝트를 등록하면 저장소 탭이 생깁니다."
            />
          ) : visible.length === 0 && !selected ? (
            <EmptyState
              icon="check"
              message={
                q
                  ? '검색에 해당하는 열린 PR 이 없습니다.'
                  : `${repoTabLabel(effectiveTab)} 에 열린 PR 이 없습니다.`
              }
              hint={
                currentRegistry
                  ? '오른쪽 위 [새 PR]로 push 한 브랜치의 PR 을 만들 수 있어요.'
                  : '이 저장소는 프로젝트 레지스트리에 없어 여기서 PR 을 만들 수 없습니다.'
              }
            />
          ) : (
            <div className="prs__body">
              <PrList
                items={visible}
                selectedKey={selectedKey}
                onSelect={setSelectedKey}
                defaultBranchOf={defaultBranchOf}
              />
              {selected ? (
                <PrDetail
                  key={keyOf(selected)}
                  pr={selected}
                  defaultBranch={defaultBranchOf(selected.repo)}
                  hasToken={hasToken}
                  onMerged={onMerged}
                />
              ) : (
                <EmptyState
                  icon="git-pull-request"
                  message="PR 을 선택하세요"
                  hint="왼쪽 목록에서 고르면 커밋·변경 파일·충돌 여부와 머지 버튼이 여기 표시됩니다."
                />
              )}
            </div>
          )}
        </>
      )}

      {/* 새 PR 모달 — 저장소는 현재 탭으로 고정 (레지스트리 저장소에서만 열린다) */}
      {createOpen && currentRegistry && (
        <CreatePrModal
          repo={currentRegistry.repo}
          repoName={currentRegistry.name}
          projectDefault={currentRegistry.projectDefault}
          recentBase={config.recentBases[currentRegistry.repo]}
          onClose={() => setCreateOpen(false)}
          onCreated={onCreated}
        />
      )}
    </div>
  );
}
