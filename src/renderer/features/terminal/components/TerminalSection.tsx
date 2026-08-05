// 터미널 섹션 — 좌측 세션 목록(에이전트·상태 표시) + 우측 xterm 뷰 (Superset 스타일).
// 세션은 main 프로세스 소유라 탭·창을 닫아도 유지되고, MO(모바일)와 같은 세션을 공유한다.
// 상태(작업중/입력대기/유휴)는 main 의 출력/침묵 휴리스틱이 판정해 push 한다.
import { Banner } from '../../../components/Banner';
import { useConfirm } from '../../../components/ConfirmDialog';
import { EmptyState } from '../../../components/EmptyState';
import { Icon } from '../../../components/Icon';
import { Input } from '../../../components/Input';
import { StatusDot } from '../../../components/StatusDot';
import { useToast } from '../../../components/Toast';
import { Tooltip } from '../../../components/Tooltip';
import { ChangesView } from '../../changes';
import { MoAccessModal } from './MoAccessModal';
import { NewSessionModal } from './NewSessionModal';
import {
  FONT_SIZE_DEFAULT,
  FONT_SIZE_KEY,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  TerminalView,
} from './TerminalView';
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

// 터미널 글자 크기 — 세션 pane 이 여러 개 살아 있으므로 값은 여기 한 곳에서만 들고
// 모든 pane 에 내려준다 (화면 취향이라 localStorage 로 충분 — 보존 대상 아님)
function savedFontSize(): number {
  const n = Number(localStorage.getItem(FONT_SIZE_KEY));
  return Number.isFinite(n) && n >= FONT_SIZE_MIN && n <= FONT_SIZE_MAX
    ? n
    : FONT_SIZE_DEFAULT;
}

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

  const [fontSize, setFontSize] = useState(savedFontSize);
  const changeFontSize = (n: number) => {
    localStorage.setItem(FONT_SIZE_KEY, String(n));
    setFontSize(n);
  };

  // 세션 이름 인라인 편집 — 행을 더블클릭하면 제목이 입력창으로 바뀐다
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const startRename = (s: TerminalSessionInfo) => {
    setDraft(s.title);
    setEditingId(s.id);
  };

  // Enter·blur 공용 — 빈 값이나 변경 없음이면 조용히 닫는다(main 도 같은 판정을 한다)
  const commitRename = async () => {
    const id = editingId;
    if (!id) return;
    setEditingId(null);
    const next = draft.trim();
    if (!next) return;
    try {
      await terminalApi()?.rename(id, next);
    } catch (err) {
      toast(`이름 변경 실패: ${(err as Error).message}`, 'fail');
    }
  };

  // 부수효과는 updater 밖에서 — updater 는 순수해야 한다(StrictMode 이중 호출)
  const toggleChanges = () => {
    const next = !changesOpen;
    localStorage.setItem('terminal:changesOpen', next ? '1' : '0');
    setChangesOpen(next);
  };

  // 드로어 너비 드래그 — 이동 중엔 상태만 갱신하고 저장은 놓는 순간 1회
  const [changesWidth, setChangesWidth] = useState(savedChangesWidth);
  const changesWidthRef = useRef(changesWidth);

  const onChangesGripDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = changesWidthRef.current;
    // 포인터 캡처 — 없으면 창 밖에서 버튼을 놓았을 때 pointerup 을 못 받아
    // body 의 col-resize 커서와 리스너가 그대로 남는다
    e.currentTarget.setPointerCapture(e.pointerId);
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

  const activeSession = sessions.find((s) => s.id === activeId) ?? null;

  // 세션 단축키 — ⌘T 새 세션 · ⌘1..9 전환 · ⌃Tab 순환 · ⌘⇧W 종료.
  // ⚠️ capture 단계 + stopPropagation 으로 잡는다 — bubble 로 잡으면 xterm 의 textarea
  // 핸들러가 먼저 처리해 같은 키가 셸에도 전달된다(⌃Tab 이 특히 그렇다).
  // ⚠️ ⌘W(창 닫기)·⌘+/-(전체 UI 줌)는 Electron 기본 메뉴가 선점하므로 쓰지 않는다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // 이름 편집·검색 입력 중에는 넘긴다 (xterm 의 입력은 textarea 라 여기 안 걸린다)
      if ((document.activeElement as HTMLElement | null)?.tagName === 'INPUT') return;
      const claim = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (e.ctrlKey && !e.metaKey && e.key === 'Tab') {
        if (sessions.length < 2) return;
        claim();
        const cur = sessions.findIndex((s) => s.id === activeId);
        const next =
          (cur + (e.shiftKey ? -1 : 1) + sessions.length) % sessions.length;
        setActiveId(sessions[next].id);
        return;
      }
      if (!e.metaKey || e.altKey || e.ctrlKey) return;
      if (e.shiftKey) {
        if (e.key.toLowerCase() === 'w' && activeSession) {
          claim();
          void closeSession(activeSession);
        }
        return;
      }
      if (e.key === 't') {
        claim();
        setNewOpen(true);
      } else if (e.key >= '1' && e.key <= '9') {
        const target = sessions[Number(e.key) - 1];
        if (!target) return;
        claim();
        setActiveId(target.id);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // closeSession 은 매 렌더 새로 만들어지지만 그 안에서 쓰는 confirm·toast 가 안정적이라
    // 세션 목록·활성 세션만 의존성으로 둔다
  }, [sessions, activeId, activeSession]);

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
            <Tooltip label="새 세션 (⌘T)">
              <button
                type="button"
                className="icon-btn"
                aria-label="새 세션"
                onClick={() => setNewOpen(true)}
              >
                <Icon name="plus" size={16} />
              </button>
            </Tooltip>
            <Tooltip label="변경사항 — 활성 세션 위치의 git 상태·diff·푸시">
              <button
                type="button"
                className={`icon-btn${changesOpen ? ' terminal__changes-btn--on' : ''}`}
                aria-label="변경사항"
                aria-pressed={changesOpen}
                onClick={toggleChanges}
              >
                <Icon name="git-branch" size={16} />
              </button>
            </Tooltip>
            <Tooltip
              label={`모바일(MO) 접속${moRunning ? ' — 서버 켜짐' : ' — 서버 꺼짐'}`}
            >
              <button
                type="button"
                className={`icon-btn terminal__mo-btn${
                  moRunning ? ' terminal__mo-btn--on' : ''
                }`}
                aria-label="모바일(MO) 접속"
                onClick={() => setMoOpen(true)}
              >
                <Icon name="smartphone" size={16} />
              </button>
            </Tooltip>
          </div>
        </div>

        {/* 행은 래퍼 div + 형제 버튼 2개 — 예전엔 닫기가 선택 버튼 '안'에 있어
            중첩 인터랙티브였고(키보드로 종료 불가) 마크업도 유효하지 않았다 */}
        <div className="terminal__list">
          {sessions.map((s) => (
            <div
              key={s.id}
              className={[
                'terminal__session',
                s.id === activeId ? 'terminal__session--active' : '',
                s.status === 'waiting' ? 'terminal__session--waiting' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {editingId === s.id ? (
                <span className="terminal__session-edit">
                  <StatusDot status={STATUS_DOT[s.status]} />
                  <Input
                    small
                    autoFocus
                    aria-label="세션 이름"
                    value={draft}
                    // 진입하면 기존 이름을 전체 선택 — Finder·VSCode 의 이름 바꾸기와 같게
                    // (안 하면 커서가 끝에 놓여 타이핑이 기존 이름에 덧붙는다)
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void commitRename();
                      else if (e.key === 'Escape') setEditingId(null);
                    }}
                    onBlur={() => void commitRename()}
                  />
                </span>
              ) : (
                <>
                  <button
                    type="button"
                    className="terminal__session-hit"
                    // aria-current 로 활성 세션을 스크린리더에 알린다 (색·배경만으로는 안 전달됨)
                    aria-current={s.id === activeId ? 'true' : undefined}
                    title={`${s.cwd}\n더블클릭하면 이름을 바꿉니다`}
                    onClick={() => setActiveId(s.id)}
                    onDoubleClick={() => startRename(s)}
                  >
                    <StatusDot status={STATUS_DOT[s.status]} />
                    <span className="terminal__session-body">
                      <span className="terminal__session-title">{s.title}</span>
                      <span className="terminal__session-sub">
                        {TERMINAL_AGENT_NAMES[s.agentId]} · {STATUS_LABELS[s.status]}
                      </span>
                    </span>
                  </button>
                  <Tooltip label="세션 종료">
                    <button
                      type="button"
                      className="terminal__session-close"
                      aria-label={`'${s.title}' 세션 종료`}
                      onClick={() => void closeSession(s)}
                    >
                      <Icon name="x" size={15} />
                    </button>
                  </Tooltip>
                </>
              )}
            </div>
          ))}
          {sessions.length === 0 && (
            <p className="terminal__list-empty">열린 세션이 없습니다</p>
          )}
        </div>
      </aside>

      {/* ⚠️ 세션마다 pane 을 만들고 **보이지 않는 것도 언마운트하지 않는다** — 예전엔
          key={activeId} 로 xterm 을 매번 파괴해서, 전환할 때마다 선택 영역·검색 상태가
          사라지고 attach 왕복 + TUI 전체 리렌더(대체 화면이면 replay 생략)를 다시 겪었다.
          (tmux 백엔드에선 스크롤백 자체가 xterm 에 없다 — TerminalView 주석 참고) */}
      <div className="terminal__main">
        {sessions.map((s) => (
          <TerminalView
            key={s.id}
            session={s}
            active={s.id === activeId}
            fontSize={fontSize}
            onFontSize={changeFontSize}
            onCreated={setActiveId}
          />
        ))}
        {!activeSession && (
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
