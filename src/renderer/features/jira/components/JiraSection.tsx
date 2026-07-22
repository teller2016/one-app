import { useCallback, useEffect, useMemo, useState } from 'react';
import type { JiraIssue, JiraTransition } from '../../../../shared/types';
import { Badge } from '../../../components/Badge';
import { Banner } from '../../../components/Banner';
import { Collapsible } from '../../../components/Collapsible';
import { Icon } from '../../../components/Icon';
import type { IconName } from '../../../components/Icon';
import { RefreshButton } from '../../../components/RefreshButton';
import { SectionHeader } from '../../../components/SectionHeader';
import { Segment } from '../../../components/Segment';
import { useToast } from '../../../components/Toast';

import { isDone } from '../lib/issue';

const PROJECT_KEY = 'jira:project'; // 마지막 선택 프로젝트 탭 (localStorage)

/** 상태 → 뱃지 색 (해야 할 일=회색, 진행 중=노랑, 해결=초록) */
const badgeVariant = (it: JiraIssue) =>
  isDone(it) ? ('ok' as const) : it.statusCategory === 'indeterminate' ? ('busy' as const) : ('idle' as const);

/**
 * 타입 이름 → 표시 정보 (커스텀 타입 대응을 위해 키워드로 판별).
 * 그룹 정렬 순서: 에픽 → 스토리 → 작업 → 버그 → 하위 작업·sub-bug → 기타
 */
const typeInfo = (name: string): { rank: number; icon: IconName; tone: string } => {
  const n = name.toLowerCase();
  const isSub = n.includes('하위') || n.includes('sub');
  if (n.includes('버그') || n.includes('bug'))
    return { rank: isSub ? 4 : 3, icon: 'bug', tone: 'bug' };
  if (n.includes('에픽') || n.includes('epic')) return { rank: 0, icon: 'check', tone: 'epic' };
  if (n.includes('스토리') || n.includes('story')) return { rank: 1, icon: 'check', tone: 'story' };
  if (isSub) return { rank: 4, icon: 'corner-down-right', tone: 'sub' };
  return { rank: 2, icon: 'check', tone: 'task' };
};

/**
 * 우선순위 이름 → 표시 정보 (Jira 스타일 화살표 — 한국어·영문 기본 이름 키워드 판별).
 * '가장 높음/낮음'이 '높음/낮음'에도 걸리므로 highest/lowest 를 먼저 확인한다.
 */
const prioInfo = (name: string): { level: string; icon: IconName } | null => {
  const n = name.toLowerCase();
  if (/가장\s*높|highest|urgent|blocker/.test(n))
    return { level: 'highest', icon: 'chevrons-up' };
  if (/높|high|major/.test(n)) return { level: 'high', icon: 'chevron-up' };
  if (/보통|medium|normal/.test(n)) return { level: 'medium', icon: 'equal' };
  if (/가장\s*낮|lowest|trivial/.test(n))
    return { level: 'lowest', icon: 'chevrons-down' };
  if (/낮|low|minor/.test(n)) return { level: 'low', icon: 'chevron-down' };
  return null;
};

/** 이슈별 전환 메뉴 데이터 — 열 때마다 Jira 에서 조회 (프로젝트·워크플로우별로 다름) */
type MenuState = 'loading' | JiraTransition[] | { error: string };

