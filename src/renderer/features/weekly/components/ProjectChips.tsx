import { type ProjectSummary } from '../lib/report';

/**
 * 프로젝트 칩 목록 — 구분(프로젝트)별 T/OT 시간·MM 을 분리 표시, 클릭 시 전체 MM 계산에서 제외/포함 토글.
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
        const isExcluded = excluded.has(it.name);
        const hasT = it.T > 0 || it.OT === 0; // T가 있거나, T·OT 둘 다 0이면 T 0 으로 표시
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
            {hasT && (
              <span className="weekly-chip__seg">
                <span className="weekly-chip__lbl">T</span>
                <span className="weekly-chip__hr">{it.T}</span>
                <span className="weekly-chip__mm">({it.TMM})</span>
              </span>
            )}
            {hasT && it.OT > 0 && <span className="weekly-chip__sep">·</span>}
            {it.OT > 0 && (
              <span className="weekly-chip__seg weekly-chip__seg--ot">
                <span className="weekly-chip__lbl weekly-chip__lbl--ot">OT</span>
                <span className="weekly-chip__hr">{it.OT}</span>
                <span className="weekly-chip__mm">({it.OTMM})</span>
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}
