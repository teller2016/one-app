import { ProjectChips } from './ProjectChips';
import { calcTotalMM, type EmployeeReport } from '../lib/report';

/** 사원 요약 카드 — T 합계(40 기준 경고색)·프로젝트 칩·전체 MM. 클릭 시 하단 상세 선택 */
export function EmployeeCard({
  name,
  data,
  excluded,
  selected,
  onSelect,
  onToggleExclude,
}: {
  name: string;
  data: EmployeeReport;
  excluded: Set<string>;
  selected: boolean;
  onSelect: (name: string) => void;
  onToggleExclude: (project: string) => void;
}) {
  const total = data.summaryTotalData;
  const tone = total.T !== 40 ? 'warn' : 'good';

  return (
    <div
      className={`weekly-card weekly-card--${tone}${selected ? ' weekly-card--selected' : ''}`}
      onClick={() => onSelect(name)}
    >
      <div className="weekly-card__top">
        <span className="weekly-card__name">{name}</span>
        <span className={`weekly-hours weekly-hours--${tone}`}>
          <span className="weekly-hours__big">{total.T}</span>
          <span className="weekly-hours__den">/40</span>
        </span>
      </div>

      <ProjectChips
        summaryData={data.summaryData}
        excluded={excluded}
        onToggle={onToggleExclude}
      />

      <div className="weekly-card__foot">
        전체 MM <b>{calcTotalMM(data.summaryData, excluded)}</b>
      </div>
    </div>
  );
}