/** 이슈 한 줄 — 티켓번호·티켓명 클릭 = 브라우저 열기, 키 우측 아이콘 = URL 복사, 뱃지 = 전환 메뉴 */
function IssueRow({
  issue,
  menu,
  transitioning,
  onToggleMenu,
  onTransition,
  onCopyLink,
}: {
  issue: JiraIssue;
  menu: MenuState | null; // null = 메뉴 닫힘
  transitioning: boolean;
  onToggleMenu: (key: string) => void;
  onTransition: (key: string, t: JiraTransition) => void;
  onCopyLink: (issue: JiraIssue) => void;
}) {
  const open = (): void => {
    void window.oneApp.openExternal(issue.url);
  };
  const linkTitle = [
    `${issue.key} — 브라우저에서 열기`,
    issue.priority && `우선순위 ${issue.priority}`,
  ]
    .filter(Boolean)
    .join(' · ');
  const prio = issue.priority ? prioInfo(issue.priority) : null;
  return (
    <div className="jira__row">
      {/* 키 + 복사 아이콘 묶음 — 행 gap 보다 좁게 붙인다 */}
      <span className="jira__keywrap">
        <button
          type="button"
          className="jira__key"
          onClick={open}
          title={linkTitle}
        >
          {issue.key}
        </button>
        <button
          type="button"
          className="icon-btn jira__copy"
          onClick={() => onCopyLink(issue)}
          title="이슈 링크 복사"
          aria-label={`${issue.key} 링크 복사`}
        >
          <Icon name="copy" size={12} />
        </button>
      </span>
      {prio && (
        <span
          className={`jira__prio jira__prio--${prio.level}`}
          title={`우선순위 ${issue.priority}`}
        >
          <Icon name={prio.icon} size={12} />
        </span>
      )}
      <button
        type="button"
        className="jira__title"
        onClick={open}
        title={linkTitle}
      >
        {issue.summary}
      </button>

      {/* 상태 뱃지 = 전환 메뉴 트리거 (Jira 의 상태 칩 클릭과 동일한 문법) */}
      <span className="jira__status">
        <button
          type="button"
          className="jira__status-btn"
          title="상태 변경"
          onClick={(e) => {
            e.stopPropagation();
            onToggleMenu(issue.key);
          }}
        >
          <Badge variant={badgeVariant(issue)}>{issue.status}</Badge>
          <span className="jira__status-chev">
            {transitioning ? (
              <span className="spinner jira__status-spin" />
            ) : (
              <Icon name="chevron-down" size={11} />
            )}
          </span>
        </button>

        {menu !== null && (
          <div className="jira__menu" onClick={(e) => e.stopPropagation()}>
            {menu === 'loading' ? (
              <div className="jira__menu-hint">전환 목록 불러오는 중…</div>
            ) : Array.isArray(menu) ? (
              menu.length === 0 ? (
                <div className="jira__menu-hint">가능한 전환이 없습니다</div>
              ) : (
                menu.map((t) => (
                  <button
                    type="button"
                    key={t.id}
                    className={
                      'jira__menu-item' +
                      (t.name === issue.status ? ' jira__menu-item--current' : '')
                    }
                    disabled={t.name === issue.status}
                    onClick={() => onTransition(issue.key, t)}
                  >
                    {t.name}
                    {t.name === issue.status && <Icon name="check" size={12} />}
                  </button>
                ))
              )
            ) : (
              <div className="jira__menu-hint jira__menu-hint--error">
                {menu.error}
              </div>
            )}
          </div>
        )}
      </span>
    </div>
  );
}

