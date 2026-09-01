// pane 영역(`.terminal__panes`) — 살아 있는 pane 들 + 분할 경계 그립 + 드래그 드롭 존 +
// 드롭 프리뷰. 메인 창(TerminalSection)과 팝아웃 창(TerminalPopoutApp)이 같은 마크업을
// 쓰도록 TerminalSection 에서 떼어냈다. children 은 빈 상태 안내 등 마지막 슬롯.
import type { ReactNode } from 'react';
import type { TerminalSessionInfo } from '../../../../shared/types';
import type { SplitGroups } from '../lib/useSplitGroups';
import { TerminalView } from './TerminalView';
import type { TerminalPaneHandle } from './TerminalView';

export function TerminalPanes({
  sessions,
  livePanes,
  active,
  activeId,
  fontSize,
  layoutRects,
  panesRef,
  dropZones,
  hintRect,
  onFocusPane,
  onRegisterHandle,
  onScrolledChange,
  onZoneDragOver,
  onZoneDragLeave,
  onZoneDrop,
  onSplitGripDown,
  children,
}: {
  /** 전체 세션 목록 — ⚠️ 정렬하지 않은 원본이어야 한다(pane DOM 순서 안정) */
  sessions: TerminalSessionInfo[];
  /** 살아 있는 pane 세션 id 들 (usePaneOrchestration 의 것) */
  livePanes: string[];
  /** 섹션/창이 보이는 상태인가 — 숨으면 pane 전부 '숨은 pane' 으로 내린다 */
  active: boolean;
  activeId: string | null;
  fontSize: number;
  layoutRects: SplitGroups['layoutRects'];
  panesRef: SplitGroups['panesRef'];
  dropZones: SplitGroups['dropZones'];
  hintRect: SplitGroups['hintRect'];
  onFocusPane: (id: string) => void;
  onRegisterHandle: (id: string, handle: TerminalPaneHandle | null) => void;
  onScrolledChange: (id: string, v: boolean) => void;
  onZoneDragOver: SplitGroups['onZoneDragOver'];
  onZoneDragLeave: SplitGroups['onZoneDragLeave'];
  onZoneDrop: SplitGroups['onZoneDrop'];
  onSplitGripDown: SplitGroups['onSplitGripDown'];
  /** 빈 상태 안내 등 — `__panes` 안 마지막에 렌더된다 */
  children?: ReactNode;
}) {
  /* ⚠️ 세션마다 pane 을 만들고 **보이지 않는 것도 언마운트하지 않는다** — 예전엔
     key={activeId} 로 xterm 을 매번 파괴해서, 전환할 때마다 선택 영역·검색 상태가
     사라지고 attach 왕복 + TUI 전체 리렌더를 다시 겪었다. 숨은 pane 은 absolute
     inset:0 이라 활성 pane 과 같은 크기를 유지한다 — 탭바가 위에 생겼으므로
     기준 컨테이너는 __main 이 아니라 이 __panes 다(아니면 탭바 높이만큼 어긋난다).
     분할 중에는 트리의 pane 이 전부 보이고(%rect absolute), 트리 밖 pane 만 숨는다.
     pane 들은 트리 구조와 무관하게 **플랫한 형제**로 둔다 — React 트리에서
     재부모화되면 xterm 이 언마운트된다(토스 아티클과 같은 좌표 렌더 방식). */
  return (
    <div className="terminal__panes" ref={panesRef}>
      {sessions
        // 본 적 있는 세션만 pane 을 만든다 — 섹션 진입 시 전 세션 동시 attach 방지
        .filter((s) => livePanes.includes(s.id))
        .map((s) => {
          const pane = layoutRects?.bySession.get(s.id);
          return (
            <TerminalView
              key={s.id}
              sessionId={s.id}
              // 섹션이 keep-alive 로 숨으면 pane 전부를 '숨은 pane' 으로 내린다 —
              // 크기 주장 중지(visibleRef)·⌘F 해제(focused)가 기존 게이트 그대로 걸리고,
              // 복귀 시 visible/focused effect 가 fit·재주장·리드로·포커스를 복원한다
              visible={active && (layoutRects ? !!pane : s.id === activeId)}
              focused={active && s.id === activeId}
              rectLeft={pane?.rect.left}
              rectTop={pane?.rect.top}
              rectW={pane?.rect.width}
              rectH={pane?.rect.height}
              onFocusPane={onFocusPane}
              fontSize={fontSize}
              onRegisterHandle={onRegisterHandle}
              onScrolledChange={onScrolledChange}
            />
          );
        })}
      {/* 분할 경계 그립 — SplitNode 마다 하나, 드래그 = 그 노드의 ratio 조절 */}
      {layoutRects?.grips.map((g) => (
        <div
          key={g.splitId}
          className={`terminal__split-grip terminal__split-grip--${g.orientation}`}
          role="separator"
          aria-orientation={g.orientation === 'row' ? 'vertical' : 'horizontal'}
          aria-label="분할 비율 조절"
          style={
            g.orientation === 'row'
              ? {
                  left: `${g.rect.left}%`,
                  top: `${g.rect.top}%`,
                  height: `${g.rect.height}%`,
                }
              : {
                  left: `${g.rect.left}%`,
                  top: `${g.rect.top}%`,
                  width: `${g.rect.width}%`,
                }
          }
          onPointerDown={(e) => onSplitGripDown(e, g)}
        />
      ))}
      {/* 드롭 존 — 탭 드래그 중에만 pane 전체를 덮는 투명 레이어.
          X자 판정으로 상/하/좌/우(분할)·중앙(교체)을 정하고 프리뷰를 띄운다 */}
      {dropZones?.map((z) => (
        <div
          key={z.panelId}
          className="terminal__drop-zone"
          style={{
            left: `${z.rect.left}%`,
            top: `${z.rect.top}%`,
            width: `${z.rect.width}%`,
            height: `${z.rect.height}%`,
          }}
          onDragOver={(e) => onZoneDragOver(e, z.panelId)}
          onDragLeave={onZoneDragLeave}
          onDrop={(e) => onZoneDrop(e, z.panelId)}
        />
      ))}
      {/* 드롭 프리뷰 — 분할될 반쪽(중앙 드롭이면 pane 전체)을 액센트로 표시 */}
      {hintRect && (
        <div
          className="terminal__drop-hint"
          style={{
            left: `${hintRect.left}%`,
            top: `${hintRect.top}%`,
            width: `${hintRect.width}%`,
            height: `${hintRect.height}%`,
          }}
        />
      )}
      {children}
    </div>
  );
}
