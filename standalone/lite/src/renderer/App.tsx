import { useCallback, useEffect, useState } from 'react';
import type { AppSettingsView } from '@one/shared/types';
import { Banner } from '@one/renderer/components/Banner';
import { Button } from '@one/renderer/components/Button';
import { ConfirmProvider, useConfirm } from '@one/renderer/components/ConfirmDialog';
import { ErrorBoundary } from '@one/renderer/components/ErrorBoundary';
import { Icon } from '@one/renderer/components/Icon';
import { SectionHeader } from '@one/renderer/components/SectionHeader';
import { Segment } from '@one/renderer/components/Segment';
import { ToastProvider } from '@one/renderer/components/Toast';
import { Tooltip } from '@one/renderer/components/Tooltip';
import { errMsg } from '@one/renderer/lib/errMsg';
import { ApprovalSection } from '@one/renderer/features/approval';
// ⚠️ jira 는 index.ts(공개 API)가 아니라 컴포넌트 파일을 직접 가져온다 — index 가 JiraSection 을
// 함께 내보내고, 그 파일은 터미널 세션·작업 시작 등 이 앱에 없는 채널을 쓰므로 tsc 가 실패한다.
import { JiraReportPanel } from '@one/renderer/features/jira/components/JiraReportPanel';
import type { UpdateInfo, UpdateProgress } from '../shared/update';
import { SettingsView } from './views/SettingsView';

type Screen = 'approval' | 'report' | 'settings';
type MainScreen = Exclude<Screen, 'settings'>;

const FOOTS: Record<Screen, string> = {
  approval: '그룹웨어 결재를 대신 작성합니다 — 결재(승인)는 직접, 계정은 이 PC 에만 암호화 저장됩니다.',
  report: 'Jira 티켓을 프로젝트·기간·레이블로 모아 보고용 목록을 복사합니다 — Jira 계정은 환경설정에서.',
  settings: '사번·비밀번호·API 토큰은 이 PC 에만 암호화(OS 보안 저장소)해 저장됩니다.',
};

/** 어느 화면이 죽었는지 ErrorBoundary 안내 문구에 들어간다 */
const LABELS: Record<Screen, string> = {
  approval: '결재',
  report: '티켓 보고',
  settings: '환경설정',
};

/** 자동 설치 진행 상태 — 배너가 이걸 그린다 */
type InstallState =
  | { status: 'idle' }
  | { status: 'running'; progress: UpdateProgress | null }
  /** 헬퍼가 떴다 — 앱이 곧 종료·재시작한다 */
  | { status: 'restarting' }
  | { status: 'failed'; error: string; folder?: string };

const PHASE_LABEL: Record<UpdateProgress['phase'], string> = {
  download: '내려받는 중',
  verify: '받은 파일 검사 중',
  extract: '압축 푸는 중',
  install: '설치 준비 중',
};

const mb = (bytes: number) => `${Math.round(bytes / 1024 / 1024)}MB`;

