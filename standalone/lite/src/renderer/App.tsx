import { useEffect, useState } from 'react';
import type { AppSettingsView } from '@one/shared/types';
import { ConfirmProvider } from '@one/renderer/components/ConfirmDialog';
import { ErrorBoundary } from '@one/renderer/components/ErrorBoundary';
import { Icon } from '@one/renderer/components/Icon';
import { SectionHeader } from '@one/renderer/components/SectionHeader';
import { Segment } from '@one/renderer/components/Segment';
import { ToastProvider } from '@one/renderer/components/Toast';
import { Tooltip } from '@one/renderer/components/Tooltip';
import { ApprovalSection } from '@one/renderer/features/approval';
// ⚠️ jira 는 index.ts(공개 API)가 아니라 컴포넌트 파일을 직접 가져온다 — index 가 JiraSection 을
// 함께 내보내고, 그 파일은 터미널 세션·작업 시작 등 이 앱에 없는 채널을 쓰므로 tsc 가 실패한다.
import { JiraReportPanel } from '@one/renderer/features/jira/components/JiraReportPanel';
import { SettingsView } from './views/SettingsView';

type Screen = 'approval' | 'report' | 'settings';
type MainScreen = Exclude<Screen, 'settings'>;

const FOOTS: Record<Screen, string> = {
  approval: '그룹웨어 결재를 대신 작성합니다 — 결재(승인)는 직접, 계정은 이 PC 에만 암호화 저장됩니다.',
  report: 'Jira 티켓을 프로젝트·기간으로 모아 보고용 목록을 복사합니다 — Jira 계정은 환경설정에서.',
  settings: '사번·비밀번호·API 토큰은 이 PC 에만 암호화(OS 보안 저장소)해 저장됩니다.',
};

/** 어느 화면이 죽었는지 ErrorBoundary 안내 문구에 들어간다 */
const LABELS: Record<Screen, string> = {
  approval: '결재',
  report: '티켓 보고',
  settings: '환경설정',
};

/** 앱 셸 — 제목바(제목·화면 전환·환경설정) + 본문 + 하단 안내 */
function Shell() {
  const [settings, setSettings] = useState<AppSettingsView | null>(null);
  const [screen, setScreen] = useState<Screen>('approval');
  // 환경설정에서 돌아갈 화면 — 세그먼트도 이 값을 가리킨다
  const [lastMain, setLastMain] = useState<MainScreen>('approval');

  useEffect(() => {
    void window.oneApp.settings.get().then((s) => {
      setSettings(s);
      // 계정이 없으면 환경설정부터 (첫 실행)
      if (!s.bizboxId || !s.hasPassword) setScreen('settings');
    });
  }, []);

  const configured = !!settings?.bizboxId && !!settings?.hasPassword;

  const goMain = (next: MainScreen) => {
    setLastMain(next);
    setScreen(next);
  };

  return (
    <div className="app">
      <header className="app__head">
        <span className="app__head-icon">
          <Icon name="layout-grid" size={17} />
        </span>
        <h1 className="app__title">One App Lite</h1>
        <nav className="app__nav" aria-label="화면 전환">
          {/* ⚠️ value 는 현재 화면 그대로 준다 — 환경설정일 때는 어느 항목과도 맞지 않아
              아무것도 선택되지 않는다. 예전엔 `lastMain` 을 줘서 설정 화면인데도 '결재'가
              눌린 것처럼 보였다(2026-09-03 사용자 지적). */}
          <Segment<Screen>
            options={[
              { value: 'approval', label: '결재' },
              { value: 'report', label: '티켓 보고' },
            ]}
            value={screen}
            onChange={(next) => {
              if (next !== 'settings') goMain(next);
            }}
          />
        </nav>
        <span className="app__gap" />
        <Tooltip label="환경설정">
          <button
            type="button"
            className={
              'icon-btn icon-btn--bordered app__gear' +
              (screen === 'settings' ? ' app__gear--on' : '')
            }
            aria-label="환경설정"
            aria-pressed={screen === 'settings'}
            onClick={() => setScreen('settings')}
          >
            <Icon name="settings" size={15} />
          </button>
        </Tooltip>
      </header>

      <main className="app__body">
        {/* 화면마다 격리 — 하나가 죽어도 헤더로 다른 화면에 갈 수 있다 */}
        <ErrorBoundary key={screen} label={LABELS[screen]}>
          {screen === 'approval' && <ApprovalSection />}
          {screen === 'report' && (
            // `.jira` 는 본체 Jira 섹션의 와이드 폭(--w-wide)을 빌려 쓰기 위한 것 — 표가 7열이다
            <div className="section jira">
              <SectionHeader
                icon={<Icon name="clipboard-list" size={18} />}
                title="티켓 보고"
                sub="프로젝트·기간으로 티켓을 모아 보고용 목록을 만듭니다. 필터한 뒤 원하는 형식으로 복사하세요."
              />
              <JiraReportPanel />
            </div>
          )}
          {screen === 'settings' && settings && (
            <SettingsView
              settings={settings}
              onSaved={(next) => {
                setSettings(next);
                setScreen(lastMain);
              }}
              onCancel={configured ? () => setScreen(lastMain) : null}
            />
          )}
        </ErrorBoundary>
      </main>

      <footer className="app__foot">{FOOTS[screen]}</footer>
    </div>
  );
}

/** 루트 — 본체와 같은 Provider 를 감싼다 (토스트·확인 다이얼로그를 본체 컴포넌트가 기대한다) */
export function App() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <Shell />
      </ConfirmProvider>
    </ToastProvider>
  );
}
