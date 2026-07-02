import type { ReactNode } from 'react';

export interface SidebarSection {
  id: string;
  label: string;
  icon: string;
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
        <span className="sidebar__brand-mark">◈</span>
        <span className="sidebar__brand-name">One App</span>
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
            <span className="sidebar__item-label">{s.label}</span>
          </button>
        ))}
      </nav>
      {footer && <div className="sidebar__footer">{footer}</div>}
    </aside>
  );
}