/** 앱 셸 — 제목바(제목·화면 전환·환경설정) + 새 버전 배너 + 본문 + 하단 안내 */
function Shell() {
  const [settings, setSettings] = useState<AppSettingsView | null>(null);
  const [screen, setScreen] = useState<Screen>('approval');
  // 환경설정에서 돌아갈 화면 — 세그먼트도 이 값을 가리킨다
  const [lastMain, setLastMain] = useState<MainScreen>('approval');
  // 새 버전 확인 결과 — 실패해도 current(현재 버전)는 들어 있어 환경설정의 버전 표시에 쓴다
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [updateHidden, setUpdateHidden] = useState(false);
  const [install, setInstall] = useState<InstallState>({ status: 'idle' });
  const confirm = useConfirm();

  useEffect(() => {
    void window.oneApp.settings.get().then((s) => {
      setSettings(s);
      // 계정이 없으면 환경설정부터 (첫 실행)
      if (!s.bizboxId || !s.hasPassword) setScreen('settings');
    });
    // 새 버전 확인은 시작 후 한 번만 — 실패는 조용히 넘긴다(사내망에서 GitHub 이 막혀도
    // 앱은 그대로 돌아야 한다). main 이 실패를 값으로 돌려주므로 catch 는 방어용이다.
    void window.oneApp.update
      .check()
      .then(setUpdate)
      .catch(() => undefined);
  }, []);

  // 설치 진행률 — 설치 중일 때만 반영한다(늦게 온 이벤트가 실패 화면을 덮지 않게)
  useEffect(
    () =>
      window.oneApp.update.onProgress((progress) => {
        setInstall((s) => (s.status === 'running' ? { status: 'running', progress } : s));
      }),
    [],
  );

  const startInstall = useCallback(async () => {
    if (!update?.latest) return;
    const ok = await confirm({
      title: `새 버전 ${update.latest} 설치`,
      message:
        '새 버전을 내려받아 설치한 뒤 앱이 자동으로 다시 시작됩니다. 진행 중인 결재 작성이 있으면 먼저 마치세요. 설정과 계정은 그대로 유지됩니다.',
      confirmLabel: '지금 업데이트',
    });
    if (!ok) return;
    setInstall({ status: 'running', progress: null });
    try {
      const result = await window.oneApp.update.install();
      if (result.ok) setInstall({ status: 'restarting' });
      else setInstall({ status: 'failed', error: result.error, folder: result.folder });
    } catch (e) {
      setInstall({ status: 'failed', error: errMsg(e, '설치에 실패했습니다.') });
    }
  }, [confirm, update]);

  const configured = !!settings?.bizboxId && !!settings?.hasPassword;

  const goMain = (next: MainScreen) => {
    setLastMain(next);
    setScreen(next);
  };

  // 배너는 새 버전이 있을 때만 — 설치가 시작됐으면 '나중에' 를 눌렀어도 진행을 보여준다
  const showUpdate =
    !!update?.ok && !!update.hasUpdate && (install.status !== 'idle' || !updateHidden);
  const percent =
    install.status === 'running' && install.progress?.phase === 'download'
      ? install.progress.percent
      : undefined;

  const renderUpdateBanner = () => {
    if (!update) return null;
    if (install.status === 'running') {
      const p = install.progress;
      const detail =
        p?.phase === 'download' && p.total
          ? ` ${p.percent ?? 0}% (${mb(p.received ?? 0)} / ${mb(p.total)})`
          : '…';
      return (
        <Banner variant="info">
          <div className="app__update-row">
            <span>
              <b>{update.latest}</b> {p ? PHASE_LABEL[p.phase] : '준비 중'}
              {detail}
            </span>
          </div>
          {typeof percent === 'number' && (
            <div
              className="app__update-bar"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
            >
              <span style={{ width: `${percent}%` }} />
            </div>
          )}
        </Banner>
      );
    }
    if (install.status === 'restarting') {
      return (
        <Banner variant="info">
          설치를 시작합니다 — 앱이 잠시 닫혔다가 <b>{update.latest}</b> 으로 다시 열립니다.
        </Banner>
      );
    }
    if (install.status === 'failed') {
      return (
        <Banner variant="danger">
          <div className="app__update-row">
            <span>
              자동 설치 실패 — {install.error}
              {install.folder && ' 받아 둔 파일로 직접 교체할 수 있습니다.'}
            </span>
            <span className="app__update-actions">
              {install.folder && (
                <Button
                  size="sm"
                  onClick={() => void window.oneApp.update.openFolder(install.folder!)}
                >
                  받은 폴더 열기
                </Button>
              )}
              <Button size="sm" onClick={() => void window.oneApp.openExternal(update.url)}>
                릴리스 페이지
              </Button>
              <Button size="sm" onClick={() => setInstall({ status: 'idle' })}>
                닫기
              </Button>
            </span>
          </div>
        </Banner>
      );
    }
    return (
      <Banner variant="info">
        <div className="app__update-row">
          <span>
            새 버전 <b>{update.latest}</b> 이 나왔습니다{' '}
            <span className="hint">(현재 {update.current})</span>
            {!update.canInstall && update.installBlocked && (
              <>
                {' '}
                — <span className="hint">{update.installBlocked}</span>
              </>
            )}
          </span>
          <span className="app__update-actions">
            {update.canInstall ? (
              <Button size="sm" variant="primary" onClick={() => void startInstall()}>
                지금 업데이트
              </Button>
            ) : (
              <Button
                size="sm"
                variant="primary"
                onClick={() => void window.oneApp.openExternal(update.url)}
              >
                받기
              </Button>
            )}
            <Button size="sm" onClick={() => setUpdateHidden(true)}>
              나중에
            </Button>
          </span>
        </div>
      </Banner>
    );
  };

  return (
    <div className="app">
      <header className="app__head">
        <span className="app__head-icon">
          <Icon name="layout-grid" size={17} />
        </span>
        <h1 className="app__title">One App Lite</h1>
        {/* 현재 버전 — 항상 보이는 자리. 새 버전 확인이 실패해도 current 는 채워져 있다 */}
        {update?.current && <span className="app__version">v{update.current}</span>}
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

      {/* 새 버전 알림 — [지금 업데이트]는 앱 안에서 받아 교체하고 다시 시작한다(updateInstall.ts).
          자동 교체가 안 되는 위치·플랫폼이면 [받기]로 릴리스 페이지를 연다 */}
      {showUpdate && <div className="app__update">{renderUpdateBanner()}</div>}

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
                sub="프로젝트·기간·레이블로 티켓을 모아 보고용 목록을 만듭니다. 필터한 뒤 원하는 형식으로 복사하세요."
              />
              <JiraReportPanel />
            </div>
          )}
          {screen === 'settings' && settings && (
            <SettingsView
              settings={settings}
              update={update}
              onUpdateInfo={setUpdate}
              onInstall={() => void startInstall()}
              installing={install.status === 'running' || install.status === 'restarting'}
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