/** Jira 내 이슈 — 프로젝트 탭 + 타입별 그룹 카드 + 해결됨 접힘 그룹. */
export function JiraSection() {
  const [issues, setIssues] = useState<JiraIssue[]>([]);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [project, setProject] = useState<string>(
    () => localStorage.getItem(PROJECT_KEY) ?? 'all',
  );
  // 전환 메뉴 상태 — 한 번에 하나만 열림
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const [menuState, setMenuState] = useState<MenuState>('loading');
  const [transitioningKey, setTransitioningKey] = useState<string | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    const res = await window.oneApp.jira.list();
    setConfigured(res.configured);
    if (res.ok && res.issues) {
      setIssues(res.issues);
      setError('');
    } else {
      setError(res.error ?? '이슈를 불러오지 못했습니다.');
    }
    setLoading(false);
  }, []);

  // 최초 로드 + 2분 자동 새로고침 (PR 섹션과 동일 주기)
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 120_000);
    return () => clearInterval(timer);
  }, [load]);

  // 메뉴 토글 — 열 때마다 그 이슈의 가능한 전환을 새로 조회
  const toggleMenu = async (key: string) => {
    if (menuKey === key) {
      setMenuKey(null);
      return;
    }
    setMenuKey(key);
    setMenuState('loading');
    const res = await window.oneApp.jira.getTransitions(key);
    if (res.ok && res.transitions) setMenuState(res.transitions);
    else setMenuState({ error: res.error ?? '전환 목록을 불러오지 못했습니다' });
  };

  // 메뉴 밖 클릭·Escape 로 닫기
  useEffect(() => {
    if (!menuKey) return;
    const close = () => setMenuKey(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuKey]);

  // 이슈 링크 클립보드 복사
  const copyLink = async (issue: JiraIssue) => {
    try {
      await navigator.clipboard.writeText(issue.url);
      toast(`${issue.key} 링크를 복사했습니다`);
    } catch {
      toast('복사에 실패했습니다', 'fail');
    }
  };

  // 전환 실행 — 성공 시 목록 갱신 (그룹 이동 반영)
  const handleTransition = async (key: string, t: JiraTransition) => {
    setMenuKey(null);
    setTransitioningKey(key);
    const res = await window.oneApp.jira.transition(key, t.id);
    if (res.ok) {
      toast(`${key} → ${t.name}`);
      await load();
    } else {
      toast(res.error ?? '전환에 실패했습니다', 'fail');
    }
    setTransitioningKey(null);
  };

  // 프로젝트 목록 (이슈 많은 순) — 탭은 프로젝트가 2개 이상일 때만 노출
  const projects = useMemo(() => {
    const count = new Map<string, number>();
    for (const it of issues) {
      count.set(it.projectKey, (count.get(it.projectKey) ?? 0) + 1);
    }
    return [...count.entries()].sort((a, b) => b[1] - a[1]);
  }, [issues]);

  // 저장된 선택이 목록에서 사라졌으면 전체로 복귀
  const effectiveProject =
    project !== 'all' && !projects.some(([k]) => k === project) ? 'all' : project;

  const changeProject = (next: string) => {
    setProject(next);
    localStorage.setItem(PROJECT_KEY, next);
  };

  const visible =
    effectiveProject === 'all'
      ? issues
      : issues.filter((it) => it.projectKey === effectiveProject);

  // 해결됨은 타입 그룹에서 빼서 하단 접힘 그룹으로
  const open = visible.filter((it) => !isDone(it));
  const done = visible.filter(isDone);

  // 타입별 그룹핑 — 그룹은 rank 순, 그룹 안은 API 정렬(최신 갱신순) 유지
  const groups = useMemo(() => {
    const map = new Map<string, JiraIssue[]>();
    for (const it of open) {
      const list = map.get(it.issueType) ?? [];
      list.push(it);
      map.set(it.issueType, list);
    }
    return [...map.entries()]
      .map(([type, items]) => ({ type, items, ...typeInfo(type) }))
      .sort((a, b) => a.rank - b.rank || a.type.localeCompare(b.type));
  }, [open]);

  return (
    <div className="section">
      <div className="jira__head">
        <SectionHeader
          title="Jira"
          icon={<Icon name="clipboard-list" size={18} />}
          sub="내게 할당된 미해결 이슈입니다. 클릭하면 브라우저에서 열려요."
        />
        <RefreshButton
          size={14}
          spinning={loading}
          onClick={() => void load()}
          title="이슈 목록 새로고침"
        />
      </div>

      {!configured && (
        <Banner variant="info">
          환경설정 → 연동에서 Jira 주소·이메일·API 토큰을 입력하면 내 이슈가
          표시됩니다.
        </Banner>
      )}
      {configured && error && <Banner variant="danger">{error}</Banner>}

      {projects.length > 1 && (
        <div className="jira__tabs">
          <Segment
            options={[
              { value: 'all', label: `전체 ${issues.length}` },
              ...projects.map(([k, c]) => ({ value: k, label: `${k} ${c}` })),
            ]}
            value={effectiveProject}
            onChange={changeProject}
          />
        </div>
      )}

      {loading && issues.length === 0 ? (
        <p className="hint">불러오는 중...</p>
      ) : visible.length === 0 && configured && !error ? (
        <div className="empty-state">
          <span className="empty-state__icon">
            <Icon name="check" size={20} />
          </span>
          <p>미해결 이슈가 없습니다. 깔끔하네요!</p>
        </div>
      ) : (
        <>
          {groups.map(({ type, items, icon, tone }) => (
            <div className="jira__group" key={type}>
              <div className="jira__group-head">
                <span className={`jira__type jira__type--${tone}`}>
                  <Icon name={icon} size={12} />
                </span>
                <span className="jira__group-name">{type}</span>
                <span className="jira__group-count">{items.length}</span>
              </div>
              <div className="jira__card">
                {items.map((it) => (
                  <IssueRow
                    issue={it}
                    key={it.key}
                    menu={menuKey === it.key ? menuState : null}
                    transitioning={transitioningKey === it.key}
                    onToggleMenu={(k) => void toggleMenu(k)}
                    onTransition={(k, t) => void handleTransition(k, t)}
                    onCopyLink={(it2) => void copyLink(it2)}
                  />
                ))}
              </div>
            </div>
          ))}

          {done.length > 0 && (
            <Collapsible
              title={`해결됨 ${done.length}`}
              icon={
                <span className="jira__done-check">
                  <Icon name="check" size={14} />
                </span>
              }
              storageKey="jira:group:done"
            >
              <div className="jira__done">
                {done.map((it) => (
                  <IssueRow
                    issue={it}
                    key={it.key}
                    menu={menuKey === it.key ? menuState : null}
                    transitioning={transitioningKey === it.key}
                    onToggleMenu={(k) => void toggleMenu(k)}
                    onTransition={(k, t) => void handleTransition(k, t)}
                    onCopyLink={(it2) => void copyLink(it2)}
                  />
                ))}
              </div>
            </Collapsible>
          )}
        </>
      )}
    </div>
  );
}
