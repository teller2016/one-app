import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  JiraIssue,
  JiraTransition,
  TerminalSessionInfo,
} from '../../../../shared/types';
import { Badge } from '../../../components/Badge';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { Collapsible } from '../../../components/Collapsible';
import { Icon } from '../../../components/Icon';
import type { IconName } from '../../../components/Icon';
import { RefreshButton } from '../../../components/RefreshButton';
import { SectionHeader } from '../../../components/SectionHeader';
import { Segment } from '../../../components/Segment';
import { StatusDot } from '../../../components/StatusDot';
import { Tooltip } from '../../../components/Tooltip';
import { useToast } from '../../../components/Toast';
import { EmptyState } from '../../../components/EmptyState';
import { errMsg } from '../../../lib/errMsg';
import { openTerminalSession } from '../../../lib/sectionNav';
import { usePolling } from '../../../lib/usePolling';
import { useCopy } from '../../../lib/useCopy';

import { isDone, statusBadgeVariant } from '../lib/issue';
import { AddTicketModal } from './AddTicketModal';
import { JiraDetailPanel } from './JiraDetailPanel';
import { JiraReportPanel } from './JiraReportPanel';
import { StartWorkModal } from './StartWorkModal';
import { WeekActivityPanel } from './WeekActivityPanel';

/** 세션 제목 앞머리의 티켓 키 (작업 시작 시 제목을 키로 준다) */
const KEY_RE = /^[A-Z][A-Z0-9]*-\d+/;

const PROJECT_KEY = 'jira:project'; // 마지막 선택 프로젝트 탭 (localStorage)
const VIEW_KEY = 'jira:view'; // 마지막 선택 화면 (내 이슈 / 주간 / 보고)

/** 섹션이 보여줄 화면 — 내게 할당된 목록 · 한 주 동안 내가 손댄 티켓 · 프로젝트별 보고 목록 */
type View = 'mine' | 'week' | 'report';
const isView = (v: string | null): v is View => v === 'mine' || v === 'week' || v === 'report';

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

/**
 * 이슈 한 줄 — 티켓명 클릭 = 앱 내 상세 패널, 티켓번호 클릭 = 브라우저 열기, 뱃지 = 전환 메뉴.
 * ⚠️ memo 다 — 터미널 세션 브로드캐스트가 잦아(출력·상태 변화마다) 목록 전체가 다시
 * 그려지던 것을 막는다. 부모가 넘기는 콜백은 전부 useCallback 으로 고정돼 있어야 한다.
 */
