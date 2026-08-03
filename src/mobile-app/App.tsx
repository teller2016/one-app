// 폰 앱 셸 — 상단 타이틀 + 하단 탭바. 기능 화면은 데스크톱 것을 그대로 쓴다.
// ⚠️ 활성 탭만 렌더한다(데스크톱 App.tsx 와 같은 규칙) — 5개를 동시에 마운트하면
// 각 섹션의 폴러(배포 60초·Jira 2분·메일 30초…)가 동시에 돌아 사내 서버를 이중으로 두드린다.
import { ConfirmProvider } from '../renderer/components/ConfirmDialog';
import { Icon } from '../renderer/components/Icon';
import type { IconName } from '../renderer/components/Icon';
import { ToastProvider } from '../renderer/components/Toast';
import { DeploySection } from '../renderer/features/deploy';
import { JiraSection } from '../renderer/features/jira';
import { PrSection } from '../renderer/features/prs';
import { MoAttendanceView } from './views/MoAttendanceView';
import { MoMailView } from './views/MoMailView';
import { onRpcStatus } from './shim/rpc';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

type MoTab = {
  id: string;
  label: string;
  icon: IconName;
  /** ctx.goTab — 화면이 스스로 다른 탭으로 나갈 때 (메일 리더의 [×] 등) */
  render: (ctx: { goTab: (id: string) => void }) => ReactNode;
};

const TABS: MoTab[] = [
  {
    id: 'attendance',
    label: '근태',
    icon: 'building',
    render: () => <MoAttendanceView />,
  },
  {
    id: 'jira',
    label: 'Jira',
    icon: 'clipboard-list',
    render: () => <JiraSection />,
  },
  {
    id: 'prs',
    label: 'PR',
    icon: 'git-pull-request',
    render: () => <PrSection />,
  },
  {
    id: 'deploy',
    label: '배포',
    icon: 'rocket',
    render: () => <DeploySection />,
  },
  {
    id: 'mail',
    label: '메일',
    icon: 'mail',
    render: (ctx) => <MoMailView onExit={() => ctx.goTab('attendance')} />,
  },
];

export function App() {
  const [activeId, setActiveId] = useState(TABS[0].id);
  const [connected, setConnected] = useState(false);

  // 연결 상태 — 끊기면 화면의 데이터가 왜 안 오는지 알 수 있어야 한다
  useEffect(() => onRpcStatus(setConnected), []);

  const active = TABS.find((t) => t.id === activeId) ?? TABS[0];

  return (
    <ToastProvider>
      <ConfirmProvider>
        <div className="mo-app">
          <header className="mo-app__bar">
            <span className="mo-app__title">{active.label}</span>
            <span
              className={`mo-app__conn${connected ? ' mo-app__conn--on' : ''}`}
              title={connected ? '연결됨' : '연결 끊김 — 재연결 중'}
            />
          </header>

          <main className="mo-app__body">
            {active.render({ goTab: setActiveId })}
          </main>

          <nav className="mo-app__tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`mo-app__tab${t.id === activeId ? ' mo-app__tab--active' : ''}`}
                onClick={() => setActiveId(t.id)}
              >
                <Icon name={t.icon} size={18} />
                <span>{t.label}</span>
              </button>
            ))}
            {/* 터미널은 별도 페이지(`/terminal/`) — 세션·키바·터치 스크롤이 전용으로 만들어져 있다 */}
            <a className="mo-app__tab" href="/terminal/">
              <Icon name="terminal" size={18} />
              <span>터미널</span>
            </a>
          </nav>
        </div>
      </ConfirmProvider>
    </ToastProvider>
  );
}
