import type { ReactNode } from 'react';

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

/** 왼쪽 사이드바 — 섹션 목록과 선택 상태를 표시한다. */
export function Sidebar({
  sections,
  activeId,
  onSelect,
  footer,
}: {
  sections: SidebarSection[];
  activeId: string;
  onSelect: (id: string) => void;
  footer?: ReactNode; // 하단 고정 영역 (근태 위젯 등)
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <span className="sidebar__brand-mark">
          {/* 브랜드 로고 마크 — 둥근 사각 + 코어 */}
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
            <rect x="3" y="3" width="18" height="18" rx="5" />
            <circle cx="12" cy="12" r="4" />
          </svg>
        </span>
        <span>One App</span>
      </div>
      <nav className="sidebar__nav">
        {sections
          .filter((s) => !s.bottom)
          .map((s) => (
            <button
              key={s.id}
              className={
                'sidebar__item' +
                (s.id === activeId ? ' sidebar__item--active' : '')
              }
              onClick={() => onSelect(s.id)}
            >
              <span className="sidebar__item-icon">{s.icon}</span>
              <span>{s.label}</span>
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
          ))}
      </nav>
      {/* 하단 분리 그룹 (환경설정 등) — 메인 메뉴와 뚝 떨어져 위젯 바로 위 */}
      <nav className="sidebar__nav sidebar__nav--bottom">
        {sections
          .filter((s) => s.bottom)
          .map((s) => (
            <button
              key={s.id}
              className={
                'sidebar__item' +
                (s.id === activeId ? ' sidebar__item--active' : '')
              }
              onClick={() => onSelect(s.id)}
            >
              <span className="sidebar__item-icon">{s.icon}</span>
              <span>{s.label}</span>
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
          ))}
      </nav>
      {footer && <div className="sidebar__footer">{footer}</div>}
    </aside>
  );
}
