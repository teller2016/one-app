// 상단 세션 탭바 — 선택된 워크트리의 세션들 + [+] 새 세션 (Superset 스타일).
// 탭 더블클릭 = 이름 인라인 편집(main 의 sidecar 에 반영 — 재시작 후에도 유지).
// 우측 끝에는 변경사항 토글·MO 접속 버튼이 상주한다(선택이 없어도 접근 가능해야 한다).
import { useState } from 'react';
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

export function SessionTabs({
  sessions,
  activeId,
  canCreate,
  changesOpen,
  moRunning,
  onSelect,
  onClose,
  onNew,
  onToggleChanges,
  onOpenMo,
}: {
  /** 현재 선택(워크트리 또는 '기타')에 속한 세션들 */
  sessions: TerminalSessionInfo[];
  activeId: string | null;
  /** 워크트리가 선택돼 있을 때만 새 세션을 만들 수 있다 ('기타'는 위치가 없다) */
  canCreate: boolean;
  changesOpen: boolean;
  moRunning: boolean;
  onSelect: (id: string) => void;
  onClose: (s: TerminalSessionInfo) => void;
  onNew: () => void;
  onToggleChanges: () => void;
  onOpenMo: () => void;
}) {
  const toast = useToast();
  // 이름 인라인 편집 — 탭을 더블클릭하면 제목이 입력창으로 바뀐다
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

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
    <div className="terminal__tabs">
      <div className="terminal__tabs-list" role="tablist" aria-label="터미널 세션">
        {sessions.map((s, i) =>
          editingId === s.id ? (
            <span key={s.id} className="terminal__tab terminal__tab--edit">
              <StatusDot status={STATUS_DOT[s.status]} />
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
            /* 래퍼 span + [선택 button][닫기 button] 형제 — 중첩 인터랙티브 금지 */
            <span
              key={s.id}
              className={[
                'terminal__tab',
                s.id === activeId ? 'terminal__tab--active' : '',
                s.status === 'waiting' ? 'terminal__tab--waiting' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <button
                type="button"
                role="tab"
                className="terminal__tab-hit"
                aria-selected={s.id === activeId}
                title={`${s.title} — ${TERMINAL_AGENT_NAMES[s.agentId]} · ${
                  STATUS_LABELS[s.status]
                }${i < 9 ? ` (⌘${i + 1})` : ''}\n더블클릭하면 이름을 바꿉니다`}
                onClick={() => onSelect(s.id)}
                onDoubleClick={() => {
                  setDraft(s.title);
                  setEditingId(s.id);
                }}
              >
                <StatusDot status={STATUS_DOT[s.status]} />
                <span className="terminal__tab-title">{s.title}</span>
              </button>
              <Tooltip label="세션 종료 (⌘⇧W)">
                <button
                  type="button"
                  className="terminal__tab-close"
                  aria-label={`'${s.title}' 세션 종료`}
                  onClick={() => onClose(s)}
                >
                  <Icon name="x" size={13} />
                </button>
              </Tooltip>
            </span>
          )
        )}
        {canCreate && (
          <Tooltip label="새 세션 (⌘T)">
            <button
              type="button"
              className="terminal__tab-add"
              aria-label="새 세션"
              onClick={onNew}
            >
              <Icon name="plus" size={15} />
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
}
