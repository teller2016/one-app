import { useEffect, useState, type ReactNode } from 'react';
import type { AccountView, DraftKind } from '../shared/types';
import { Icon } from './components/Icon';
import { ExpendForm } from './views/ExpendForm';
import { OvertimeForm } from './views/OvertimeForm';
import { PickKind } from './views/PickKind';
import { SettingsForm } from './views/SettingsForm';

type Screen = 'pick' | DraftKind | 'settings';

const TITLES: Record<Screen, string> = {
  pick: '결재 도우미',
  overtime: '야근 결재 상신',
  expend: '지출결의서(개인)',
  settings: '설정',
};

const FOOTS: Record<Screen, string> = {
  pick: '그룹웨어 결재를 대신 작성합니다 — 계정은 이 PC 에만 암호화 저장됩니다.',
  overtime: "결재선은 '본인' — 상신 후 그룹웨어 미결함에서 [결재]를 눌러야 완료됩니다.",
  expend: '항목만 채워 둡니다 — 첨부파일 등록·결재상신은 열린 창에서 직접 하세요.',
  settings: '사번·비밀번호는 이 PC 에만 암호화(OS 보안 저장소)해 저장됩니다.',
};

/** 앱 셸 — 상단바(뒤로·제목·설정) + 화면 전환 */
export function App() {
  const [account, setAccount] = useState<AccountView | null>(null);
  const [screen, setScreen] = useState<Screen>('pick');

  useEffect(() => {
    void window.overtimeApp.getAccount().then((a) => {
      setAccount(a);
      // 계정이 없으면 설정 화면부터 (첫 실행)
      if (!a.id || !a.hasPassword) setScreen('settings');
    });
  }, []);

  const configured = !!account?.id && !!account?.hasPassword;

  let body: ReactNode = null;
  if (screen === 'settings') {
    body = account && (
      <SettingsForm
        account={account}
        onSaved={(next) => {
          setAccount(next);
          setScreen('pick');
        }}
        onCancel={configured ? () => setScreen('pick') : null}
      />
    );
  } else if (screen === 'overtime') {
    body = <OvertimeForm configured={configured} />;
  } else if (screen === 'expend') {
    body = <ExpendForm configured={configured} />;
  } else {
    body = <PickKind onPick={(kind) => setScreen(kind)} />;
  }

  return (
    <div className="app">
      <header className="app__head">
        {screen === 'pick' ? (
          <span className="app__head-icon">
            <Icon name="check" size={17} />
          </span>
        ) : (
          <button
            type="button"
            className="icon-btn"
            aria-label="뒤로"
            title="결재 선택으로"
            onClick={() => setScreen('pick')}
          >
            <Icon name="chevron-left" size={16} />
          </button>
        )}
        <h1 className="app__title">{TITLES[screen]}</h1>
        {screen !== 'settings' && (
          <button
            type="button"
            className="icon-btn icon-btn--bordered"
            title="설정"
            aria-label="설정"
            onClick={() => setScreen('settings')}
          >
            <Icon name="settings" size={15} />
          </button>
        )}
      </header>
      <main className="app__body">{body}</main>
      <footer className="app__foot">{FOOTS[screen]}</footer>
    </div>
  );
}
