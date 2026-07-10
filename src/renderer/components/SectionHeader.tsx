import type { ReactNode } from 'react';

/** 섹션 상단 제목 + 설명 — 아이콘은 Icon 컴포넌트를 icon 으로 전달 (이모지 금지) */
export function SectionHeader({
  icon,
  title,
  sub,
}: {
  icon?: ReactNode;
  title: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <header>
      <div className="section-head">
        {icon && <span className="section-head__icon">{icon}</span>}
        <h2 className="section-head__title">{title}</h2>
      </div>
      {sub && <p className="section-head__sub">{sub}</p>}
    </header>
  );
}
