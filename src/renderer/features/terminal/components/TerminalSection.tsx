// 터미널 섹션 — 좌측 세션 목록(에이전트·상태 표시) + 우측 xterm 뷰 (Superset 스타일).
// 세션은 main 프로세스 소유라 탭·창을 닫아도 유지되고, MO(모바일)와 같은 세션을 공유한다.
// 상태(작업중/입력대기/유휴)는 main 의 출력/침묵 휴리스틱이 판정해 push 한다.
import { Banner } from '../../../components/Banner';
import { useConfirm } from '../../../components/ConfirmDialog';
import { EmptyState } from '../../../components/EmptyState';
import { Icon } from '../../../components/Icon';
import { StatusDot } from '../../../components/StatusDot';
import { useToast } from '../../../components/Toast';
import { ChangesView } from '../../changes';
import { MoAccessModal } from './MoAccessModal';
import { NewSessionModal } from './NewSessionModal';
import { TerminalView } from './TerminalView';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type {
  TerminalSessionInfo,
  TerminalSessionStatus,
} from '../../../../shared/types';
import { TERMINAL_AGENT_NAMES } from '../../../../shared/types';

// 터미널 IPC 노출 여부 — 개발 중 main/preload 변경은 HMR 이 안 되므로(렌더러만 갱신)
// 앱을 재시작하기 전까지 이 API 가 없다. 없으면 버튼이 조용히 죽는 대신 안내를 띄운다.
const terminalApi = () => window.oneApp?.terminal;

// waiting 은 "준비됨"(초록) — busy 의 경고색 펄스와 대비시켜 훑어보기 쉽게
const STATUS_DOT: Record<TerminalSessionStatus, 'busy' | 'ok' | 'idle'> = {
  busy: 'busy',
  waiting: 'ok',
  idle: 'idle',
};
const STATUS_LABELS: Record<TerminalSessionStatus, string> = {
  busy: '작업 중',
  waiting: '입력 대기',
  idle: '유휴',
};

// 변경사항 드로어 너비 — 좌측 모서리 드래그로 조절, localStorage 기억
const CHANGES_MIN_W = 240;
const CHANGES_MAX_W = 640;
const CHANGES_DEFAULT_W = 320;

function savedChangesWidth(): number {
  const saved = Number(localStorage.getItem('terminal:changesWidth'));
  return Number.isFinite(saved) && saved >= CHANGES_MIN_W && saved <= CHANGES_MAX_W
    ? saved
    : CHANGES_DEFAULT_W;
}

