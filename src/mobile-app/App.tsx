// 폰 앱 셸 — 화면별 머리(52) + 하단 탭바 5개(터미널·변경·Jira·PR·더보기). 목업: 캔버스 'MO(폰)' 페이지.
// 기능 화면은 데스크톱 것을 그대로 쓴다.
// ⚠️ 터미널 탭만 **keep-alive**(숨겨도 마운트 유지) — xterm·WS attach 를 탭 전환마다 다시 하면
//    replay 로 화면이 깜빡이고 입력 중이던 내용이 끊긴다. 나머지 탭은 활성 탭만 렌더한다(데스크톱
//    App.tsx 와 같은 규칙) — 동시에 마운트하면 각 섹션의 폴러(배포 60초·Jira 2분…)가 사내 서버를
//    이중으로 두드린다.
import { ConfirmProvider } from '../renderer/components/ConfirmDialog';
import { ErrorBoundary } from '../renderer/components/ErrorBoundary';
import { Icon } from '../renderer/components/Icon';
import type { IconName } from '../renderer/components/Icon';
import { ToastProvider } from '../renderer/components/Toast';
import { DeploySection } from '../renderer/features/deploy';
import { JiraSection } from '../renderer/features/jira';
import { PrSection } from '../renderer/features/prs';
import { useBackClose } from '../renderer/lib/useBackClose';
import { usePolling } from '../renderer/lib/usePolling';
import { MoTerminalTab, moTerminal } from './terminal';
import { MoChangesView } from './views/MoChangesView';
import { MoMailView } from './views/MoMailView';
import { MoMoreView, type MoreScreen } from './views/MoMoreView';
import { onRpcStatus } from './shim/rpc';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';

type TabId = 'terminal' | 'changes' | 'jira' | 'prs' | 'more';

const TABS: { id: TabId; label: string; icon: IconName }[] = [
  { id: 'terminal', label: '터미널', icon: 'terminal' },
  { id: 'changes', label: '변경', icon: 'git-branch' },
  { id: 'jira', label: 'Jira', icon: 'clipboard-list' },
  { id: 'prs', label: 'PR', icon: 'git-pull-request' },
  { id: 'more', label: '더보기', icon: 'layout-grid' },
];

const TITLES: Record<Exclude<TabId, 'terminal'>, string> = {
  changes: '변경',
  jira: '내 이슈',
  prs: 'PR',
  more: '더보기',
};

const SUB_TITLES: Record<MoreScreen, string> = { deploy: '배포', mail: '메일' };

/** 안읽은 메일 폴링 — 데스크톱 상태바 메일 항목과 같은 주기(활성 30초 · 비활성 6배) */
const MAIL_POLL_MS = 30_000;

/** 셸 공용 머리 — 제목(+ 하위 화면이면 뒤로) · 연결 점. 터미널 탭은 자기 머리를 그린다 */
function MoHead({
  title,
  onBack,
  connected,
}: {
  title: string;
  onBack?: () => void;
  connected: boolean;
}) {
  return (
    <header className={'mo-app__head' + (onBack ? ' mo-app__head--sub' : '')}>
      {onBack && (
        <button
          type="button"
          className="mo-app__back"
          aria-label="뒤로"
          onClick={onBack}
        >
          <Icon name="chevron-left" size={18} />
        </button>
      )}
      <h1 className="mo-app__title">{title}</h1>
      <span
        className={`mo-app__conn${connected ? ' mo-app__conn--on' : ''}`}
        role="status"
        aria-label={connected ? '연결됨' : '연결 끊김 — 재연결 중'}
      />
    </header>
  );
}

/** 더보기 하위 화면(배포) — 폰 뒤로가기로 목록에 돌아온다. 메일은 MailModal 이 스스로 건다 */
function SubBack({ onBack }: { onBack: () => void }) {
  useBackClose(onBack);
  return null;
}

