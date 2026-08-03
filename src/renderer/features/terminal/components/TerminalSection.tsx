// 터미널 섹션 — 세션 탭바 + 새 세션(프로젝트 cwd 선택) + xterm 뷰.
// 세션은 main 프로세스 소유라 탭·창을 닫아도 유지되고, MO(모바일)와 같은 세션을 공유한다.
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { useConfirm } from '../../../components/ConfirmDialog';
import { EmptyState } from '../../../components/EmptyState';
import { Icon } from '../../../components/Icon';
import { Select } from '../../../components/Select';
import { useToast } from '../../../components/Toast';
import { MoAccessModal } from './MoAccessModal';
import { TerminalView } from './TerminalView';
import { useCallback, useEffect, useState } from 'react';
import type { Project, TerminalSessionInfo } from '../../../../shared/types';

// 터미널 IPC 노출 여부 — 개발 중 main/preload 변경은 HMR 이 안 되므로(렌더러만 갱신)
// 앱을 재시작하기 전까지 이 API 가 없다. 없으면 버튼이 조용히 죽는 대신 안내를 띄운다.
const terminalApi = () => window.oneApp?.terminal;

export function TerminalSection() {
  const confirm = useConfirm();
  const toast = useToast();
  const [sessions, setSessions] = useState<TerminalSessionInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [cwd, setCwd] = useState(''); // '' = 홈 디렉터리
  const [creating, setCreating] = useState(false);
  const [moOpen, setMoOpen] = useState(false);
  const [moRunning, setMoRunning] = useState(false);
  const available = !!terminalApi();

  const refresh = useCallback(async () => {
    const api = terminalApi();
    if (!api) return;
    const list = await api.list();
    setSessions(list);
    // 활성 탭이 사라졌으면(세션 종료) 첫 세션으로 폴백
    setActiveId((cur) =>
      cur && list.some((s) => s.id === cur) ? cur : list[0]?.id ?? null
    );
  }, []);

  useEffect(() => {
    const api = terminalApi();
    if (!api) return;
    void refresh();
    return api.onSessions(() => void refresh());
  }, [refresh]);

  // 새 세션 위치 후보 — 프로젝트 레지스트리의 로컬 경로 (claude 세션은 보통 프로젝트에서)
  useEffect(() => {
    void window.oneApp?.projects.list().then(setProjects);
    return window.oneApp?.projects.onChanged(setProjects);
  }, []);

  // MO 서버 실행 여부 — 툴바 아이콘에 상태 점 표시
  useEffect(() => {
    const api = terminalApi();
    if (!api) return;
    const refreshMo = async () => setMoRunning((await api.server.status()).running);
    void refreshMo();
    return api.server.onChanged(() => void refreshMo());
  }, []);

  const createSession = async () => {
    const api = terminalApi();
    if (!api) return;
    setCreating(true);
    try {
      const info = await api.create(cwd ? { cwd } : {});
      await refresh();
      setActiveId(info.id);
    } catch (err) {
      // 셸 실행 실패·핸들러 부재 등 — 조용히 묻히면 버튼이 고장 난 것처럼 보인다
      toast(`세션 생성 실패: ${(err as Error).message}`, 'fail');
    } finally {
      setCreating(false);
    }
  };

  const closeSession = async (s: TerminalSessionInfo) => {
    const ok = await confirm({
      title: '세션 종료',
      message: `'${s.title}' 세션의 프로세스가 종료됩니다.`,
      confirmLabel: '종료',
      danger: true,
    });
    if (!ok) return;
    try {
      await terminalApi()?.kill(s.id);
    } catch (err) {
      toast(`세션 종료 실패: ${(err as Error).message}`, 'fail');
    }
  };

  if (!available) {
    return (
      <div className="terminal">
        <Banner variant="warning">
          터미널 IPC 가 아직 로드되지 않았습니다 — 개발 중에는 렌더러만 핫리로드되므로
          main·preload 변경을 반영하려면 <code>npm start</code> 를 다시 실행해야 합니다.
        </Banner>
      </div>
    );
  }

  return (
    <div className="terminal">
      <div className="terminal__toolbar">
        <div className="terminal__tabs">
          {sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`terminal__tab${
                s.id === activeId ? ' terminal__tab--active' : ''
              }`}
              title={s.cwd}
              onClick={() => setActiveId(s.id)}
            >
              <span className="terminal__tab-label">{s.title}</span>
              <span
                className="terminal__tab-close"
                role="button"
                aria-label="세션 종료"
                onClick={(e) => {
                  e.stopPropagation();
                  void closeSession(s);
                }}
              >
                <Icon name="x" size={12} />
              </span>
            </button>
          ))}
        </div>
        <div className="terminal__actions">
          {/* className 은 Select 의 루트(.picker)에 붙는다 — 루트가 inline-flex 라
              좁으면 드롭다운 팝오버까지 그 폭에 갇혀 프로젝트 이름이 잘린다 */}
          <Select
            small
            className="terminal__cwd"
            aria-label="새 세션 위치"
            value={cwd}
            onChange={setCwd}
            options={[
              { value: '', label: '홈 디렉터리' },
              ...projects.map((p) => ({ value: p.localPath, label: p.name })),
            ]}
          />
          <Button size="sm" loading={creating} onClick={() => void createSession()}>
            새 세션
          </Button>
          <button
            type="button"
            className={`icon-btn terminal__mo-btn${
              moRunning ? ' terminal__mo-btn--on' : ''
            }`}
            title={`모바일(MO) 접속${moRunning ? ' — 서버 켜짐' : ''}`}
            onClick={() => setMoOpen(true)}
          >
            <Icon name="smartphone" size={16} />
          </button>
        </div>
      </div>

      {moOpen && <MoAccessModal onClose={() => setMoOpen(false)} />}

      {activeId ? (
        <TerminalView key={activeId} id={activeId} />
      ) : (
        <div className="terminal__empty">
          <EmptyState
            icon="terminal"
            message="열린 세션이 없습니다"
            hint="새 세션으로 시작하세요 — 세션은 앱이 실행 중인 동안 유지되고, 모바일(MO)에서도 이어서 쓸 수 있습니다."
          />
        </div>
      )}
    </div>
  );
}
