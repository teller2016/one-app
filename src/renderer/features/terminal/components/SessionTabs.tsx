// 상단 세션 탭바 — 선택된 워크트리의 세션들 + [+] 새 세션 (Superset 스타일).
// 탭 더블클릭 = 이름 인라인 편집(main 의 sidecar 에 반영 — 재시작 후에도 유지).
// 탭을 끌어 pane 위에 놓으면 화면이 분할된다(드롭 존·판정은 TerminalSection 소유).
// 탭을 끌어 **다른 탭의 좌우 가장자리**에 놓으면 탭 순서가 바뀐다(아래 REORDER_EDGE).
// 우측 끝에는 변경사항 토글·MO 접속 버튼이 상주한다(선택이 없어도 접근 가능해야 한다).
import { memo, useEffect, useRef, useState } from 'react';
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
import { errMsg } from '../../../lib/errMsg';

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

// 스프링 로딩 대기 — 드래그 중 다른 탭 위에 이만큼 머물면 그 화면이 열린다.
// 0 이면 탭바를 가로지르기만 해도 화면이 연쇄 전환되고, 길면 굼떠 보인다.
const HOVER_OPEN_MS = 180;

// 순서 변경 존 — 아이템(단일 탭·그룹 통탭) 좌우 이 비율 안쪽이 '앞/뒤에 삽입'이고,
// 가운데는 기존 스프링 로딩(그 화면 열기) 영역이다. pane 드롭의 중앙 데드존과 같은 개념:
// 한 제스처에 두 뜻을 담되 조준 위치로 가른다. 탭 폭이 150px 고정이라 0.3 = 45px 씩.
const REORDER_EDGE = 0.3;

// memo — 패널 드래그(프레임마다 상태 변경)·pane 리렌더에 탭바가 끌려가지 않게.
// 상위가 콜백을 useCallback 으로 안정화하고 sessions 는 useMemo 파생값이라 실제로 유지된다.
/** 탭바 표시 항목 — 단일 세션 또는 분할 그룹(멤버들이 하나의 박스로 묶인다) */
export type TabItem =
  | { kind: 'single'; session: TerminalSessionInfo }
  | { kind: 'group'; members: TerminalSessionInfo[] };

