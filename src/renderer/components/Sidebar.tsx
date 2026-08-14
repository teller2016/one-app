import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { beginPointerDrag } from '../lib/pointerDrag';

/**
 * 사이드바가 접혀 있는지 — 안쪽 위젯이 축소 상태에 맞춰 동작을 바꿀 때 쓴다.
 * (접히면 글자가 사라져 아이콘이 유일한 진입점이 되므로, 그 아이콘의 역할이 달라질 수 있다)
 * 사이드바 밖(예: MO 셸)에서 호출하면 항상 false — 기존 동작 그대로다.
 */
const CollapsedContext = createContext(false);

export const useSidebarCollapsed = () => useContext(CollapsedContext);

export interface SidebarSection {
  id: string;
  label: string;
  /** 섹션 아이콘 — Icon 컴포넌트 엘리먼트 (이모지 금지) */
  icon: ReactNode;
  /** true 면 메뉴 하단 그룹으로 분리 (환경설정 등) */
  bottom?: boolean;
  /** 항목 우측 카운트 뱃지 (0 이거나 없으면 숨김 — Jira 미해결 수 등) */
  badge?: number;
  /** true 면 뱃지를 액센트 필로 강조 (확인 안 한 새 티켓 등) */
  badgeAccent?: boolean;
}

// 축소 폭 60 = 좌우 패딩(8) + 아이콘 필 44 — 72 는 아이콘 하나에 비해 넓었다(2026-08-06)
// macOS 신호등(창 좌상단 고정)은 전체폭 타이틀바(.topbar)가 흡수하므로 이 폭과 무관하다 —
// 사이드바 항목은 --titlebar-h 아래에서 시작하고, 탑바 컨트롤은 --titlebar-safe 오른쪽에서 시작한다.
const COLLAPSED_W = 60;
const MIN_W = 180;
const MAX_W = 320;
const DEFAULT_W = 220;
/** 드래그로 이 폭 아래까지 끌면 축소 모드로 넘어간다 */
const SNAP_W = 150;

function savedWidth(): number {
  const saved = Number(localStorage.getItem('sidebar:width'));
  return Number.isFinite(saved) && saved >= MIN_W && saved <= MAX_W
    ? saved
    : DEFAULT_W;
}

