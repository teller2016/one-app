import type { ReactNode } from 'react';

/** 섹션 상단 제목 + 설명 */
export function SectionHeader({
  title,
  sub,
}: {
  title: ReactNode;
  sub?: ReactNode;
}) {
  return (
    <header>
      <h2 className="section-head__title">{title}</h2>
      {sub && <p className="section-head__sub">{sub}</p>}
    </header>
  );
}
