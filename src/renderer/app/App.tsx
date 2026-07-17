import { useEffect, useState } from 'react';
import { Sidebar, SidebarSection } from '../components/Sidebar';
import { Icon } from '../components/Icon';
import { ToastProvider } from '../components/Toast';
import { ConfirmProvider } from '../components/ConfirmDialog';
import { ScheduleSection } from '../features/schedule';
import { SettingsSection } from '../features/settings';
import { DeploySection } from '../features/deploy';
import { PrSection } from '../features/prs';
import { JiraSection } from '../features/jira';
import { ApplinkSection } from '../features/applink';
import { WeeklySection } from '../features/weekly';
import { AttendanceWidget } from '../features/attendance';
import { VpnWidget } from '../features/vpn';
import { MirrorWidget } from '../features/mirror';

const SECTIONS: SidebarSection[] = [
  { id: 'jira', label: 'Jira', icon: <Icon name="clipboard-list" size={16} /> },
  { id: 'prs', label: 'PR', icon: <Icon name="git-pull-request" size={16} /> },
  { id: 'deploy', label: '배포', icon: <Icon name="rocket" size={16} /> },
  { id: 'applink', label: '딥링크', icon: <Icon name="link" size={16} /> },
  { id: 'schedule', label: '일정 등록', icon: <Icon name="calendar" size={16} /> },
  { id: 'weekly', label: '주간보고', icon: <Icon name="bar-chart" size={16} /> },
  // 하단 분리 그룹
  { id: 'settings', label: '환경설정', icon: <Icon name="settings" size={16} />, bottom: true },
];

export function App() {
  const [activeId, setActiveId] = useState<string>(SECTIONS[0].id);
  const active = SECTIONS.find((s) => s.id === activeId) ?? SECTIONS[0];

  // 데스크톱 알림 클릭 등으로 특정 섹션 이동 요청 시 해당 탭으로 전환
  useEffect(() => {
    if (!window.oneApp?.onNavigate) return;
    return window.oneApp.onNavigate((section) => {
      if (SECTIONS.some((s) => s.id === section)) setActiveId(section);
    });
  }, []);

  const renderMain = () => {
    switch (active.id) {
      case 'schedule':
        return <ScheduleSection />;
      case 'weekly':
        return <WeeklySection />;
      case 'deploy':
        return <DeploySection />;
      case 'prs':
        return <PrSection />;
      case 'jira':
        return <JiraSection />;
      case 'applink':
        return <ApplinkSection />;
      case 'settings':
        return <SettingsSection />;
      default:
        return null;
    }
  };

  return (
    <ToastProvider>
      <ConfirmProvider>
        <div className="app">
        <Sidebar
          sections={SECTIONS}
          activeId={activeId}
          onSelect={setActiveId}
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
          <main className="main">{renderMain()}</main>
        </section>
        </div>
      </ConfirmProvider>
    </ToastProvider>
  );
}
