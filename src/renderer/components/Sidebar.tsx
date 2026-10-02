import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { useRegisterCommands } from '../lib/commands';
import { beginPointerDrag } from '../lib/pointerDrag';
import { Icon } from './Icon';

export interface SidebarSection {
  id: string;
  label: string;
  /** 섹션 아이콘 — Icon 컴포넌트 엘리먼트 (이모지 금지) */
  icon: ReactNode;
  /** true 면 메뉴 하단 그룹으로 분리 (환경설정 등) */
  bottom?: boolean;
  /** 메뉴 그룹 라벨 (개발·리소스·업무) — 같은 값이 연속된 항목끼리 묶고, 값이 바뀌는 자리에 라벨을 그린다 */
  group?: string;
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
  onOpenPalette,
}: {
  sections: SidebarSection[];
  activeId: string;
  onSelect: (id: string) => void;
  /** ⌘P 명령 팔레트 열기 — 브랜드 아래 '이동 · 명령' 버튼 */
  onOpenPalette: () => void;
}) {
  const [width, setWidth] = useState(savedWidth);
  // 기본은 접힘 — 저장값이 '0'(직접 펼침)일 때만 펼친다(2026-10-02 사용자 결정). 개발 인스턴스는 Vite 포트가
  // 바뀌면 origin 이 달라 localStorage 가 비어 늘 기본값으로 뜬다
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('sidebar:collapsed') !== '0',
  );
  // 폭 전환 애니메이션은 접기/펴기에만 준다 — 드래그 중에는 폭이 손끝을 그대로
  // 따라와야 하므로 CSS 에서 transition 을 끈다(끌림이 생기면 조작감이 무너진다)
  const [dragging, setDragging] = useState(false);
  // 드래그 중에는 상태만 갱신하고 저장은 놓는 순간 1회 (터미널 드로어 grip 과 같은 규칙)
  const widthRef = useRef(width);
  const collapsedRef = useRef(collapsed);
  // ⌘\ 로 완전히 숨김(축소 아이콘 줄까지) — 접기/펴기와 별개 상태라 다시 보이면
  // 숨기기 전 모양(펼침/축소)으로 돌아온다. 터미널을 넓게 쓰려는 용도(2026-10-01 사용자 요청)
  const [hidden, setHidden] = useState(
    () => localStorage.getItem('sidebar:hidden') === '1',
  );

  const applied = hidden ? 0 : collapsed ? COLLAPSED_W : width;

  const toggleHidden = useCallback(() => {
    setHidden((v) => {
      localStorage.setItem('sidebar:hidden', v ? '0' : '1');
      return !v;
    });
  }, []);

  // capture 로 받아 xterm 보다 먼저 잡는다(⌘P 팔레트와 같은 방식).
  // ⚠️ e.key 가 아니라 e.code — 한국어 자판에서는 같은 키가 '₩' 로 들어온다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.shiftKey || e.altKey || e.ctrlKey) return;
      if (e.code !== 'Backslash' || e.isComposing) return;
      e.preventDefault();
      e.stopPropagation();
      toggleHidden();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [toggleHidden]);

  useRegisterCommands('sidebar', () => [
    {
      id: 'sidebar:toggle-hidden',
      group: '명령',
      label: hidden ? '메뉴 사이드바 보이기' : '메뉴 사이드바 숨기기',
      hint: '⌘\\',
      keywords: 'sidebar lnb menu hide',
      icon: 'maximize',
      run: toggleHidden,
    },
  ]);

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
        localStorage.setItem(
          'sidebar:collapsed',
          collapsedRef.current ? '1' : '0',
        );
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

  // 그룹 라벨 — 앞 항목과 group 이 달라지는 자리에만 (축소 모드에선 짧은 구분선이 된다)
  const main = sections.filter((s) => !s.bottom);
  const grouped = main.map((s, i) => (
    <Fragment key={s.id}>
      {s.group && s.group !== main[i - 1]?.group && (
        <div className="sidebar__group" role="presentation">
          <span className="sidebar__group-label">{s.group}</span>
        </div>
      )}
      {item(s)}
    </Fragment>
  ));

  return (
    <aside
      className={
        'sidebar' +
        (collapsed ? ' sidebar--collapsed' : '') +
        (hidden ? ' sidebar--hidden' : '') +
        (dragging ? ' sidebar--dragging' : '')
      }
      style={{ width: applied, minWidth: applied }}
      // 숨긴 동안 Tab 포커스·스크린리더에서도 빠진다
      inert={hidden}
    >
      <div className="sidebar__brand">
        <span className="sidebar__brand-mark">
          {/* 브랜드 마크 — 앱 아이콘(assets/icon.png)과 같은 도형: 스퀘클 + 2×2 타일, 왼위만 켜짐.
                색은 SCSS 토큰이 칠한다(테마를 따라간다 — 다크: 흑연, 라이트: 밝은 회색) */}
          <svg
            width="22"
            height="22"
            viewBox="100 100 824 824"
            aria-hidden="true"
          >
            <rect
              className="sidebar__brand-bg"
              x="100"
              y="100"
              width="824"
              height="824"
              rx="190"
            />
            <rect
              className="sidebar__brand-on"
              x="248"
              y="248"
              width="240"
              height="240"
              rx="64"
            />
            <rect
              className="sidebar__brand-off"
              x="536"
              y="248"
              width="240"
              height="240"
              rx="64"
            />
            <rect
              className="sidebar__brand-off"
              x="248"
              y="536"
              width="240"
              height="240"
              rx="64"
            />
            <rect
              className="sidebar__brand-off"
              x="536"
              y="536"
              width="240"
              height="240"
              rx="64"
            />
          </svg>
        </span>
        <span className="sidebar__brand-name">One App</span>
      </div>
      {/* ⌘P 팔레트 진입점 — 단축키를 모르는 사람도 찾게 버튼으로도 둔다 */}
      <button
        type="button"
        className="sidebar__cmd"
        onClick={onOpenPalette}
        title="이동 · 명령 (⌘P)"
        aria-label="이동 · 명령 (⌘P)"
      >
        <Icon name="search" size={14} />
        <span className="sidebar__cmd-label">이동 · 명령</span>
        <kbd className="sidebar__cmd-kbd">⌘P</kbd>
      </button>
      <nav className="sidebar__nav">{grouped}</nav>
      {/* 하단 분리 그룹 (환경설정) — 위젯은 하단 상태바로 옮겼다(StatusBar) */}
      <nav className="sidebar__nav sidebar__nav--bottom">
        {sections.filter((s) => s.bottom).map(item)}
      </nav>

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
  );
}
