import { ConfirmProvider } from "../components/ConfirmDialog";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { Icon } from "../components/Icon";
import { Sidebar, SidebarSection } from "../components/Sidebar";
import { ToastProvider, useToast } from "../components/Toast";
import { ApplinkSection } from "../features/applink";
import { AttendanceWidget } from "../features/attendance";
import { DeploySection } from "../features/deploy";
import { JiraSection, isDone } from "../features/jira";
import { MailWidget } from "../features/mail";
import { MirrorWidget } from "../features/mirror";
import { ProjectsSection } from "../features/projects";
import { PrSection } from "../features/prs";
import { ScheduleSection } from "../features/schedule";
import { SettingsSection } from "../features/settings";
import { TerminalSection } from "../features/terminal";
import { VpnWidget } from "../features/vpn";
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import {
  isSessionOnScreen,
  openTerminalSession,
  setSectionNavigator,
} from "../lib/sectionNav";
import {
  runSectionBack,
  runSectionForward,
  useHasSectionBack,
  useHasSectionForward,
} from "../lib/sectionBack";
import { usePolling } from "../lib/usePolling";
import type { ReactNode } from "react";
import type { TerminalSessionInfo } from "../../shared/types";

// ⚠️ 첫 화면(터미널)과 무관하면서 무거운 의존성을 끌고 오는 섹션은 **필요할 때 받는다** —
// 주간보고의 chart.js, Nightwatch 의 react-markdown+remark-gfm, 결재 폼이 초기 파싱에서 빠진다.
// 대신 첫 페인트 뒤 유휴 시간에 미리 받아 두므로(App 의 prefetch effect) 전환은 기존처럼 즉시다.
// ⚠️ 결재는 사이드바 출퇴근 위젯의 야근 결재 모달과 같은 청크다 — 그쪽도 lazy 여야
//    (AttendanceWidget) 이 분리가 실제로 효과를 낸다. 한쪽만 바꾸면 청크가 그대로 딸려온다.
const loadWeekly = () => import("../features/weekly");
const loadNightwatch = () => import("../features/nightwatch");
const loadApproval = () => import("../features/approval");

const WeeklySection = lazy(() =>
  loadWeekly().then((m) => ({ default: m.WeeklySection }))
);
const NightwatchSection = lazy(() =>
  loadNightwatch().then((m) => ({ default: m.NightwatchSection }))
);
const ApprovalSection = lazy(() =>
  loadApproval().then((m) => ({ default: m.ApprovalSection }))
);

// 섹션 = 사이드바 항목 + 메인 영역 렌더 — 새 섹션은 이 배열에만 추가하면 된다.
// ⚠️ 배열 첫 항목이 앱을 열었을 때의 화면이다(activeId 초기값 = SECTIONS[0].id).
type AppSection = SidebarSection & {
  render: () => ReactNode;
};

const SECTIONS: AppSection[] = [
  {
    id: "terminal",
    label: "터미널",
    icon: <Icon name="terminal" size={16} />,
    // 터미널은 keep-alive — <main> 이 직접 상주 마운트한다 (App 렌더의 main__keep 참고)
    render: () => null,
  },
  {
    id: "jira",
    label: "Jira",
    icon: <Icon name="clipboard-list" size={16} />,
    render: () => <JiraSection />,
  },
  {
    id: "nightwatch",
    label: "Nightwatch",
    icon: <Icon name="moon" size={16} />,
    render: () => <NightwatchSection />,
  },
  {
    id: "prs",
    label: "PR",
    icon: <Icon name="git-pull-request" size={16} />,
    render: () => <PrSection />,
  },
  {
    id: "deploy",
    label: "배포",
    icon: <Icon name="rocket" size={16} />,
    render: () => <DeploySection />,
  },
  {
    id: "projects",
    label: "프로젝트",
    icon: <Icon name="folder" size={16} />,
    render: () => <ProjectsSection />,
  },
  {
    id: "applink",
    label: "딥링크",
    icon: <Icon name="link" size={16} />,
    render: () => <ApplinkSection />,
  },
  {
    id: "approval",
    label: "결재",
    icon: <Icon name="pencil" size={16} />,
    render: () => <ApprovalSection />,
  },
  {
    id: "schedule",
    label: "일정 등록",
    icon: <Icon name="calendar" size={16} />,
    render: () => <ScheduleSection />,
  },
  {
    id: "weekly",
    label: "주간보고",
    icon: <Icon name="bar-chart" size={16} />,
    render: () => <WeeklySection />,
  },
  // 하단 분리 그룹
  {
    id: "settings",
    label: "환경설정",
    icon: <Icon name="settings" size={16} />,
    bottom: true,
    render: () => <SettingsSection />,
  },
];

