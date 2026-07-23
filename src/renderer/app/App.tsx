import { ConfirmProvider } from "../components/ConfirmDialog";
import { Icon } from "../components/Icon";
import { Sidebar, SidebarSection } from "../components/Sidebar";
import { ToastProvider } from "../components/Toast";
import { ApplinkSection } from "../features/applink";
import { AttendanceWidget } from "../features/attendance";
import { DeploySection } from "../features/deploy";
import { JiraSection, isDone } from "../features/jira";
import { MailWidget } from "../features/mail";
import { MirrorWidget } from "../features/mirror";
import { NightwatchSection } from "../features/nightwatch";
import { PrSection } from "../features/prs";
import { ScheduleSection } from "../features/schedule";
import { SettingsSection } from "../features/settings";
import { VpnWidget } from "../features/vpn";
import { WeeklySection } from "../features/weekly";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

// 섹션 = 사이드바 항목 + 메인 영역 렌더 — 새 섹션은 이 배열에만 추가하면 된다
type AppSection = SidebarSection & { render: () => ReactNode };

const SECTIONS: AppSection[] = [
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
    id: "applink",
    label: "딥링크",
    icon: <Icon name="link" size={16} />,
    render: () => <ApplinkSection />,
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
  const [jiraCount, setJiraCount] = useState(0);
  const [jiraUnread, setJiraUnread] = useState(0);
  const [jiraOpenKeys, setJiraOpenKeys] = useState<string[] | null>(null);

  // 사이드바 Jira 뱃지 — 미해결 이슈 수를 2분마다 갱신 (미설정·오류 시 조용히 0)
  useEffect(() => {
    const refresh = async () => {
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
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 120_000);
    return () => clearInterval(timer);
  }, []);

  // Jira 탭을 열면 현재 목록 전체를 '확인함'으로 — 강조 뱃지가 회색 숫자로 복귀
  useEffect(() => {
    if (activeId !== "jira" || !jiraOpenKeys) return;
    localStorage.setItem(JIRA_SEEN_KEY, JSON.stringify(jiraOpenKeys));
    setJiraUnread(0);
  }, [activeId, jiraOpenKeys]);

  const active = SECTIONS.find((s) => s.id === activeId) ?? SECTIONS[0];

  // 데스크톱 알림 클릭 등으로 특정 섹션 이동 요청 시 해당 탭으로 전환
  useEffect(() => {
    if (!window.oneApp?.onNavigate) return;
    return window.oneApp.onNavigate((section) => {
      if (SECTIONS.some((s) => s.id === section)) setActiveId(section);
    });
  }, []);

  return (
    <ToastProvider>
      <ConfirmProvider>
        <div className="app">
          <Sidebar
            sections={SECTIONS.map((s) =>
              s.id === "jira"
                ? {
                    ...s,
                    // 확인 안 한 새 티켓이 있으면 그 수를 액센트로 강조, 없으면 미해결 수
                    badge: jiraUnread > 0 ? jiraUnread : jiraCount,
                    badgeAccent: jiraUnread > 0,
                  }
                : s
            )}
            activeId={activeId}
            onSelect={setActiveId}
            header={<MailWidget />}
            footer={
              <>
                <MirrorWidget />
                <VpnWidget />
                <AttendanceWidget />
              </>
            }
          />

          {/* 오른쪽 콘텐츠 영역 */}
          <section className="content">
            {/* 탑바 — 현재 섹션 표시 + 창 드래그 영역 */}
            <header className="topbar">
              <span className="topbar__icon">{active.icon}</span>
              <span className="topbar__title">{active.label}</span>
            </header>

            {/* 메인 영역 */}
            <main className="main">{active.render()}</main>
          </section>
        </div>
      </ConfirmProvider>
    </ToastProvider>
  );
}
