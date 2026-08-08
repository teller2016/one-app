// LNB — 워크스페이스(색 이니셜 타일) → 워크트리(브랜치·±변경량) 트리 (Superset 스타일).
// 워크트리를 고르면 상단 탭바가 그 위치의 세션들로 바뀐다.
// 행 드래그로 순서 변경, 우클릭 컨텍스트 메뉴로 이름·색·Finder·제거.
// 축소 모드에선 워크스페이스 타일 + (펼친 워크스페이스의) 워크트리 아이콘 타일이 남는다.
import { useState } from 'react';
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from 'react';
import type {
  TerminalSessionInfo,
  TerminalWorkspace,
  WorktreeInfo,
} from '../../../../shared/types';
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
} from '../../../components/ContextMenu';
import { Icon } from '../../../components/Icon';
import { Input } from '../../../components/Input';
import { Tooltip } from '../../../components/Tooltip';
import {
  initials,
  sameSelection,
  tileColor,
  worktreeName,
} from '../lib/workspace';
import type { WorkspaceSelection } from '../lib/workspace';

export function WorkspaceNav({
  workspaces,
  worktrees,
  sessions,
  selection,
  collapsed,
  expanded,
  otherCount,
  onToggleExpand,
  onSelect,
  onNewWorktree,
  onRemoveWorktree,
  onRemoveWorkspace,
  onReorder,
  onRename,
  onSetColor,
  onReveal,
}: {
  workspaces: TerminalWorkspace[];
  worktrees: Record<string, WorktreeInfo[] | undefined>;
  sessions: TerminalSessionInfo[];
  selection: WorkspaceSelection | null;
  collapsed: boolean;
  expanded: string[];
  /** 어느 워크트리에도 안 속한 세션 수 — 0 이면 '기타 세션' 행을 감춘다 */
  otherCount: number;
  onToggleExpand: (wsId: string) => void;
  onSelect: (sel: WorkspaceSelection) => void;
  onNewWorktree: (ws: TerminalWorkspace) => void;
  onRemoveWorktree: (ws: TerminalWorkspace, wt: WorktreeInfo) => void;
  onRemoveWorkspace: (ws: TerminalWorkspace) => void;
  /** 드래그 순서 변경 — 새 순서의 id 배열 */
  onReorder: (ids: string[]) => void;
  onRename: (ws: TerminalWorkspace, name: string) => void;
  onSetColor: (ws: TerminalWorkspace, color: number) => void;
  onReveal: (ws: TerminalWorkspace) => void;
}) {
  // 우클릭 컨텍스트 메뉴 — 대상 워크스페이스 + 마우스 좌표
  const [menu, setMenu] = useState<{ ws: TerminalWorkspace; x: number; y: number } | null>(null);
  // 이름 인라인 편집 (메뉴의 '이름 변경' 으로 진입)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  // 드래그 순서 변경 — 끌리는 id + 놓일 자리(대상 행 위/아래)
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);

  const openMenu = (ws: TerminalWorkspace, e: ReactMouseEvent) => {
    e.preventDefault();
    setMenu({ ws, x: e.clientX, y: e.clientY });
  };

  // Enter·blur 공용 — 빈 값이나 변경 없음이면 조용히 닫는다
  const commitRename = () => {
    const id = editingId;
    setEditingId(null);
    const ws = workspaces.find((w) => w.id === id);
    const next = draft.trim();
    if (ws && next && next !== ws.name) onRename(ws, next);
  };

  const applyDrop = () => {
    const from = dragId;
    const to = drop;
    setDragId(null);
    setDrop(null);
    if (!from || !to || from === to.id) return;
    const ids = workspaces.map((w) => w.id).filter((id) => id !== from);
    ids.splice(ids.indexOf(to.id) + (to.after ? 1 : 0), 0, from);
    onReorder(ids);
  };

  // 끌기 시작/끝 — 워크스페이스 행(펼침)·타일(축소)에 붙는다
  const dragSource = (ws: TerminalWorkspace) => ({
    draggable: editingId !== ws.id,
    onDragStart: (e: ReactDragEvent) => {
      setDragId(ws.id);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', ws.id);
    },
    onDragEnd: () => {
      // drop 이 패널 밖에서 끝나도 표시가 남지 않게
      setDragId(null);
      setDrop(null);
    },
  });

  // 드롭 존 — 행이 아니라 **그룹 전체**(워크트리 목록 포함)가 받는다.
  // 행에만 걸면 펼쳐진 워크트리 위에선 드롭이 안 돼 "동작 안 한다"고 느껴진다
  // (2026-08-06 사용자 지적). 자식에서 발화한 dragover 는 그룹으로 버블된다.
  const dropTarget = (ws: TerminalWorkspace) => ({
    onDragOver: (e: ReactDragEvent) => {
      if (!dragId || dragId === ws.id) return;
      e.preventDefault(); // 없으면 drop 이 발화하지 않는다
      e.dataTransfer.dropEffect = 'move';
      const r = e.currentTarget.getBoundingClientRect();
      const after = e.clientY > r.top + r.height / 2;
      setDrop((cur) =>
        cur?.id === ws.id && cur.after === after ? cur : { id: ws.id, after }
      );
    },
    onDrop: (e: ReactDragEvent) => {
      e.preventDefault();
      applyDrop();
    },
  });

  /** 드롭 표시 — 그룹 위/아래 액센트 선 (base: ws-group 또는 sq-group) */
  const dropClass = (ws: TerminalWorkspace, base: string) =>
    drop?.id === ws.id ? ` ${base}--drop-${drop.after ? 'after' : 'before'}` : '';

  const wsSessions = (ws: TerminalWorkspace): TerminalSessionInfo[] => {
    const paths = new Set((worktrees[ws.id] ?? []).map((w) => w.path));
    return sessions.filter((s) => paths.has(s.cwd));
  };

  const contextMenu = menu && (
    <ContextMenu
      x={menu.x}
      y={menu.y}
      onClose={() => setMenu(null)}
      aria-label={`${menu.ws.name} 워크스페이스 메뉴`}
    >
      {/* 축소 모드에선 인라인 편집 입력이 들어갈 자리가 없다 — 펼친 뒤 사용 */}
      {!collapsed && (
        <ContextMenuItem
          icon="pencil"
          label="이름 변경"
          onSelect={() => {
            setDraft(menu.ws.name);
            setEditingId(menu.ws.id);
            setMenu(null);
          }}
        />
      )}
      <ContextMenuItem
        icon="folder"
        label="Finder 에서 열기"
        onSelect={() => {
          onReveal(menu.ws);
          setMenu(null);
        }}
      />
      <ContextMenuSeparator />
      <div className="ctx__colors" role="group" aria-label="타일 색상">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            type="button"
            className={
              `ctx__swatch ctx__swatch--c${n}` +
              (tileColor(menu.ws) === n ? ' ctx__swatch--on' : '')
            }
            aria-label={`색상 ${n}${tileColor(menu.ws) === n ? ' (현재)' : ''}`}
            onClick={() => {
              onSetColor(menu.ws, n);
              setMenu(null);
            }}
          />
        ))}
      </div>
      <ContextMenuSeparator />
      <ContextMenuItem
        icon="x"
        danger
        label="워크스페이스 제거"
        onSelect={() => {
          onRemoveWorkspace(menu.ws);
          setMenu(null);
        }}
      />
    </ContextMenu>
  );

  // ── 축소 — 워크스페이스 타일 + (펼친 워크스페이스의) 워크트리 아이콘 타일, 그룹 구분선 ──
  if (collapsed) {
    return (
      <div className="terminal__list" role="list">
        {workspaces.map((ws) => {
          const inWs = wsSessions(ws);
          const waiting = inWs.some((s) => s.status === 'waiting');
          const isOpen = expanded.includes(ws.id);
          const wsActive =
            selection?.kind === 'worktree' && selection.wsId === ws.id;
          return (
            <div
              key={ws.id}
              className={
                'terminal__sq-group' + dropClass(ws, 'terminal__sq-group')
              }
              {...dropTarget(ws)}
            >
              <Tooltip
                label={`${ws.name} — 세션 ${inWs.length}개${waiting ? ' · 입력 대기' : ''} · 클릭: 워크트리 ${isOpen ? '접기' : '펼치기'}`}
              >
                {/* 펼침 모드의 행 클릭과 같은 동작 — 워크트리 타일 목록을 접고 편다
                    (예전엔 첫 워크트리를 선택했는데 두 모드의 클릭 의미가 달라 혼란 — 2026-08-06) */}
                <button
                  type="button"
                  className={
                    'terminal__ws-sq' +
                    (wsActive ? ' terminal__ws-sq--active' : '') +
                    (dragId === ws.id ? ' terminal__ws-sq--dragging' : '')
                  }
                  aria-expanded={isOpen}
                  aria-current={wsActive ? 'true' : undefined}
                  aria-label={`${ws.name} 워크스페이스 — 워크트리 ${isOpen ? '접기' : '펼치기'}`}
                  onClick={() => onToggleExpand(ws.id)}
                  onContextMenu={(e) => openMenu(ws, e)}
                  {...dragSource(ws)}
                >
                  <span
                    className={`terminal__ws-tile terminal__ws-tile--c${tileColor(ws)}`}
                    aria-hidden="true"
                  >
                    {initials(ws.name)}
                  </span>
                  {/* 자식 워크트리에 켜진 세션 합계 — 부모만 보여도 사용 중임을 알 수 있게 */}
                  {inWs.length > 0 && (
                    <span
                      className={
                        'terminal__wt-sq-count' +
                        (waiting ? ' terminal__wt-sq-count--waiting' : '')
                      }
                      aria-hidden="true"
                    >
                      {inWs.length}
                    </span>
                  )}
                </button>
              </Tooltip>
              {/* 접힘/펼침을 높이 애니메이션으로 — 조건부 렌더가 아니라 항상 두고
                  CSS(grid 0fr↔1fr)가 접는다. 접힌 동안은 visibility 로 포커스에서도 빠진다 */}
              <div
                className={
                  'terminal__wt-list terminal__wt-list--sq' +
                  (isOpen ? ' terminal__wt-list--open' : '')
                }
              >
                <div className="terminal__wt-list-inner">
                  {(worktrees[ws.id] ?? []).map((wt) => {
                    const active = sameSelection(selection, {
                      kind: 'worktree',
                      wsId: ws.id,
                      path: wt.path,
                    });
                    const count = sessions.filter((s) => s.cwd === wt.path).length;
                    const wtWaiting = sessions.some(
                      (s) => s.cwd === wt.path && s.status === 'waiting'
                    );
                    return (
                      <Tooltip
                        key={wt.path}
                        label={`${worktreeName(wt)} · ${wt.branch ?? wt.head ?? ''}${
                          count > 0 ? ` · 세션 ${count}개` : ''
                        }${wtWaiting ? ' · 입력 대기' : ''}`}
                      >
                        <button
                          type="button"
                          className={
                            'terminal__wt-sq' +
                            (active ? ' terminal__wt-sq--active' : '')
                          }
                          aria-current={active ? 'true' : undefined}
                          aria-label={`${ws.name} — ${worktreeName(wt)} 워크트리${
                            count > 0 ? ` (세션 ${count}개)` : ''
                          }`}
                          disabled={wt.missing}
                          onClick={() =>
                            onSelect({ kind: 'worktree', wsId: ws.id, path: wt.path })
                          }
                        >
                          <Icon name={wt.isMain ? 'laptop' : 'folder-git'} size={15} />
                          {count > 0 && (
                            <span
                              className={
                                'terminal__wt-sq-count' +
                                (wtWaiting ? ' terminal__wt-sq-count--waiting' : '')
                              }
                              aria-hidden="true"
                            >
                              {count}
                            </span>
                          )}
                        </button>
                      </Tooltip>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
        {otherCount > 0 && (
          <div className="terminal__sq-group">
            <Tooltip label={`기타 세션 ${otherCount}개 — 워크스페이스 밖에서 시작된 세션`}>
              <button
                type="button"
                className={
                  'terminal__ws-sq' +
                  (selection?.kind === 'other' ? ' terminal__ws-sq--active' : '')
                }
                aria-current={selection?.kind === 'other' ? 'true' : undefined}
                aria-label="기타 세션"
                onClick={() => onSelect({ kind: 'other' })}
              >
                <Icon name="terminal" size={16} />
              </button>
            </Tooltip>
          </div>
        )}
        {contextMenu}
      </div>
    );
  }

  return (
    <div className="terminal__list">
      {workspaces.map((ws) => {
        const isOpen = expanded.includes(ws.id);
        const inWs = wsSessions(ws);
        const wsWaiting = inWs.some((s) => s.status === 'waiting');
        const list = worktrees[ws.id];
        return (
          <div
            key={ws.id}
            className={'terminal__ws-group' + dropClass(ws, 'terminal__ws-group')}
            {...dropTarget(ws)}
          >
            {/* 워크스페이스 행 — 클릭 = 펼침/접힘 · 드래그 = 순서 변경 · 우클릭 = 메뉴 */}
            <div
              className={
                'terminal__ws-row' +
                (dragId === ws.id ? ' terminal__ws-row--dragging' : '')
              }
              onContextMenu={(e) => openMenu(ws, e)}
              {...dragSource(ws)}
            >
              {editingId === ws.id ? (
                <span className="terminal__ws-edit">
                  <span
                    className={`terminal__ws-tile terminal__ws-tile--c${tileColor(ws)}`}
                    aria-hidden="true"
                  >
                    {initials(ws.name)}
                  </span>
                  <Input
                    small
                    autoFocus
                    aria-label="워크스페이스 이름"
                    value={draft}
                    // 진입하면 기존 이름을 전체 선택 — 안 하면 타이핑이 기존 이름에 덧붙는다
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename();
                      else if (e.key === 'Escape') setEditingId(null);
                    }}
                    onBlur={commitRename}
                  />
                </span>
              ) : (
                <>
                  <button
                    type="button"
                    className="terminal__ws-hit"
                    aria-expanded={isOpen}
                    title={`${ws.repoPath}\n우클릭: 이름·색·제거`}
                    onClick={() => onToggleExpand(ws.id)}
                  >
                    <span
                      className={`terminal__ws-tile terminal__ws-tile--c${tileColor(ws)}`}
                      aria-hidden="true"
                    >
                      {initials(ws.name)}
                    </span>
                    <span className="terminal__ws-name">{ws.name}</span>
                    {/* 자식 워크트리에 켜진 세션 합계 — 입력 대기가 있으면 초록 */}
                    {inWs.length > 0 && (
                      <span
                        className={
                          'terminal__ws-count' +
                          (wsWaiting ? ' terminal__ws-count--waiting' : '')
                        }
                      >
                        ({inWs.length})
                      </span>
                    )}
                  </button>
                  <span className="terminal__ws-actions">
                    <Tooltip label="새 워크트리 — 브랜치를 별도 폴더에 체크아웃">
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label={`'${ws.name}' 에 새 워크트리`}
                        onClick={() => onNewWorktree(ws)}
                      >
                        <Icon name="plus" size={14} />
                      </button>
                    </Tooltip>
                    <button
                      type="button"
                      className="icon-btn"
                      aria-label={isOpen ? '워크트리 목록 접기' : '워크트리 목록 펼치기'}
                      onClick={() => onToggleExpand(ws.id)}
                    >
                      {/* 아이콘 교체가 아니라 회전 — 목록이 늘었다 줄어드는 것과 같은 박자로 돈다 */}
                      <Icon
                        name="chevron-right"
                        size={14}
                        className={
                          'terminal__ws-chevron' +
                          (isOpen ? ' terminal__ws-chevron--open' : '')
                        }
                      />
                    </button>
                  </span>
                </>
              )}
            </div>

            {/* 접힘/펼침을 높이 애니메이션으로 — 조건부 렌더가 아니라 항상 두고
                CSS(grid 0fr↔1fr)가 접는다. 접힌 동안은 visibility 로 포커스에서도 빠진다.
                워크트리 목록은 이미 전 워크스페이스분이 로드돼 있어 추가 조회가 없다 */}
            <div
              className={
                'terminal__wt-list' + (isOpen ? ' terminal__wt-list--open' : '')
              }
            >
              <div className="terminal__wt-list-inner">
                {(list ?? []).map((wt) => {
                  const active = sameSelection(selection, {
                    kind: 'worktree',
                    wsId: ws.id,
                    path: wt.path,
                  });
                  const count = sessions.filter((s) => s.cwd === wt.path).length;
                  const waiting = sessions.some(
                    (s) => s.cwd === wt.path && s.status === 'waiting'
                  );
                  return (
                    <div
                      key={wt.path}
                      className={[
                        'terminal__wt-row',
                        active ? 'terminal__wt-row--active' : '',
                        wt.missing ? 'terminal__wt-row--missing' : '',
                        waiting ? 'terminal__wt-row--waiting' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <button
                        type="button"
                        className="terminal__wt-hit"
                        aria-current={active ? 'true' : undefined}
                        title={`${wt.path}${wt.missing ? '\n(폴더가 없습니다 — git worktree prune 대상)' : ''}`}
                        disabled={wt.missing}
                        onClick={() =>
                          onSelect({ kind: 'worktree', wsId: ws.id, path: wt.path })
                        }
                      >
                        <Icon name={wt.isMain ? 'laptop' : 'folder-git'} size={14} />
                        <span className="terminal__wt-body">
                          <span className="terminal__wt-name">
                            {worktreeName(wt)}
                            {count > 0 && (
                              <span className="terminal__ws-count"> ({count})</span>
                            )}
                          </span>
                          <span className="terminal__wt-branch">
                            {wt.branch ?? (wt.head ? `detached @ ${wt.head}` : '')}
                          </span>
                        </span>
                        {(wt.additions > 0 || wt.deletions > 0) && (
                          <span className="terminal__wt-diff" aria-label="미커밋 변경량">
                            <span className="terminal__wt-add">+{wt.additions}</span>
                            <span className="terminal__wt-del">−{wt.deletions}</span>
                          </span>
                        )}
                      </button>
                      {!wt.isMain && (
                        <Tooltip label="워크트리 제거">
                          <button
                            type="button"
                            className="terminal__wt-remove"
                            aria-label={`'${worktreeName(wt)}' 워크트리 제거`}
                            onClick={() => onRemoveWorktree(ws, wt)}
                          >
                            <Icon name="x" size={14} />
                          </button>
                        </Tooltip>
                      )}
                    </div>
                  );
                })}
                {list && list.length === 0 && (
                  <p className="terminal__list-empty">워크트리가 없습니다</p>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {otherCount > 0 && (
        <div className="terminal__other-wrap">
          <div
            className={
              'terminal__wt-row terminal__other-row' +
              (selection?.kind === 'other' ? ' terminal__wt-row--active' : '')
            }
          >
            <button
              type="button"
              className="terminal__wt-hit"
              aria-current={selection?.kind === 'other' ? 'true' : undefined}
              title="워크스페이스 밖(홈 등)에서 시작된 세션"
              onClick={() => onSelect({ kind: 'other' })}
            >
              <Icon name="terminal" size={14} />
              <span className="terminal__wt-body">
                <span className="terminal__wt-name">기타 세션 ({otherCount})</span>
              </span>
            </button>
          </div>
        </div>
      )}

      {workspaces.length === 0 && (
        <p className="terminal__list-empty">
          워크스페이스가 없습니다 — 위 [+] 로 git 저장소를 등록하세요.
        </p>
      )}

      {contextMenu}
    </div>
  );
}