export function App() {
  const [activeId, setActiveId] = useState<TabId>('terminal');
  const [more, setMore] = useState<MoreScreen | null>(null);
  const [connected, setConnected] = useState(false);
  const [unread, setUnread] = useState(0);
  // 빌드 중·대기 대상 — 젠킨스 상태 이벤트(push)로만 센다(셸이 따로 폴링하지 않는다)
  const [busyDeploys, setBusyDeploys] = useState<Record<string, true>>({});

  const term = useSyncExternalStore(moTerminal.subscribe, moTerminal.getState);

  // 연결 상태 — 끊기면 화면의 데이터가 왜 안 오는지 알 수 있어야 한다
  useEffect(() => onRpcStatus(setConnected), []);

  const loadUnread = useCallback(async () => {
    try {
      const res = await window.oneApp.mail.getUnreadCount();
      if (res.ok) setUnread(res.unreadCount);
    } catch {
      /* 끊김은 머리의 연결 점이 알린다 — 배지는 마지막 값 유지 */
    }
  }, []);
  useEffect(() => {
    void loadUnread();
  }, [loadUnread]);
  usePolling(loadUnread, MAIL_POLL_MS, { immediate: false });

  useEffect(
    () =>
      window.oneApp.deploy.onStatus(({ projectId, targetId, status }) => {
        const key = `${projectId}:${targetId}`;
        const busy = status.state === 'building' || status.state === 'queued';
        setBusyDeploys((prev) => {
          if (busy === !!prev[key]) return prev;
          const next = { ...prev };
          if (busy) next[key] = true;
          else delete next[key];
          return next;
        });
      }),
    [],
  );

  const goTab = (id: TabId) => {
    setActiveId(id);
    if (id !== 'more') setMore(null);
  };

  const backToMore = useCallback(() => setMore(null), []);

  const renderBody = (): ReactNode => {
    switch (activeId) {
      case 'changes':
        return <MoChangesView target={term.target} />;
      case 'jira':
        return <JiraSection mineOnly />;
      case 'prs':
        return <PrSection />;
      case 'more':
        if (more === 'deploy')
          return (
            <>
              <SubBack onBack={backToMore} />
              <DeploySection />
            </>
          );
        if (more === 'mail')
          return (
            <MoMailView
              onExit={backToMore}
              onRead={() => setUnread((n) => Math.max(0, n - 1))}
              onCount={setUnread}
            />
          );
        return (
          <MoMoreView
            unread={unread}
            busyDeploys={Object.keys(busyDeploys).length}
            onOpen={setMore}
          />
        );
      default:
        return null;
    }
  };

  const onTerminal = activeId === 'terminal';
  const title =
    more && activeId === 'more'
      ? SUB_TITLES[more]
      : onTerminal
        ? ''
        : TITLES[activeId];
  const bodyKey = activeId + (activeId === 'more' ? `:${more ?? ''}` : '');

  return (
    <ToastProvider>
      <ConfirmProvider>
        <div className="mo-app">
          {/* 터미널 — 숨겨도 마운트 유지(keep-alive). 자기 머리·키 바를 그린다 */}
          <div className="mo-app__term" hidden={!onTerminal}>
            <ErrorBoundary label="터미널">
              <MoTerminalTab
                active={onTerminal}
                onGoTab={(id) => goTab(id as TabId)}
              />
            </ErrorBoundary>
          </div>

          {!onTerminal && (
            <>
              <MoHead
                title={title}
                connected={connected}
                onBack={activeId === 'more' && more ? backToMore : undefined}
              />
              {/* 탭마다 별도 경계 — 폰은 DevTools 도 새로고침 경로도 마땅치 않아 백지가 더 치명적이다 */}
              <main className="mo-app__body">
                <ErrorBoundary key={bodyKey} label={title}>
                  {renderBody()}
                </ErrorBoundary>
              </main>
            </>
          )}

          <nav className="mo-app__tabs" aria-label="화면">
            {TABS.map((t) => {
              const badge =
                t.id === 'terminal'
                  ? term.waitingCount
                  : t.id === 'more'
                    ? unread
                    : 0;
              return (
                <button
                  key={t.id}
                  type="button"
                  className={`mo-app__tab${t.id === activeId ? ' mo-app__tab--active' : ''}`}
                  aria-current={t.id === activeId ? 'page' : undefined}
                  onClick={() => goTab(t.id)}
                >
                  <span className="mo-app__tab-icon">
                    <Icon name={t.icon} size={20} />
                    {badge > 0 && (
                      <span
                        className={
                          'mo-app__badge' +
                          (t.id === 'terminal' ? ' mo-app__badge--wait' : '')
                        }
                        aria-label={
                          t.id === 'terminal'
                            ? `입력 대기 ${badge}`
                            : `안 읽은 메일 ${badge}`
                        }
                      >
                        {badge > 99 ? '99+' : badge}
                      </span>
                    )}
                  </span>
                  <span className="mo-app__tab-label">{t.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </ConfirmProvider>
    </ToastProvider>
  );
}