/** 왼쪽 사이드바 — 섹션 목록과 선택 상태를 표시한다. 우측 테두리를 끌어 폭을 바꾸고, 좁히면 아이콘만 남는다. */
export function Sidebar({
  sections,
  activeId,
  onSelect,
  header,
  footer,
}: {
  sections: SidebarSection[];
  activeId: string;
  onSelect: (id: string) => void;
  header?: ReactNode; // 최상단 고정 영역 (메일 위젯 등) — 브랜드와 메뉴 사이에 분리 표시
  footer?: ReactNode; // 하단 고정 영역 (근태 위젯 등)
}) {
  const [width, setWidth] = useState(savedWidth);
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('sidebar:collapsed') === '1',
  );
  // 폭 전환 애니메이션은 접기/펴기에만 준다 — 드래그 중에는 폭이 손끝을 그대로
  // 따라와야 하므로 CSS 에서 transition 을 끈다(끌림이 생기면 조작감이 무너진다)
  const [dragging, setDragging] = useState(false);
  // 드래그 중에는 상태만 갱신하고 저장은 놓는 순간 1회 (터미널 드로어 grip 과 같은 규칙)
  const widthRef = useRef(width);
  const collapsedRef = useRef(collapsed);

  const applied = collapsed ? COLLAPSED_W : width;

  // 사이드바 폭에 기대는 다른 레이아웃(.jira-view 등)이 같은 값을 보도록 전역 변수로 노출한다.
  // theme.ts 가 <html data-theme> 을 쓰는 것과 같은 방식.
  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-w', `${applied}px`);
  }, [applied]);

  const onGripDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = collapsedRef.current ? COLLAPSED_W : widthRef.current;
    // 접으려고 왼쪽으로 끌면 도중에 180px 구간을 지나며 폭이 최소값으로 갱신된다.
    // 그대로 두면 320px 로 넓혀 뒀던 사람이 한 번 접었다 펴는 순간 180px 을 얻는다 →
    // 접힌 채로 끝나면 '펼쳤을 때 폭'은 드래그 시작 시점 값으로 되돌린다.
    const keepW = widthRef.current;
    setDragging(true);
    beginPointerDrag(e, {
      cursor: 'col-resize',
      onMove: (ev) => {
        const raw = startW + (ev.clientX - startX);
        if (raw < SNAP_W) {
          collapsedRef.current = true;
          setCollapsed(true);
          return;
        }
        collapsedRef.current = false;
        setCollapsed(false);
        const w = Math.round(Math.min(MAX_W, Math.max(MIN_W, raw)));
        widthRef.current = w;
        setWidth(w);
      },
      onEnd: () => {
        setDragging(false);
        if (collapsedRef.current) {
          widthRef.current = keepW;
          setWidth(keepW);
        }
        localStorage.setItem('sidebar:width', String(widthRef.current));
        localStorage.setItem('sidebar:collapsed', collapsedRef.current ? '1' : '0');
      },
    });
  };

  /** 키보드로도 접거나 펼 수 있어야 한다 — grip 은 포커스를 받는 separator 다 */
  const toggle = () => {
    const next = !collapsedRef.current;
    collapsedRef.current = next;
    setCollapsed(next);
    localStorage.setItem('sidebar:collapsed', next ? '1' : '0');
  };

  const item = (s: SidebarSection) => (
    <button
      key={s.id}
      className={
        'sidebar__item' + (s.id === activeId ? ' sidebar__item--active' : '')
      }
      // 축소 모드에선 라벨이 감춰지므로 title 이 이름을 대신한다
      title={s.label}
      onClick={() => onSelect(s.id)}
    >
      <span className="sidebar__item-icon">{s.icon}</span>
      <span className="sidebar__item-label">{s.label}</span>
      {s.badge != null && s.badge > 0 && (
        <span
          className={
            'sidebar__item-badge' +
            (s.badgeAccent ? ' sidebar__item-badge--accent' : '')
          }
        >
          {s.badge}
        </span>
      )}
    </button>
  );

  return (
    <CollapsedContext.Provider value={collapsed}>
      <aside
        className={
          'sidebar' +
          (collapsed ? ' sidebar--collapsed' : '') +
          (dragging ? ' sidebar--dragging' : '')
        }
        style={{ width: applied, minWidth: applied }}
      >
        <div className="sidebar__brand">
          <span className="sidebar__brand-mark">
            {/* 브랜드 로고 마크 — 2×2 타일 그리드, 왼위 타일만 채움 (앱 아이콘과 통일) */}
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="3" width="7" height="7" rx="1.5" fill="currentColor" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" />
            </svg>
          </span>
          <span className="sidebar__brand-name">One App</span>
        </div>
        {header && <div className="sidebar__header">{header}</div>}
        <nav className="sidebar__nav">
          {sections.filter((s) => !s.bottom).map(item)}
        </nav>
        {/* 하단 분리 그룹 (환경설정 등) — 메인 메뉴와 뚝 떨어져 위젯 바로 위 */}
        <nav className="sidebar__nav sidebar__nav--bottom">
          {sections.filter((s) => s.bottom).map(item)}
        </nav>
        {footer && <div className="sidebar__footer">{footer}</div>}

        {/* 우측 테두리 손잡이 — 끌어서 폭 조절, 더블클릭·Enter 로 접기/펴기 */}
        <div
          className="sidebar__grip"
          role="separator"
          aria-orientation="vertical"
          aria-label={collapsed ? '사이드바 펼치기' : '사이드바 접기'}
          tabIndex={0}
          onPointerDown={onGripDown}
          onDoubleClick={toggle}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggle();
            }
          }}
        />
      </aside>
    </CollapsedContext.Provider>
  );
}