// main 발신 토스트(app:toast — notify.notifyToast) 를 전역 토스트로 표시하는 브리지.
// useToast 가 ToastContext 를 읽어야 해서 App 본문이 아니라 Provider 안쪽 자식으로 둔다.
function AppToastBridge(): null {
  const toast = useToast();
  useEffect(() => {
    if (!window.oneApp?.onToast) return;
    return window.oneApp.onToast((p) => {
      // 터미널 세션 대상(입력대기)인데 이미 그 세션을 보고 있으면 생략 — 같은 화면에
      // "이동" 토스트는 소음이다 (판정은 TerminalSection 이 sectionNav 에 등록)
      const term = p.terminalSession;
      if (term && isSessionOnScreen(term.sessionId)) return;
      toast(p.message, {
        variant: p.variant ?? "info",
        title: p.title,
        sticky: p.sticky,
        duration: p.duration,
        dedupeKey: p.dedupeKey,
        // 세션 대상이면 그 세션까지 포커스, 아니면 섹션 전환만 — 둘 다 sectionNav
        // 경유라 App 이 등록한 navigator 가 SECTIONS 검증을 한다
        action: term
          ? {
              label: p.actionLabel ?? "이동",
              onClick: () =>
                openTerminalSession({
                  sessionId: term.sessionId,
                  cwd: term.cwd,
                }),
            }
          : p.section
            ? { label: p.actionLabel ?? "이동", section: p.section }
            : undefined,
      });
    });
  }, [toast]);
  return null;
}

// Jira 탭에서 이미 확인한 티켓 키 — 새로 들어온 티켓(미확인)을 강조하기 위한 기준
const JIRA_SEEN_KEY = "jira:seenKeys";
const loadSeenKeys = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(JIRA_SEEN_KEY) ?? "[]") as string[];
  } catch {
    return [];
  }
};

