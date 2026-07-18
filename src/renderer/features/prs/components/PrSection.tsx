import { useCallback, useEffect, useState } from 'react';
import type { PrItem, PrListResult, PrsConfig } from '../../../../shared/types';
import { SectionHeader } from '../../../components/SectionHeader';
import { Icon } from '../../../components/Icon';
import { Badge } from '../../../components/Badge';
import { Banner } from '../../../components/Banner';
import { RefreshButton } from '../../../components/RefreshButton';
import { TextLink } from '../../../components/TextLink';
import { Button } from '../../../components/Button';
import { useToast } from '../../../components/Toast';
import { useConfirm } from '../../../components/ConfirmDialog';
import { QuickPr } from './QuickPr';
import { CreatePrModal } from './CreatePrModal';
import { MergeModal } from './MergeModal';

/** "5분 전" 형태 상대 시간 */
const rel = (ts?: number) => {
  if (!ts) return '';
  const min = Math.floor((Date.now() - ts) / 60000);
  if (min < 1) return '방금 전';
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}일 전`;
  return new Date(ts).toLocaleDateString('ko-KR');
};

const orgOf = (pr: PrItem) => pr.repo.split('/')[0];

/**
 * PR 섹션 — push → PR 생성 → 머지 루프를 앱에서 끝낸다.
 * 상단 빠른 PR(저장소별 최근 브랜치 → 생성) + 열린 PR 목록(머지 버튼).
 */
export function PrSection() {
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<PrListResult | null>(null);
  const [config, setConfig] = useState<PrsConfig>({ excludedOrgs: [], repos: [] });
  const [hasToken, setHasToken] = useState(false);
  const [createTarget, setCreateTarget] = useState<{ repo: string; head: string } | null>(null);
  const [mergeTarget, setMergeTarget] = useState<{
    repo: string;
    number: number;
    title: string;
  } | null>(null);
  const [, setClock] = useState(0); // "n분 전" 갱신용 1분 틱
  const toast = useToast();
  const confirmDialog = useConfirm();

  // 머지 직후 — PR 제목에서 Jira 이슈 키를 추출해 해결됨 전환을 제안한다
  // (빠른 PR 이 브랜치명의 이슈 키를 제목에 넣으므로 문자열 패턴 매칭으로 충분)
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

  // 진입 시 설정·토큰 여부 로드 + 조회 + 2분 주기 자동 새로고침 + 1분 시계 틱
  useEffect(() => {
    window.oneApp.prs.getConfig().then(setConfig);
    window.oneApp.settings.get().then((s) => setHasToken(s.hasGiteaToken));
    void load();
    const poll = setInterval(() => void load(), 120_000);
    const clock = setInterval(() => setClock((t) => t + 1), 60_000);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [load]);

  const saveConfig = (next: PrsConfig) => {
    setConfig(next);
    void window.oneApp.prs.setConfig(next);
  };

  // 조직 제외 토글 — 저장은 메인(userData)에, 알림 폴러도 같은 값을 쓴다
  const toggleOrg = (org: string) => {
    const set = new Set(config.excludedOrgs);
    if (set.has(org)) set.delete(org);
    else set.add(org);
    saveConfig({ ...config, excludedOrgs: [...set] });
  };

  const prs: PrItem[] = result?.prs ?? [];
  const excluded = new Set(config.excludedOrgs);
  const orgs = [...new Set(prs.map(orgOf))].sort();
  const visible = prs.filter((pr) => !excluded.has(orgOf(pr)));
  const groups = [...new Set(visible.map(orgOf))]
    .sort()
    .map((org) => ({ org, items: visible.filter((pr) => orgOf(pr) === org) }));

  return (
    <div className="section">
      <div className="prs__head">
        <SectionHeader
          icon={<Icon name="git-pull-request" size={18} />}
          title="PR"
          sub="push 한 브랜치로 PR 을 만들고, 여기서 바로 머지까지 끝냅니다."
        />
        <RefreshButton
          bordered
          size={14}
          spinning={loading}
          onClick={() => void load()}
          disabled={loading}
          title="PR 목록 새로고침"
        />
      </div>

      {result && !result.configured ? (
        <Banner variant="info">
          <b>환경설정 → 연동</b>에 Gitea 주소를 입력하면 PR 기능이 활성화됩니다.
        </Banner>
      ) : (
        <>
          {!hasToken && (
            <Banner>
              PR <b>생성·머지</b>에는 Gitea 토큰이 필요합니다 —{' '}
              <b>환경설정 → 연동</b>에 토큰을 저장하세요. (목록 조회는 지금도
              가능)
            </Banner>
          )}

          {/* 빠른 PR — push 한 브랜치 → develop PR 생성 */}
          <QuickPr
            repos={config.repos}
            onAddRepo={(repo) =>
              !config.repos.includes(repo) &&
              saveConfig({ ...config, repos: [...config.repos, repo] })
            }
            onRemoveRepo={(repo) =>
              saveConfig({
                ...config,
                repos: config.repos.filter((r) => r !== repo),
              })
            }
            onCreate={(repo, head) => setCreateTarget({ repo, head })}
          />

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
          ) : visible.length === 0 ? (
            <div className="empty-state">
              <span className="empty-state__icon">
                <Icon name="check" size={20} />
              </span>
              <p>
                {prs.length > 0
                  ? '필터에 해당하는 열린 PR 이 없습니다.'
                  : '열린 PR 이 없습니다.'}
              </p>
              <p className="hint">
                위 [빠른 PR]에서 브랜치를 골라 PR 을 만들 수 있어요.
              </p>
            </div>
          ) : (
            groups.map(({ org, items }) => (
              <div key={org} className="prs__group">
                <div className="prs__group-head">
                  <span className="prs__group-name">{org}</span>
                  <span className="prs__group-count">{items.length}</span>
                </div>
                <div className="prs__list">
                  {items.map((pr) => (
                    <div className="prs__row" key={`${pr.repo}#${pr.number}`}>
                      <div className="prs__main">
                        <span className="prs__repo">
                          {pr.repo.split('/').pop()}
                        </span>
                        <TextLink
                          className="prs__title"
                          onClick={() => void window.oneApp.openExternal(pr.url)}
                          title={`${pr.repo} #${pr.number} — 브라우저에서 열기`}
                        >
                          {pr.title}
                        </TextLink>
                        <span className="prs__number">#{pr.number}</span>
                      </div>
                      <div className="prs__meta">
                        {pr.approvals != null && pr.approvals > 0 ? (
                          <Badge variant="ok">승인 {pr.approvals}</Badge>
                        ) : (
                          <Badge variant="idle">리뷰 대기</Badge>
                        )}
                        <span className="prs__sub">
                          {pr.author}
                          {pr.createdAt ? ` · ${rel(pr.createdAt)}` : ''}
                        </span>
                        {hasToken && (
                          <Button
                            size="sm"
                            className="prs__merge-btn"
                            onClick={() =>
                              setMergeTarget({
                                repo: pr.repo,
                                number: pr.number,
                                title: pr.title,
                              })
                            }
                          >
                            머지
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </>
      )}

      {/* PR 생성 모달 — 성공 시 곧바로 머지 모달로 이어간다 */}
      {createTarget && (
        <CreatePrModal
          repo={createTarget.repo}
          head={createTarget.head}
          onClose={() => setCreateTarget(null)}
          onCreated={(number, title) => {
            setCreateTarget(null);
            toast(`PR #${number} 생성됨`);
            void load();
            setMergeTarget({ repo: createTarget.repo, number, title });
          }}
        />
      )}

      {/* 머지 모달 */}
      {mergeTarget && (
        <MergeModal
          repo={mergeTarget.repo}
          number={mergeTarget.number}
          title={mergeTarget.title}
          onClose={() => setMergeTarget(null)}
          onMerged={() => {
            setMergeTarget(null);
            toast(`#${mergeTarget.number} 머지 완료`);
            void load();
            void offerJiraResolve(mergeTarget.title);
          }}
        />
      )}
    </div>
  );
}
