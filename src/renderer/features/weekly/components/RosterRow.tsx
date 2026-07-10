import { calcTotalMM, WEEKLY_STANDARD_HOURS, type EmployeeReport } from '../lib/report';

/**
 * 팀 목록의 사원 한 줄 — 좌우 2단 레이아웃의 왼쪽 목록에 쓰인다.
 * T합계(38h 기준 진행바·경고색)·전체 MM(T/OT 분리) 을 한눈에 비교할 수 있게 컴팩트하게 표시.
 * 상세(칩·차트·일정)는 오른쪽 상세 패널에서 보여준다.
 */
export function RosterRow({
  name,
  data,
  excluded,
  selected,
  onSelect,
}: {
  name: string;
  data: EmployeeReport;
  excluded: Set<string>;
  selected: boolean;
  onSelect: (name: string) => void;
}) {
  const total = data.summaryTotalData;
  const tone = total.T !== WEEKLY_STANDARD_HOURS ? 'warn' : 'good';
  const pct = Math.min((total.T / WEEKLY_STANDARD_HOURS) * 100, 100);
  const mm = calcTotalMM(data.summaryData, excluded);

  return (
    <button
      type="button"
      className={`weekly-roster-row weekly-roster-row--${tone}${selected ? ' is-selected' : ''}`}
      onClick={() => onSelect(name)}
    >
      <div className="weekly-roster-row__line">
        <span className="weekly-roster-row__name">{name}</span>
        <span className="weekly-roster-row__hours">
          {total.T}
          <i>/{WEEKLY_STANDARD_HOURS}</i>
        </span>
      </div>
      <div className="weekly-roster-row__bar">
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="weekly-roster-row__meta">
        <span className="weekly-roster-row__mm">
          MM T <b>{mm.T}</b> / OT <b>{mm.OT}</b>
        </span>
      </div>
    </button>
  );
}