export function App() {
  const [activeId, setActiveId] = useState<string>(SECTIONS[0].id);
  // 터미널 keep-alive — 한 번 방문하면 섹션을 떠나도 언마운트하지 않고 숨긴다(visibility).
  // xterm·attach 가 살아 있어 복귀가 즉시이고(재attach 왕복·TUI 전체 리드로 없음),
  // 재마운트가 만들던 버그 부류(alt 게이트 오판·링버퍼 DA 재응답)가 아예 생기지 않는다.
  const [termVisited, setTermVisited] = useState(SECTIONS[0].id === "terminal");
  useEffect(() => {
    if (activeId === "terminal") setTermVisited(true);
  }, [activeId]);

  // lazy 섹션 청크를 첫 페인트 뒤 유휴 시간에 미리 받아 둔다 — 초기 파싱에서만 빼고
  // 전환 지연은 만들지 않는다. 로컬 파일이라 받는 비용 자체는 거의 없다.
  useEffect(() => {
    const prefetch = () => {
      void loadWeekly();
      void loadNightwatch();
      void loadApproval();
    };
    if (typeof requestIdleCallback !== "function") {
      const t = setTimeout(prefetch, 2_000);
      return () => clearTimeout(t);
    }
    const id = requestIdleCallback(prefetch, { timeout: 5_000 });
    return () => cancelIdleCallback(id);
  }, []);
  // 섹션 방문 히스토리 — 뒤로(⌘[ · 스와이프 오른쪽 · 마우스 뒤로)/앞으로(⌘] · 반대 방향)
  const backStack = useRef<string[]>([]);
  const fwdStack = useRef<string[]>([]);

  const navigate = useCallback((id: string) => {
    setActiveId((cur) => {
      if (cur === id) return cur;
      backStack.current.push(cur);
      fwdStack.current = []; // 새 분기로 이동하면 앞으로 히스토리는 무효
      return id;
    });
  }, []);

  const goBack = useCallback(() => {
    // 섹션 안에 하위 화면이 있으면(결재 폼 → 목록) 먼저 그쪽을 닫는다.
    // 이게 없으면 뒤로가기가 섹션을 통째로 떠나 "메뉴가 아예 바뀐다".
    if (runSectionBack()) return;
    setActiveId((cur) => {
      const prev = backStack.current.pop();
      if (!prev) return cur;
      fwdStack.current.push(cur);
      return prev;
    });
  }, []);

  const goForward = useCallback(() => {
    // 뒤로가기와 대칭 — 섹션 안에서 되돌릴 것이 있으면(터미널 세션 히스토리) 그쪽 먼저
    if (runSectionForward()) return;
    setActiveId((cur) => {
      const next = fwdStack.current.pop();
      if (!next) return cur;
      backStack.current.push(cur);
      return next;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // macOS 표준 뒤로/앞으로 단축키
      if (!e.metaKey || e.shiftKey || e.altKey) return;
      if (e.key === "[") {
        e.preventDefault();
        goBack();
      } else if (e.key === "]") {
        e.preventDefault();
        goForward();
      }
    };
    const onMouse = (e: MouseEvent) => {
      // 마우스 뒤로(X1)/앞으로(X2) 버튼 — OS·드라이버가 이벤트를 전달해 줄 때
      if (e.button === 3) {
        e.preventDefault();
        goBack();
      } else if (e.button === 4) {
        e.preventDefault();
        goForward();
      }
    };
    // macOS 스와이프·드라이버 변환 제스처는 메인이 중계해 준다 (main.ts 참고)
    const offGesture = window.oneApp?.onHistoryNav?.((dir) =>
      dir === "back" ? goBack() : goForward()
    );
    window.addEventListener("keydown", onKey);
    window.addEventListener("mouseup", onMouse);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mouseup", onMouse);
      offGesture?.();
    };
  }, [goBack, goForward]);

  const [jiraCount, setJiraCount] = useState(0);
  const [jiraUnread, setJiraUnread] = useState(0);
  const [jiraOpenKeys, setJiraOpenKeys] = useState<string[] | null>(null);

  // 사이드바 Jira 뱃지 — 미해결 이슈 수를 2분마다 갱신 (미설정·오류 시 조용히 0).
  // usePolling 경유 — 창이 백그라운드면 주기가 늘어나고, main 의 TTL 캐시로
  // 홈 카드·Jira 섹션과 실제 네트워크 호출을 공유한다(2026-08-07 성능 감사).
  const refreshJiraBadge = useCallback(() => {
    void (async () => {
      try {
        const res = await window.oneApp?.jira.list();
        const keys =
          res?.ok && res.issues
            ? res.issues.filter((i) => !isDone(i)).map((i) => i.key)
            : [];
        setJiraCount(keys.length);
        setJiraOpenKeys(keys);
        // 확인 목록 위생 — 해결돼 목록에서 빠진 키는 더 기억할 필요 없다
        const seen = loadSeenKeys().filter((k) => keys.includes(k));
        localStorage.setItem(JIRA_SEEN_KEY, JSON.stringify(seen));
        setJiraUnread(keys.filter((k) => !seen.includes(k)).length);
      } catch {
        setJiraCount(0);
        setJiraUnread(0);
      }
    })();
  }, []);
  usePolling(refreshJiraBadge, 120_000);

  // Jira 탭을 열면 현재 목록 전체를 '확인함'으로 — 강조 뱃지가 회색 숫자로 복귀
  useEffect(() => {
    if (activeId !== "jira" || !jiraOpenKeys) return;
    localStorage.setItem(JIRA_SEEN_KEY, JSON.stringify(jiraOpenKeys));
    setJiraUnread(0);
  }, [activeId, jiraOpenKeys]);

  // 사이드바 터미널 뱃지 — 입력대기(waiting) 세션 수. main 이 상태를 판정해 push 한다
  const [termWaiting, setTermWaiting] = useState(0);
  useEffect(() => {
    const api = window.oneApp?.terminal;
    if (!api) return;
    const count = (sessions: TerminalSessionInfo[]) =>
      setTermWaiting(sessions.filter((s) => s.status === "waiting").length);
    void api.list().then(count);
    return api.onSessions((sessions) => {
      if (sessions) count(sessions);
      else void api.list().then(count); // payload 미탑재(구버전 main) 폴백
    });
  }, []);

  const active = SECTIONS.find((s) => s.id === activeId) ?? SECTIONS[0];
  // 섹션 내부에 돌아갈 하위 화면이 있으면 히스토리가 비어 있어도 뒤로 버튼을 살린다
  const hasSectionBack = useHasSectionBack();
  const hasSectionForward = useHasSectionForward();

  // 데스크톱 알림 클릭 등으로 특정 섹션 이동 요청 시 해당 탭으로 전환
  useEffect(() => {
    if (!window.oneApp?.onNavigate) return;
    return window.oneApp.onNavigate((section) => {
      if (SECTIONS.some((s) => s.id === section)) navigate(section);
    });
  }, [navigate]);

  // 섹션 안에서 다른 섹션으로 보내는 이동(Jira [작업] → 터미널)을 위한 등록
  useEffect(() => {
    setSectionNavigator((section) => {
      if (SECTIONS.some((s) => s.id === section)) navigate(section);
    });
    return () => setSectionNavigator(null);
  }, [navigate]);

  return (
    <ToastProvider>
      <AppToastBridge />
      <ConfirmProvider>
        <div className="app">
          <Sidebar
            sections={SECTIONS.map((s) => {
              if (s.id === "jira") {
                return {
                  ...s,
                  // 확인 안 한 새 티켓이 있으면 그 수를 액센트로 강조, 없으면 미해결 수
                  badge: jiraUnread > 0 ? jiraUnread : jiraCount,
                  badgeAccent: jiraUnread > 0,
                };
              }
              // 터미널 — 입력대기 세션이 있을 때만 액센트 뱃지
              if (s.id === "terminal" && termWaiting > 0) {
                return { ...s, badge: termWaiting, badgeAccent: true };
              }
              return s;
            })}
            activeId={activeId}
            onSelect={navigate}
            header={
              <ErrorBoundary label="메일" compact>
                <MailWidget />
              </ErrorBoundary>
            }
            footer={
              <>
                {/* 위젯은 각자 격리한다 — 하나가 죽어도 나머지 위젯과 사이드바는 살아 있다 */}
                <ErrorBoundary label="폰 미러링" compact>
                  <MirrorWidget />
                </ErrorBoundary>
                <ErrorBoundary label="VPN" compact>
                  <VpnWidget />
                </ErrorBoundary>
                <ErrorBoundary label="근태" compact>
                  <AttendanceWidget />
                </ErrorBoundary>
              </>
            }
          />

          {/* 오른쪽 콘텐츠 영역 */}
          <section className="content">
            {/* 탑바 — 히스토리 이동 + 현재 섹션 표시 + 창 드래그 영역 */}
            <header className="topbar">
              <span className="topbar__nav">
                <button
                  type="button"
                  className="icon-btn"
                  onClick={goBack}
                  disabled={backStack.current.length === 0 && !hasSectionBack}
                  title="뒤로 (⌘[)"
                >
                  <Icon name="chevron-left" size={16} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={goForward}
                  disabled={fwdStack.current.length === 0 && !hasSectionForward}
                  title="앞으로 (⌘])"
                >
                  <Icon name="chevron-right" size={16} />
                </button>
              </span>
              {/* key 로 섹션마다 재마운트 — 제목·아이콘이 툭 바뀌지 않고 페이드된다
                  (모션은 _layout.scss 의 .topbar__icon·__title) */}
              <span className="topbar__icon" key={`icon-${active.id}`}>
                {active.icon}
              </span>
              <span className="topbar__title" key={`title-${active.id}`}>
                {active.label}
              </span>
            </header>

            {/* 메인 영역 — 섹션마다 별도 경계(key)라 다른 섹션으로 옮기면 오류 상태도 초기화된다 */}
            <main className="main">
              {/* 터미널 — 상주(keep-alive). 숨김은 언마운트가 아니라 visibility 다(근태
                  위젯과 같은 규칙). 경계에 key 가 없어 섹션 이동으로 오류가 초기화되지
                  않는다 — 복구는 폴백 화면의 [다시 시도]가 담당. */}
              {termVisited && (
                <div
                  className={
                    "main__keep" +
                    (activeId === "terminal" ? "" : " main__keep--hidden")
                  }
                >
                  <ErrorBoundary label="터미널">
                    <TerminalSection active={activeId === "terminal"} />
                  </ErrorBoundary>
                </div>
              )}
              {activeId !== "terminal" && (
                <ErrorBoundary key={active.id} label={active.label}>
                  {/* lazy 섹션의 청크 대기 — 유휴 프리페치로 이미 받아 둔 경우가 대부분이라
                      대개 한 프레임도 보이지 않는다. 로딩 UI 는 각 섹션이 자체로 갖는다. */}
                  <Suspense fallback={null}>{active.render()}</Suspense>
                </ErrorBoundary>
              )}
            </main>
          </section>
        </div>
      </ConfirmProvider>
    </ToastProvider>
  );
}