const IssueRow = memo(function IssueRow({
  issue,
  menu,
  transitioning,
  workSession,
  onToggleMenu,
  onTransition,
  onCopyLink,
  onOpenDetail,
  onStartWork,
  onOpenSession,
  onUnpin,
}: {
  issue: JiraIssue;
  menu: MenuState | null; // null = 메뉴 닫힘
  transitioning: boolean;
  /** 이 티켓으로 돌고 있는 femc 세션 (없으면 null) */
  workSession: TerminalSessionInfo | null;
  onToggleMenu: (key: string) => void;
  onTransition: (key: string, t: JiraTransition) => void;
  onCopyLink: (issue: JiraIssue) => void;
  onOpenDetail: (key: string) => void;
  onStartWork: (issue: JiraIssue) => void;
  onOpenSession: (session: TerminalSessionInfo) => void;
  /** 직접 추가한 티켓을 목록에서 빼기 (핀 클릭) */
  onUnpin: (key: string) => void;
}) {
  const open = (): void => {
    void window.oneApp.openExternal(issue.url);
  };
  const detailTitle = [
    `${issue.key} — 여기서 바로 보기`,
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
          title={`${issue.key} — 브라우저에서 열기`}
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
        {/* 직접 추가한 티켓 — 평소엔 핀, 올리면 ✕ (구분 표시와 제거를 한 자리에서) */}
        {issue.pinned && (
          <button
            type="button"
            className="icon-btn jira__pin"
            onClick={() => onUnpin(issue.key)}
            title={`${issue.key} — 직접 추가한 티켓 (누르면 목록에서 뺍니다)`}
            aria-label={`${issue.key} 목록에서 빼기`}
          >
            <Icon name="pin" size={12} className="jira__pin-on" />
            <Icon name="x" size={12} className="jira__pin-off" />
          </button>
        )}
      </span>
      {prio && (
        <span
          className={`jira__prio jira__prio--${prio.level}`}
          title={`우선순위 ${issue.priority}`}
        >
          <Icon name={prio.icon} size={14} />
        </span>
      )}
      <button
        type="button"
        className="jira__title"
        onClick={() => onOpenDetail(issue.key)}
        title={detailTitle}
      >
        {issue.summary}
      </button>

      {/* 상위 항목 칩 — 부모 이슈 제목 (클릭 = 브라우저에서 부모 열기) */}
      {issue.parentKey && (
        <button
          type="button"
          className="jira__parent"
          onClick={() =>
            void window.oneApp.openExternal(
              issue.url.replace(/[^/]+$/, issue.parentKey ?? ''),
            )
          }
          title={`상위 항목 ${issue.parentKey}${
            issue.parentSummary ? ` — ${issue.parentSummary}` : ''
          } · 브라우저에서 열기`}
        >
          <Icon name="corner-down-right" size={11} className="jira__parent-icon" />
          <span className="jira__parent-text">
            {issue.parentSummary ?? issue.parentKey}
          </span>
        </button>
      )}

      {/* 이 티켓으로 돌고 있는 femc 세션 — 누르면 그 터미널로 간다 */}
      {workSession && (
        <button
          type="button"
          className="jira__work-chip"
          onClick={() => onOpenSession(workSession)}
          title={`${workSession.title} — ${
            workSession.status === 'busy' ? '작업 중' : '입력 대기'
          } · 터미널로 이동`}
        >
          <StatusDot status={workSession.status === 'busy' ? 'busy' : 'ok'} />
          femc
        </button>
      )}

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
          <Badge variant={statusBadgeVariant(issue)}>{issue.status}</Badge>
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

      {/* 작업 시작 — 위치를 고르고 femc 세션으로 넘긴다 (행 맨 끝 고정 자리) */}
      <Tooltip label="작업 시작">
        <button
          type="button"
          className="icon-btn jira__work"
          aria-label={`${issue.key} 작업 시작`}
          onClick={() => onStartWork(issue)}
        >
          <Icon name="play" size={13} />
        </button>
      </Tooltip>
    </div>
  );
});

