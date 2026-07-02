import { useState } from 'react';
import { Sidebar, SidebarSection } from '../components/Sidebar';
import { ScheduleSection } from '../features/schedule';
import { SettingsSection } from '../features/settings';
import { DeploySection } from '../features/deploy';

const SECTIONS: SidebarSection[] = [
  { id: 'schedule', label: '일정 등록', icon: '🗓️' },
  { id: 'deploy', label: '배포', icon: '🚀' },
  { id: 'settings', label: '환경설정', icon: '⚙️' },
  // 나중에 추가할 섹션들 (필요할 때 주석 해제)
  // { id: 'terminal', label: '터미널', icon: '🖥️' },
  // { id: 'api', label: 'API', icon: '🌐' },
  // { id: 'monitoring', label: '모니터링', icon: '📈' },
  // { id: 'memo', label: '메모', icon: '📝' },
  // { id: 'jira', label: 'Jira', icon: '📋' },
  // { id: 'docker', label: 'Docker', icon: '🐳' },
  // { id: 'vpn', label: 'VPN', icon: '🔒' },
  // { id: 'nas', label: 'NAS', icon: '🗄️' },
];

export function App() {
  const [activeId, setActiveId] = useState<string>('schedule');
  const active = SECTIONS.find((s) => s.id === activeId) ?? SECTIONS[0];

  const renderMain = () => {
    switch (active.id) {
      case 'schedule':
        return <ScheduleSection />;
      case 'deploy':
        return <DeploySection />;
      case 'settings':
        return <SettingsSection />;
      default:
        return (
          <div className="placeholder">
            <div className="placeholder__icon">{active.icon}</div>
            <h2 className="placeholder__title">{active.label}</h2>
            <p className="placeholder__desc">
              여기에 <b>{active.label}</b> 기능이 들어갑니다.
            </p>
            <p className="placeholder__hint">
              다음 단계에서 각 섹션을 실제로 구현합니다.
            </p>
          </div>
        );
    }
  };

  return (
    <div className="app">
      <Sidebar sections={SECTIONS} activeId={activeId} onSelect={setActiveId} />

      {/* 오른쪽 콘텐츠 영역 */}
      <section className="content">
        {/* 상단 탭바 */}
        <header className="tabbar">
          <div className="tab tab--active">
            <span className="tab__icon">{active.icon}</span>
            <span className="tab__label">{active.label}</span>
          </div>
        </header>

        {/* 메인 영역 */}
        <main className="main">{renderMain()}</main>
      </section>
    </div>
  );
}
