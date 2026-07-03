import { calculateMM, type ProjectSummary } from '../lib/report';

/**
 * 프로젝트 칩 목록 — 시간(MM) 표시, 클릭 시 전체 MM 계산에서 제외/포함 토글.
 * 제외 상태는 프로젝트명 기준 전역(모든 사원 공통)이다.
 */
export function ProjectChips({
  summaryData,
  excluded,
  onToggle,
}: {
  summaryData: ProjectSummary[];
  excluded: Set<string>;
  onToggle: (project: string) => void;
}) {
  return (
    <div className="weekly-chips">
      {summaryData.map((it) => {
        const hours = it.T + it.OT;
        const isExcluded = excluded.has(it.name);
        return (
          <span
            key={it.name}
            className={'weekly-chip' + (isExcluded ? ' weekly-chip--excluded' : '')}
            title={isExcluded ? 'MM 제외됨 (클릭하여 포함)' : 'MM 포함됨 (클릭하여 제외)'}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(it.name);
            }}
          >
            <span className="weekly-chip__nm">{it.name}</span>
            <span className="weekly-chip__hr">{hours}</span>
            <span className="weekly-chip__mm">({calculateMM(hours)})</span>
          </span>
        );
      })}
    </div>
  );
}