export function TerminalSection() {
  const confirm = useConfirm();
  const toast = useToast();
  const [sessions, setSessions] = useState<TerminalSessionInfo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [moOpen, setMoOpen] = useState(false);
  const [moRunning, setMoRunning] = useState(false);
  // 변경사항 드로어 — 열림 여부는 세션과 무관한 화면 취향이라 localStorage 로 기억
  const [changesOpen, setChangesOpen] = useState(
    () => localStorage.getItem('terminal:changesOpen') === '1'
  );
  const available = !!terminalApi();

  const toggleChanges = () =>
    setChangesOpen((v) => {
      localStorage.setItem('terminal:changesOpen', v ? '0' : '1');
      return !v;
    });

  // 드로어 너비 드래그 — 이동 중엔 상태만 갱신하고 저장은 놓는 순간 1회
  const [changesWidth, setChangesWidth] = useState(savedChangesWidth);
  const changesWidthRef = useRef(changesWidth);

  const onChangesGripDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = changesWidthRef.current;
    // 드래그 중 xterm 위를 지나도 커서·텍스트 선택이 흔들리지 않게 body 에 고정
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    const move = (ev: PointerEvent) => {
      const w = Math.min(
        CHANGES_MAX_W,
        Math.max(CHANGES_MIN_W, startW + startX - ev.clientX)
      );
      changesWidthRef.current = w;
      setChangesWidth(w);
    };
    const up = () => {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      localStorage.setItem('terminal:changesWidth', String(changesWidthRef.current));
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const applySessions = useCallback((list: TerminalSessionInfo[]) => {
    setSessions(list);
    // 활성 세션이 사라졌으면(종료) 첫 세션으로 폴백
    setActiveId((cur) =>
      cur && list.some((s) => s.id === cur) ? cur : list[0]?.id ?? null
    );
  }, []);

  // 목록·상태는 main 이 payload 로 push — 재조회는 최초 1회뿐
  useEffect(() => {
    const api = terminalApi();
    if (!api) return;
    void api.list().then(applySessions);
    return api.onSessions((list) => {
      if (list) applySessions(list);
      else void api.list().then(applySessions); // payload 미탑재(구버전 main) 폴백
    });
  }, [applySessions]);

  // MO 서버 실행 여부 — 아이콘에 상태 점 표시
  useEffect(() => {
    const api = terminalApi();
    if (!api) return;
    const refreshMo = async () => setMoRunning((await api.server.status()).running);
    void refreshMo();
    return api.server.onChanged(() => void refreshMo());
  }, []);

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
      <aside className="terminal__side">
        <div className="terminal__side-head">
          <span className="terminal__side-title">세션</span>
          <div className="terminal__side-actions">
            <button
              type="button"
              className="icon-btn"
              title="새 세션"
              onClick={() => setNewOpen(true)}
            >
              <Icon name="plus" size={16} />
            </button>
            <button
              type="button"
              className={`icon-btn${changesOpen ? ' terminal__changes-btn--on' : ''}`}
              title="변경사항 (활성 세션 위치의 git 상태·diff·푸시)"
              onClick={toggleChanges}
            >
              <Icon name="git-branch" size={16} />
            </button>
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

        <div className="terminal__list">
          {sessions.map((s) => (
            <button
              key={s.id}
              type="button"
              className={[
                'terminal__session',
                s.id === activeId ? 'terminal__session--active' : '',
                s.status === 'waiting' ? 'terminal__session--waiting' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              title={s.cwd}
              onClick={() => setActiveId(s.id)}
            >
              <StatusDot status={STATUS_DOT[s.status]} />
              <span className="terminal__session-body">
                <span className="terminal__session-title">{s.title}</span>
                <span className="terminal__session-sub">
                  {TERMINAL_AGENT_NAMES[s.agentId]} · {STATUS_LABELS[s.status]}
                </span>
              </span>
              <span
                className="terminal__session-close"
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
          {sessions.length === 0 && (
            <p className="terminal__list-empty">열린 세션이 없습니다</p>
          )}
        </div>
      </aside>

      <div className="terminal__main">
        {activeId ? (
          <TerminalView key={activeId} id={activeId} />
        ) : (
          <div className="terminal__empty">
            <EmptyState
              icon="terminal"
              message="열린 세션이 없습니다"
              hint="[+] 로 프로젝트·에이전트를 골라 시작하세요 — 세션은 앱이 실행 중인 동안 유지되고, 모바일(MO)에서도 이어서 쓸 수 있습니다."
            />
          </div>
        )}
      </div>

      {/* 변경사항 드로어 — 활성 세션 cwd 의 git 상태. key 로 세션 전환 시 상태 리셋 */}
      {changesOpen && activeId && (
        <aside className="terminal__changes" style={{ width: changesWidth }}>
          <div
            className="terminal__changes-grip"
            role="separator"
            aria-orientation="vertical"
            aria-label="변경사항 패널 너비 조절"
            onPointerDown={onChangesGripDown}
          />
          <ChangesView key={activeId} target={{ sessionId: activeId }} />
        </aside>
      )}

      {newOpen && (
        <NewSessionModal
          onCreated={setActiveId}
          onClose={() => setNewOpen(false)}
        />
      )}
      {moOpen && <MoAccessModal onClose={() => setMoOpen(false)} />}
    </div>
  );
}
