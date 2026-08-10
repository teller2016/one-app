// 상단 세션 탭바 — 선택된 워크트리의 세션들 + [+] 새 세션 (Superset 스타일).
// 탭 더블클릭 = 이름 인라인 편집(main 의 sidecar 에 반영 — 재시작 후에도 유지).
// 탭을 끌어 pane 위에 놓으면 화면이 분할된다(드롭 존·판정은 TerminalSection 소유).
// 우측 끝에는 변경사항 토글·MO 접속 버튼이 상주한다(선택이 없어도 접근 가능해야 한다).
import { memo, useState } from 'react';
import type { DragEvent as ReactDragEvent } from 'react';
import type {
  TerminalSessionInfo,
  TerminalSessionStatus,
} from '../../../../shared/types';
import { TERMINAL_AGENT_NAMES } from '../../../../shared/types';
import { Icon } from '../../../components/Icon';
import { Input } from '../../../components/Input';
import { StatusDot } from '../../../components/StatusDot';
import { useToast } from '../../../components/Toast';
import { Tooltip } from '../../../components/Tooltip';

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

// memo — 패널 드래그(프레임마다 상태 변경)·pane 리렌더에 탭바가 끌려가지 않게.
// 상위가 콜백을 useCallback 으로 안정화하고 sessions 는 useMemo 파생값이라 실제로 유지된다.
export const SessionTabs = memo(function SessionTabs({
  sessions,
  activeId,
  draggingId,
  groupMarks,
  canCreate,
  changesOpen,
  moRunning,
  onSelect,
  onClose,
  onNew,
  onToggleChanges,
  onOpenMo,
  onDragStartSession,
  onDragEndSession,
  onDetachSession,
}: {
  /** 현재 선택(워크트리 또는 '기타')에 속한 세션들 — 그룹 멤버가 인접하게 정렬돼 온다 */
  sessions: TerminalSessionInfo[];
  activeId: string | null;
  /** 지금 끌리는 세션 — 드롭 존을 그리는 TerminalSection 이 상태를 소유한다 */
  draggingId: string | null;
  /** 분할 그룹 묶음 표시 — 멤버 세션 id → 묶음 내 위치 (그룹이 없으면 null) */
  groupMarks: Map<string, 'start' | 'mid' | 'end'> | null;
  /** 워크트리가 선택돼 있을 때만 새 세션을 만들 수 있다 ('기타'는 위치가 없다) */
  canCreate: boolean;
  changesOpen: boolean;
  moRunning: boolean;
  onSelect: (id: string) => void;
  onClose: (s: TerminalSessionInfo) => void;
  onNew: () => void;
  onToggleChanges: () => void;
  onOpenMo: () => void;
  onDragStartSession: (id: string) => void;
  onDragEndSession: () => void;
  /** 그룹 멤버 탭을 탭바에 드롭 = 그룹에서 분리(혼자 보기) */
  onDetachSession: (id: string) => void;
}) {
  const toast = useToast();
  // 이름 인라인 편집 — 탭을 더블클릭하면 제목이 입력창으로 바뀐다
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  // 분리 드롭 존 표시 — 그룹 멤버를 끌어 탭바 위에 올렸을 때만
  const [detachHover, setDetachHover] = useState(false);
  // 끌리는 탭이 그룹 멤버일 때만 탭바가 '분리' 드롭 존이 된다
  const detachable = !!draggingId && !!groupMarks?.has(draggingId);
  /** 드래그 시작한 자기 탭 위인지 — 제자리 드롭(클릭에 가까운 손놀림)을 분리로 오인하지 않게 */
  const overSelfTab = (e: ReactDragEvent) => {
    const tab = (e.target as HTMLElement).closest?.('[data-session]');
    return tab instanceof HTMLElement && tab.dataset.session === draggingId;
  };

  // Enter·blur 공용 — 빈 값이나 변경 없음이면 조용히 닫는다(main 도 같은 판정을 한다)
  const commitRename = async () => {
    const id = editingId;
    if (!id) return;
    setEditingId(null);
    const next = draft.trim();
    if (!next) return;
    try {
      await window.oneApp.terminal.rename(id, next);
    } catch (err) {
      toast(`이름 변경 실패: ${(err as Error).message}`, 'fail');
    }
  };

  return (
    /* 그룹 멤버를 끌어 올리면 탭바 전체가 '그룹에서 분리' 드롭 존이 된다 — pane 위
       드롭 존(분할·교체)과 달리 "탭으로 돌려보낸다" = 혼자 보기. 자기 탭 위에서는
       preventDefault 를 안 해 드롭이 성립하지 않는다(제자리 드롭 = 취소). */
    <div
      className={`terminal__tabs${detachHover ? ' terminal__tabs--detach' : ''}`}
      onDragOver={(e) => {
        if (!detachable) return;
        if (overSelfTab(e)) {
          setDetachHover(false);
          return;
        }
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDetachHover(true);
      }}
      onDragLeave={() => setDetachHover(false)}
      onDrop={(e) => {
        if (!detachable) return;
        e.preventDefault();
        setDetachHover(false);
        if (draggingId) onDetachSession(draggingId);
      }}
    >
      <div className="terminal__tabs-list" role="tablist" aria-label="터미널 세션">
        {sessions.map((s, i) =>
          editingId === s.id ? (
            <span key={s.id} className="terminal__tab terminal__tab--edit">
              <Input
                small
                autoFocus
                aria-label="세션 이름"
                value={draft}
                // 진입하면 기존 이름을 전체 선택 — 안 하면 타이핑이 기존 이름에 덧붙는다
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
            /* 세그먼트 탭 (Superset 동일) — 제목 좌측, 우측은 활성이면 ×, 아니면 상태점.
               래퍼 span + [선택 button][닫기 button] 형제 — 중첩 인터랙티브 금지.
               드래그 = 분할 드롭 소스 (WorkspaceNav 의 dragSource 와 같은 규칙) */
            <span
              key={s.id}
              data-session={s.id}
              className={[
                'terminal__tab',
                s.id === activeId ? 'terminal__tab--active' : '',
                s.id === draggingId ? 'terminal__tab--dragging' : '',
                groupMarks?.has(s.id)
                  ? `terminal__tab--grouped terminal__tab--group-${groupMarks.get(s.id)}`
                  : '',
              ]
                .filter(Boolean)
                .join(' ')}
              draggable
              onDragStart={(e: ReactDragEvent) => {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', s.id);
                onDragStartSession(s.id);
              }}
              onDragEnd={onDragEndSession} // 드롭이 밖에서 끝나도 표시·드롭 존이 남지 않게
              // 가운데 클릭 = 종료 (브라우저 탭 관례 — 2026-08-10 사용자 요청).
              // 래퍼에 걸어 제목·상태점 어디를 눌러도 닫힌다.
              onAuxClick={(e) => {
                if (e.button === 1) onClose(s);
              }}
            >
              <button
                type="button"
                role="tab"
                className="terminal__tab-hit"
                aria-selected={s.id === activeId}
                title={`${s.title} — ${TERMINAL_AGENT_NAMES[s.agentId]} · ${
                  STATUS_LABELS[s.status]
                }${i < 9 ? ` (⌘${i + 1})` : ''}\n더블클릭: 이름 변경 · 가운데 클릭: 종료`}
                onClick={() => onSelect(s.id)}
                onDoubleClick={() => {
                  setDraft(s.title);
                  setEditingId(s.id);
                }}
              >
                <span className="terminal__tab-title">{s.title}</span>
              </button>
              {s.id === activeId ? (
                <Tooltip label="세션 종료 (⌘⇧W)">
                  <button
                    type="button"
                    className="terminal__tab-close"
                    aria-label={`'${s.title}' 세션 종료`}
                    onClick={() => onClose(s)}
                  >
                    <Icon name="x" size={14} />
                  </button>
                </Tooltip>
              ) : (
                /* 비활성 탭 — 평소엔 상태점(작업 중·입력 대기만), hover 하면 × 로 바뀐다
                   (활성으로 전환하지 않고도 종료 가능 — 2026-08-06 사용자 요청) */
                <span className="terminal__tab-side">
                  {s.status !== 'idle' && (
                    <span className="terminal__tab-dot" aria-hidden="true">
                      <StatusDot status={STATUS_DOT[s.status]} />
                    </span>
                  )}
                  <Tooltip label="세션 종료">
                    <button
                      type="button"
                      className="terminal__tab-close terminal__tab-close--hover"
                      aria-label={`'${s.title}' 세션 종료`}
                      onClick={() => onClose(s)}
                    >
                      <Icon name="x" size={14} />
                    </button>
                  </Tooltip>
                </span>
              )}
            </span>
          )
        )}
        {canCreate && (
          <Tooltip label="새 세션 — 에이전트 선택 (⌘T: 바로 셸)">
            <button
              type="button"
              className="terminal__tab-add"
              aria-label="새 세션"
              onClick={onNew}
            >
              <Icon name="plus" size={14} />
            </button>
          </Tooltip>
        )}
      </div>

      <div className="terminal__tabs-actions">
        <Tooltip label="변경사항 — 선택한 워크트리의 git 상태·커밋·푸시">
          <button
            type="button"
            className={`icon-btn${changesOpen ? ' terminal__changes-btn--on' : ''}`}
            aria-label="변경사항"
            aria-pressed={changesOpen}
            onClick={onToggleChanges}
          >
            <Icon name="git-branch" size={16} />
          </button>
        </Tooltip>
        <Tooltip label={`모바일(MO) 접속${moRunning ? ' — 서버 켜짐' : ' — 서버 꺼짐'}`}>
          <button
            type="button"
            className={`icon-btn terminal__mo-btn${moRunning ? ' terminal__mo-btn--on' : ''}`}
            aria-label="모바일(MO) 접속"
            onClick={onOpenMo}
          >
            <Icon name="smartphone" size={16} />
          </button>
        </Tooltip>
      </div>
    </div>
  );
});
