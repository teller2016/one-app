import type { ReactNode } from 'react';

export interface SidebarSection {
  id: string;
  label: string;
  /** 섹션 아이콘 — Icon 컴포넌트 엘리먼트 (이모지 금지) */
  icon: ReactNode;
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
        {sections.map((s) => (
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
          </button>
        ))}
      </nav>
      {footer && <div className="sidebar__footer">{footer}</div>}
    </aside>
  );
}