/** Jira 내 이슈 — 프로젝트 탭 + 타입별 그룹 카드 + 해결됨 접힘 그룹. */
export function JiraSection() {
  const [view, setView] = useState<View>(() => {
    const saved = localStorage.getItem(VIEW_KEY);
    return isView(saved) ? saved : 'mine';
  });
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
  // 전환 목록 요청 순번 — 메뉴를 옮기거나 닫으면 올려서 늦게 온 응답을 버린다
  const menuSeq = useRef(0);
  const [transitioningKey, setTransitioningKey] = useState<string | null>(null);
  // 상세 패널 — 닫을 때 detailKey 를 남겨둬야 슬라이드아웃 중 내용이 사라지지 않는다
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  // 작업 시작 모달 — 대상 이슈 (닫히면 null)
  const [workIssue, setWorkIssue] = useState<JiraIssue | null>(null);
  // 티켓 추가 모달
  const [addOpen, setAddOpen] = useState(false);
  // 직접 추가한 티켓만 조회에 실패했을 때 (담당 목록은 정상)
  const [addedError, setAddedError] = useState('');
  const toast = useToast();

  // 터미널 세션 — 어떤 티켓이 이미 돌고 있는지 표시하려고 구독한다(main 이 상태까지 실어 준다)
  const [sessions, setSessions] = useState<TerminalSessionInfo[]>([]);
  // ⚠️ 이 화면이 쓰는 건 femc 세션의 id·제목·상태·cwd 뿐인데, 세션 브로드캐스트는
  // 그 밖의 변화로도 자주 온다. 그대로 담으면 갱신마다 목록 전체가 다시 그려진다
  // — 관심 있는 값이 같으면 이전 배열을 유지해 memo 된 행을 지킨다.
  const sessionsKeyRef = useRef('');
  const applySessions = useCallback((list: TerminalSessionInfo[]) => {
    const key = list
      .filter((s) => s.agentId === 'femc')
      .map((s) => `${s.id}|${s.title}|${s.status}|${s.cwd}`)
      .join('\n');
    if (key === sessionsKeyRef.current) return;
    sessionsKeyRef.current = key;
    setSessions(list);
  }, []);
  useEffect(() => {
    const api = window.oneApp?.terminal;
    if (!api) return;
    void api.list().then(applySessions);
    return api.onSessions((list) => {
      if (list) applySessions(list);
      else void api.list().then(applySessions); // payload 미탑재(구버전 main) 폴백
    });
  }, [applySessions]);

  /**
   * 티켓 키 → 그 티켓으로 시작한 femc 세션.
   * ⚠️ 매칭 기준은 **세션 제목**이다 — 사용자가 터미널에서 이름을 바꾸면 칩이 사라진다
   * (세션 자체는 멀쩡하다). 세션 타입에 티켓 필드를 더하면 sidecar 스키마까지 번져서
   * 표시 하나를 위해 감수할 비용이 아니라고 봤다.
   */
  const workByKey = useMemo(() => {
    const map = new Map<string, TerminalSessionInfo>();
    for (const s of sessions) {
      if (s.agentId !== 'femc') continue;
      const hit = KEY_RE.exec(s.title.trim().toUpperCase());
      if (!hit) continue;
      const cur = map.get(hit[0]);
      // 같은 티켓 세션이 여럿이면 내 입력을 기다리는 쪽을 보여준다
      if (!cur || (cur.status !== 'waiting' && s.status === 'waiting')) {
        map.set(hit[0], s);
      }
    }
    return map;
  }, [sessions]);

  const openSession = useCallback((s: TerminalSessionInfo) => {
    openTerminalSession({ sessionId: s.id, cwd: s.cwd });
  }, []);

  // force — 수동 새로고침은 main 의 TTL 캐시를 우회해 항상 최신을 본다
  const load = useCallback(async (force = false) => {
    setLoading(true);
    try {
      const res = await window.oneApp.jira.list(force);
      setConfigured(res.configured);
      if (res.ok && res.issues) {
        setIssues(res.issues);
        setError('');
      } else {
        setError(res.error ?? '이슈를 불러오지 못했습니다.');
      }
      // 추가 티켓 조회만 실패한 경우 — 본 목록은 살아 있으므로 따로 알린다
      setAddedError(res.addedError ?? '');
    } catch (err) {
      // invoke 거부(핸들러 미등록·폰 WS 끊김)도 잡는다 — 안 잡으면 loading 이 영영 남는다
      setError(errMsg(err, '이슈를 불러오지 못했습니다.'));
      setAddedError(''); // 이전 조회의 추가 티켓 경고가 새 실패 배너와 겹치지 않게
    } finally {
      setLoading(false);
    }
  }, []);

  // 최초 로드 + 2분 자동 새로고침 (PR 섹션과 동일 주기).
  // 주간 화면을 보는 동안은 멈춘다 — 안 보이는 목록을 폴링할 이유가 없고,
  // 돌아오면 훅이 즉시 1회 따라잡는다(주간 화면은 자체 수동 새로고침).
  usePolling(load, 120_000, { enabled: view === 'mine' });

  // 메뉴 토글 — 열 때마다 그 이슈의 가능한 전환을 새로 조회.
  // ⚠️ 열린 메뉴 키는 ref 로 읽는다 — 의존성에 넣으면 메뉴를 열고 닫을 때마다 콜백이
  // 새로 만들어져 memo 된 행이 전부 다시 그려진다.
  const menuKeyRef = useRef(menuKey);
  menuKeyRef.current = menuKey;
  const toggleMenu = useCallback(async (key: string) => {
    if (menuKeyRef.current === key) {
      menuSeq.current += 1; // 진행 중인 조회 결과를 버린다
      setMenuKey(null);
      return;
    }
    const seq = menuSeq.current + 1;
    menuSeq.current = seq;
    setMenuKey(key);
    setMenuState('loading');
    const res = await window.oneApp.jira.getTransitions(key);
    // 다른 이슈 메뉴로 넘어갔거나 메뉴를 닫았으면 이 응답은 버린다
    // (안 그러면 지금 열린 메뉴에 남의 이슈 전환 목록이 뜬다)
    if (seq !== menuSeq.current) return;
    if (res.ok && res.transitions) setMenuState(res.transitions);
    else setMenuState({ error: res.error ?? '전환 목록을 불러오지 못했습니다' });
  }, []);

  // 메뉴 밖 클릭·Escape 로 닫기
  useEffect(() => {
    if (!menuKey) return;
    const close = () => {
      menuSeq.current += 1; // 진행 중인 조회 결과를 버린다
      setMenuKey(null);
    };
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

  // 직접 추가한 티켓 빼기 — 되돌리기 쉬운 동작이라 확인창 없이 바로 처리한다
  const unpin = useCallback(
    async (key: string) => {
      const res = await window.oneApp.jira.added.remove(key);
      if (!res.ok) {
        toast(res.error ?? '목록에서 빼지 못했습니다', 'fail');
        return;
      }
      toast(`${key} 를 목록에서 뺐습니다`);
      await load(true);
    },
    [load, toast]
  );

  // 이슈 링크 클립보드 복사
  const copy = useCopy();
  const copyLink = useCallback(
    (issue: JiraIssue) => {
      void copy(issue.url, { success: `${issue.key} 링크를 복사했습니다` });
    },
    [copy],
  );

  // 상세 패널 열기 — 제목 클릭 (같은 이슈를 다시 열어도 새로 조회)
  const openDetail = useCallback((key: string) => {
    setDetailKey(key);
    setDetailOpen(true);
  }, []);

  // 전환 실행 — 성공 시 목록 갱신 (그룹 이동 반영)
  const handleTransition = useCallback(
    async (key: string, t: JiraTransition) => {
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
    },
    [load, toast],
  );

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

  const changeView = (next: View) => {
    setView(next);
    localStorage.setItem(VIEW_KEY, next);
  };

  // ⚠️ 파생 목록은 전부 memo 다 — 매 렌더 새 배열이면 아래 groups 의 useMemo 가
  // 항상 무효가 되고, 세션 갱신 같은 무관한 리렌더에도 그룹핑이 다시 돈다.
  const visible = useMemo(
    () =>
      effectiveProject === 'all'
        ? issues
        : issues.filter((it) => it.projectKey === effectiveProject),
    [issues, effectiveProject],
  );

  // 해결됨은 타입 그룹에서 빼서 하단 접힘 그룹으로
  const open = useMemo(() => visible.filter((it) => !isDone(it)), [visible]);
  const done = useMemo(() => visible.filter(isDone), [visible]);

  // 직접 추가한 티켓은 타입 그룹 위 별도 그룹 — 내 담당이 아니라 성격이 다르고,
  // 빼는 조작도 한군데 모인다. (해결되면 아래 '해결됨' 그룹으로 함께 내려간다)
  const pinnedOpen = useMemo(() => open.filter((it) => it.pinned), [open]);
  const typedOpen = useMemo(() => open.filter((it) => !it.pinned), [open]);

  // 타입별 그룹핑 — 그룹은 rank 순, 그룹 안은 API 정렬(최신 갱신순) 유지
  const groups = useMemo(() => {
    const map = new Map<string, JiraIssue[]>();
    for (const it of typedOpen) {
      const list = map.get(it.issueType) ?? [];
      list.push(it);
      map.set(it.issueType, list);
    }
    return [...map.entries()]
      .map(([type, items]) => ({ type, items, ...typeInfo(type) }))
      .sort((a, b) => a.rank - b.rank || a.type.localeCompare(b.type));
  }, [typedOpen]);

  return (
    <div className="section jira">
      <div className="jira__head">
        <SectionHeader
          title="Jira"
          icon={<Icon name="clipboard-list" size={18} />}
          sub={
            view === 'week'
              ? '한 주 동안 내가 손댄 티켓입니다. 상태 전환·담당·작업시간 기록을 기준으로 모읍니다.'
              : view === 'report'
                ? '프로젝트·기간으로 티켓을 모아 보고용 목록을 만듭니다. 필터한 뒤 원하는 형식으로 복사하세요.'
                : '내게 할당된 미해결 이슈입니다. 제목을 클릭하면 여기서 바로 볼 수 있어요.'
          }
        />
        {/* 티켓 추가·새로고침은 내 이슈 화면 전용 — 주간·보고 화면은 자체 툴바를 갖는다 */}
        {view === 'mine' && (
          <div className="jira__head-actions">
            {/* 담당으로 안 날아온 티켓을 주소로 끌어온다 */}
            <Button variant="ghost" size="sm" onClick={() => setAddOpen(true)}>
              <Icon name="plus" size={13} />
              티켓
            </Button>
            <RefreshButton
              size={14}
              spinning={loading}
              onClick={() => void load(true)}
              title="이슈 목록 새로고침"
            />
          </div>
        )}
      </div>

      {/* 화면 전환 — 내게 할당된 목록 · 한 주 동안 내가 손댄 티켓 · 프로젝트별 보고 */}
      <div className="jira__views">
        <Segment<View>
          options={[
            { value: 'mine', label: '내 이슈' },
            { value: 'week', label: '주간' },
            { value: 'report', label: '보고' },
          ]}
          value={view}
          onChange={changeView}
        />
      </div>

      {view === 'week' && <WeekActivityPanel onOpenDetail={openDetail} />}
      {view === 'report' && <JiraReportPanel onOpenDetail={openDetail} />}

      {view === 'mine' && !configured && (
        <Banner variant="info">
          환경설정 → 연동에서 Jira 주소·이메일·API 토큰을 입력하면 내 이슈가
          표시됩니다.
        </Banner>
      )}
      {view === 'mine' && configured && error && (
        <Banner variant="danger">{error}</Banner>
      )}
      {/* 추가 티켓만 실패 — 담당 목록은 정상이므로 경고로 낮춰 알린다 */}
      {view === 'mine' && addedError && (
        <Banner variant="warning">직접 추가한 티켓을 못 불러왔습니다 — {addedError}</Banner>
      )}

      {view === 'mine' && projects.length > 1 && (
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

      {/* 내 이슈 목록 — 주간·보고 화면에서는 그리지 않는다(위의 패널이 본문) */}
      {view !== 'mine' ? null : loading && issues.length === 0 ? (
        <p className="hint">불러오는 중...</p>
      ) : visible.length === 0 && configured && !error ? (
        <EmptyState icon="check" message="미해결 이슈가 없습니다. 깔끔하네요!" />
      ) : (
        <>
          {/* 직접 추가한 티켓 — 담당 그룹들보다 위 */}
          {pinnedOpen.length > 0 && (
            <div className="jira__group">
              <div className="jira__group-head">
                <span className="jira__type jira__type--pinned">
                  <Icon name="pin" size={12} />
                </span>
                <span className="jira__group-name">직접 추가</span>
                <span className="jira__group-count">{pinnedOpen.length}</span>
              </div>
              <div className="jira__card">
                {pinnedOpen.map((it) => (
                  <IssueRow
                    issue={it}
                    key={it.key}
                    menu={menuKey === it.key ? menuState : null}
                    transitioning={transitioningKey === it.key}
                    workSession={workByKey.get(it.key) ?? null}
                    onToggleMenu={toggleMenu}
                    onTransition={handleTransition}
                    onCopyLink={copyLink}
                    onOpenDetail={openDetail}
                    onStartWork={setWorkIssue}
                    onOpenSession={openSession}
                    onUnpin={unpin}
                  />
                ))}
              </div>
            </div>
          )}

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
                    workSession={workByKey.get(it.key) ?? null}
                    onToggleMenu={toggleMenu}
                    onTransition={handleTransition}
                    onCopyLink={copyLink}
                    onOpenDetail={openDetail}
                    onStartWork={setWorkIssue}
                    onOpenSession={openSession}
                    onUnpin={unpin}
                  />
                ))}
              </div>
            </div>
          ))}

          {done.length > 0 && (
            <div className="jira__done-zone">
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
                      workSession={workByKey.get(it.key) ?? null}
                      onToggleMenu={toggleMenu}
                      onTransition={handleTransition}
                      onCopyLink={copyLink}
                      onOpenDetail={openDetail}
                      onStartWork={setWorkIssue}
                      onOpenSession={openSession}
                      onUnpin={unpin}
                    />
                  ))}
                </div>
              </Collapsible>
            </div>
          )}
        </>
      )}

      {/* 이슈 상세 패널 — 오른쪽 슬라이드 (닫힘 애니메이션을 위해 항상 마운트) */}
      <JiraDetailPanel
        issueKey={detailKey}
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        onStartWork={(detail) =>
          setWorkIssue({
            key: detail.key,
            projectKey: detail.key.split('-')[0],
            summary: detail.summary,
            status: detail.status,
            statusCategory: detail.statusCategory,
            issueType: detail.issueType,
            parentKey: null,
            parentSummary: null,
            priority: detail.priority,
            updatedAt: detail.updated,
            url: detail.url,
          })
        }
      />

      {/* 티켓 추가 — 담당으로 안 날아온 이슈를 주소·번호로 목록에 끌어온다 */}
      {addOpen && (
        <AddTicketModal
          onAdded={() => void load(true)}
          onClose={() => setAddOpen(false)}
        />
      )}

      {/* 작업 시작 — 위치 선택 후 femc 세션으로 (재클릭도 항상 모달) */}
      {workIssue && (
        <StartWorkModal
          issueKey={workIssue.key}
          summary={workIssue.summary}
          projectKey={workIssue.projectKey}
          statusCategory={workIssue.statusCategory}
          onClose={() => setWorkIssue(null)}
        />
      )}
    </div>
  );
}