export const SessionTabs = memo(function SessionTabs({
  items,
  activeId,
  draggingId,
  canCreate,
  changesOpen,
  moRunning,
  editorName,
  canOpenEditor,
  onSelect,
  onClose,
  onNew,
  onToggleChanges,
  onOpenMo,
  onOpenEditor,
  onDragStartSession,
  onDragEndSession,
  onDetachSession,
  onReorder,
}: {
  /** 표시 항목(순서 = 표시 순서) — 그룹은 멤버 칩들을 tab-pack 박스로 감싼다 */
  items: TabItem[];
  activeId: string | null;
  /** 지금 끌리는 세션 — 드롭 존을 그리는 TerminalSection 이 상태를 소유한다 */
  draggingId: string | null;
  /** 워크트리가 선택돼 있을 때만 새 세션을 만들 수 있다 ('기타'는 위치가 없다) */
  canCreate: boolean;
  changesOpen: boolean;
  moRunning: boolean;
  /** 워크트리를 열 IDE 이름 — 미설치면 null 이고 버튼 자체를 그리지 않는다 */
  editorName: string | null;
  /** 워크트리가 선택돼 있을 때만 열 수 있다 (canCreate 와 같은 조건) */
  canOpenEditor: boolean;
  onSelect: (id: string) => void;
  onClose: (s: TerminalSessionInfo) => void;
  onNew: () => void;
  onToggleChanges: () => void;
  onOpenMo: () => void;
  onOpenEditor: () => void;
  onDragStartSession: (id: string) => void;
  onDragEndSession: () => void;
  /** 그룹 멤버 탭을 탭바에 드롭 = 그룹에서 분리(혼자 보기) */
  onDetachSession: (id: string) => void;
  /** 탭 순서 변경 — 새 순서의 세션 id 배열(그룹 멤버는 인접한 채로 함께 옮겨진다) */
  onReorder: (ids: string[]) => void;
}) {
  const toast = useToast();
  // 이름 인라인 편집 — 탭을 더블클릭하면 제목이 입력창으로 바뀐다
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  // 분리 드롭 존 표시 — 그룹 멤버를 끌어 탭바 위에 올렸을 때만
  const [detachHover, setDetachHover] = useState(false);
  // 순서 변경 삽입선 — 놓을 자리(아이템 인덱스 + 그 앞/뒤)
  const [dropAt, setDropAt] = useState<{ index: number; after: boolean } | null>(null);
  // 끌리는 탭이 그룹 멤버일 때만 탭바가 '분리' 드롭 존이 된다
  const detachable =
    !!draggingId &&
    items.some(
      (it) => it.kind === 'group' && it.members.some((m) => m.id === draggingId)
    );
  /** 탭(또는 그룹 장) 위인지 — 탭 위에서는 분리 하이라이트·드롭을 끈다: 탭 하버는
   *  '그 화면 열기'(스프링 로딩)지 분리가 아니다(2026-08-10 사용자 지적 — 탭 위인데
   *  바 전체가 accent 로 칠해졌다). 자기 탭 제자리 드롭 방지도 이걸로 함께 해결된다. */
  const overTabArea = (e: ReactDragEvent) => {
    const el = e.target as HTMLElement;
    return !!el.closest?.('[data-session], .terminal__tab-pack');
  };

  // 스프링 로딩 — 드래그 중 다른 탭 위에 잠시 머물면 그 탭(그룹 멤버면 그 그룹)의
  // 화면이 열린다(2026-08-10 사용자 요청). 원하는 화면을 하버로 열어 두고 아래
  // pane 에 놓으면 그 화면과 분할된다. 드롭 대상이 되는 게 아니라 **화면만** 바꾼다.
  const hoverOpenRef = useRef<{ id: string; timer: number } | null>(null);
  const clearHoverOpen = () => {
    if (!hoverOpenRef.current) return;
    window.clearTimeout(hoverOpenRef.current.timer);
    hoverOpenRef.current = null;
  };
  const onTabDragOver = (id: string) => {
    if (!draggingId || id === draggingId || id === activeId) return;
    if (hoverOpenRef.current?.id === id) return; // 같은 탭 위 — 이미 대기 중
    clearHoverOpen();
    hoverOpenRef.current = {
      id,
      timer: window.setTimeout(() => {
        hoverOpenRef.current = null;
        onSelect(id);
      }, HOVER_OPEN_MS),
    };
  };
  // 드래그가 끝나면(드롭·취소 모두 draggingId 가 비워진다) 대기 중인 전환·삽입선을 버린다
  useEffect(() => {
    if (!draggingId) {
      clearHoverOpen();
      setDropAt(null);
    }
  }, [draggingId]);

  // ── 활성 탭을 보이는 곳으로 ─────────────────────────────────────────
  // 탭바는 가로 스크롤(`overflow-x: auto`)이라 탭이 많으면 활성 탭이 화면 밖일 수 있다.
  // 클릭 전환은 원래 보이던 탭이지만 ⌘1..9·⌃Tab·새 세션·히스토리 복원은 **안 보이는 탭**을
  // 고를 수 있어서, 안 끌어오면 "전환했는데 어디로 갔는지 모르겠다"가 된다.
  // ⚠️ deps 는 activeId 뿐 — items 까지 넣으면 세션 상태 브로드캐스트(초 단위)마다 돌아서
  //    사용자가 손으로 밀어 둔 탭바 스크롤이 계속 되돌아온다.
  // ⚠️ `block: 'nearest'` — 없으면 섹션 전체가 세로로 함께 스크롤된다.
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!activeId) return;
    listRef.current
      ?.querySelector(`[data-session="${activeId}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeId]);

  // ── 순서 변경 — 탭을 끌어 다른 아이템의 좌우 가장자리에 놓으면 표시 순서가 바뀐다.
  // 이동 단위는 **탭바 아이템**(단일 탭 또는 그룹 통탭 전체)이다 — 그룹 안 멤버 순서는
  // 분할 트리가 소유하므로(pane 드롭이 바꾼다) 여기서는 그룹을 통째로 옮긴다.
  /** 끌리는 세션이 속한 아이템 위치 — 그룹 멤버를 끌면 그 그룹이 이동 단위가 된다 */
  const fromIndex = !draggingId
    ? -1
    : items.findIndex((it) =>
        it.kind === 'single'
          ? it.session.id === draggingId
          : it.members.some((m) => m.id === draggingId)
      );

  /** 놓아도 순서가 그대로인 자리(자기 앞·자기 뒤) — 표시도 드롭도 만들지 않는다 */
  const noopDrop = (index: number, after: boolean) => {
    const to = index + (after ? 1 : 0);
    return to === fromIndex || to === fromIndex + 1;
  };

  /** 아이템 위 dragover — 가장자리면 삽입선을 세우고, 가운데면 스프링 로딩에 양보한다.
   *  반환 true = 순서를 조준하는 중(호출부는 화면 전환 타이머를 걸지 않는다) */
  const onItemDragOver = (e: ReactDragEvent, index: number): boolean => {
    if (fromIndex < 0) return false;
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const after = x > 1 - REORDER_EDGE;
    if (!after && x >= REORDER_EDGE) {
      setDropAt(null);
      return false; // 가운데 — 그 화면 열기(스프링 로딩) 영역
    }
    clearHoverOpen(); // 순서를 조준하는 동안 화면이 밑에서 바뀌지 않게
    if (noopDrop(index, after)) {
      setDropAt(null);
      return true;
    }
    e.preventDefault(); // 없으면 drop 이 발화하지 않는다 — 이 자리에서만 성립시킨다
    e.dataTransfer.dropEffect = 'move';
    // dragover 는 고빈도 — 같은 값이면 setState 를 만들지 않는다
    setDropAt((cur) =>
      cur?.index === index && cur.after === after ? cur : { index, after }
    );
    return true;
  };

  /** 삽입선 자리대로 새 순서(평탄한 세션 id 배열)를 만들어 올린다 */
  const applyReorder = (e: ReactDragEvent) => {
    e.preventDefault();
    // ⚠️ 탭바 컨테이너의 '그룹에서 분리' 드롭까지 함께 발화하면 안 된다 — 그룹을 옮기려고
    // 멤버 탭을 끌었을 때 순서 변경과 분리가 동시에 일어난다.
    e.stopPropagation();
    const at = dropAt;
    setDropAt(null);
    // ⚠️ 위 stopPropagation 이 document 안전망(dragSession 회수)까지 막으므로 직접 끝낸다 —
    // 남기면 드롭 존 오버레이가 pane 을 덮은 채 굳어 휠·클릭이 전부 삼켜진다
    // (terminal.md '분할 그룹' 절 — detachSession 이 같은 이유로 직접 정리한다).
    onDragEndSession();
    if (!at || fromIndex < 0) return;
    // 아이템 = 블록(단일은 1개, 그룹은 멤버 전원) — 블록째로 옮기고 평탄화한다
    const blocks = items.map((it) =>
      it.kind === 'single' ? [it.session.id] : it.members.map((m) => m.id)
    );
    const [moved] = blocks.splice(fromIndex, 1);
    const to = at.index + (at.after ? 1 : 0);
    // splice 로 소스를 이미 뺐으므로 뒤쪽으로 옮길 때는 자리를 하나 당긴다
    blocks.splice(to > fromIndex ? to - 1 : to, 0, moved);
    onReorder(blocks.flat());
  };

  /** 삽입선 클래스 — LNB 워크스페이스 행(--drop-before/after)과 같은 문법, 방향만 세로 */
  const dropClass = (index: number, base: string) =>
    dropAt?.index === index ? ` ${base}--drop-${dropAt.after ? 'after' : 'before'}` : '';

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
      toast(`이름 변경 실패: ${errMsg(err)}`, 'fail');
    }
  };

  // 표시 순서상의 번호 — ⌘1..9 안내 (그룹 멤버도 한 자리씩 차지한다)
  const flatIndex = new Map<string, number>();
  {
    let n = 0;
    for (const it of items) {
      if (it.kind === 'single') flatIndex.set(it.session.id, n++);
      else for (const m of it.members) flatIndex.set(m.id, n++);
    }
  }

  /** 탭 칩 하나 — 단일 탭과 그룹 멤버가 같은 마크업을 쓴다(그룹은 pack 박스가 감쌀 뿐).
   *  래퍼 span + [선택 button][닫기 button] 형제 — 중첩 인터랙티브 금지.
   *  드래그 = 분할 드롭 소스 (WorkspaceNav 의 dragSource 와 같은 규칙)
   *  `item` 은 **단일 탭일 때만** 온다 — 그 경우 칩 자신이 아이템이라 순서 변경 드롭까지
   *  받는다(그룹 멤버는 감싸는 tab-pack 이 아이템이라 그쪽이 받는다). */
  const renderTab = (s: TerminalSessionInfo, item?: { index: number }) => {
    if (editingId === s.id)
      return (
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
      );
    const i = flatIndex.get(s.id) ?? 9; // 9 이상 = ⌘ 안내 생략
    return (
      <span
        key={s.id}
        data-session={s.id}
        className={
          [
            'terminal__tab',
            s.id === activeId ? 'terminal__tab--active' : '',
            s.id === draggingId ? 'terminal__tab--dragging' : '',
          ]
            .filter(Boolean)
            .join(' ') + (item ? dropClass(item.index, 'terminal__tab') : '')
        }
        draggable
        onDragStart={(e: ReactDragEvent) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', s.id);
          onDragStartSession(s.id);
        }}
        onDragEnd={onDragEndSession} // 드롭이 밖에서 끝나도 표시·드롭 존이 남지 않게
        onDragOver={(e: ReactDragEvent) => {
          // 가장자리(순서 조준)면 스프링 로딩을 걸지 않는다 — 두 뜻이 겹치지 않게
          if (item && onItemDragOver(e, item.index)) return;
          onTabDragOver(s.id); // 스프링 로딩 — 위 주석 참고
        }}
        onDrop={item ? applyReorder : undefined}
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
          }${i < 9 ? ` (⌘${i + 1})` : ''}\n더블클릭: 이름 변경 · 가운데 클릭: 종료\n드래그: 탭 좌우 끝에 놓으면 순서 변경 · 화면에 놓으면 분할`}
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
    );
  };

  return (
    /* 그룹 멤버를 끌어 올리면 탭바의 **빈 영역**이 '그룹에서 분리' 드롭 존이 된다 —
       pane 위 드롭 존(분할·교체)과 달리 "탭으로 돌려보낸다" = 혼자 보기.
       탭 위에서는 preventDefault 를 안 해 드롭이 성립하지 않는다 — 탭 하버는
       스프링 로딩(그 화면 열기)이 맡고, 제자리 드롭(클릭에 가까운 손놀림)도 막힌다. */
    <div
      className={`terminal__tabs${detachHover ? ' terminal__tabs--detach' : ''}`}
      onDragOver={(e) => {
        if (!detachable) return;
        if (overTabArea(e)) {
          setDetachHover(false);
          return;
        }
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDetachHover(true);
      }}
      onDragLeave={() => {
        setDetachHover(false);
        // 탭바를 벗어나면 대기 중인 스프링 로딩도 버린다 — 안 버리면 pane 을 조준하는
        // 사이 타이머가 발화해 화면이 밑에서 바뀐다. 삽입선도 함께 거둔다(안 거두면
        // pane 을 조준하는 동안 탭바에 놓을 자리 표시가 남는다).
        clearHoverOpen();
        setDropAt(null);
      }}
      onDrop={(e) => {
        if (!detachable) return;
        e.preventDefault();
        setDetachHover(false);
        clearHoverOpen();
        if (draggingId) onDetachSession(draggingId);
      }}
    >
      <div
        className="terminal__tabs-list"
        role="tablist"
        aria-label="터미널 세션"
        ref={listRef}
      >
        {items.map((it, idx) =>
          it.kind === 'single' ? (
            renderTab(it.session, { index: idx })
          ) : (
            /* 분할 그룹 = 탭 한 장(통탭) — 멤버는 일반 탭과 같은 마크업(클릭·더블클릭·
               드래그·가운데 클릭 전부 동일)이고, 장이 활성(멤버 중 하나가 activeId)이면
               --active 로 아래 면과 이어진다(스타일은 SCSS __tab-pack).
               순서 변경 드롭은 **장 전체**가 받는다 — 멤버 위 dragover 도 여기로 버블하므로
               판정 기준(rect)은 장의 좌우 끝이고, 옮겨질 단위도 그룹 전체다. */
            <span
              key={`pack:${it.members[0].id}`}
              className={
                `terminal__tab-pack${
                  it.members.some((m) => m.id === activeId)
                    ? ' terminal__tab-pack--active'
                    : ''
                }` + dropClass(idx, 'terminal__tab-pack')
              }
              role="group"
              aria-label={`분할 그룹 — ${it.members.map((m) => m.title).join(', ')}`}
              onDragOver={(e) => {
                onItemDragOver(e, idx);
              }}
              onDrop={applyReorder}
            >
              {it.members.map((m) => renderTab(m))}
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
        {editorName && (
          <Tooltip
            label={
              canOpenEditor
                ? `선택한 워크트리를 ${editorName} 로 열기`
                : `워크트리를 선택하면 ${editorName} 로 열 수 있습니다`
            }
          >
            <button
              type="button"
              className="icon-btn"
              aria-label={`${editorName} 로 열기`}
              disabled={!canOpenEditor}
              onClick={onOpenEditor}
            >
              <Icon name="code-xml" size={16} />
            </button>
          </Tooltip>
        )}
        <Tooltip label="변경사항 (⌘B) — 선택한 워크트리의 git 상태·커밋·푸시">
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
