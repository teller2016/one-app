import { calcTotalMM, type EmployeeReport } from '../lib/report';

/**
 * 팀 목록의 사원 한 줄 — 좌우 2단 레이아웃의 왼쪽 목록에 쓰인다.
 * T합계(40 기준 진행바·경고색)·OT·전체 MM 을 한눈에 비교할 수 있게 컴팩트하게 표시.
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
  const tone = total.T !== 40 ? 'warn' : 'good';
  const pct = Math.min((total.T / 40) * 100, 100);

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
          <i>/40</i>
        </span>
      </div>
      <div className="weekly-roster-row__bar">
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="weekly-roster-row__meta">
        {total.OT > 0 && (
          <span className="weekly-roster-row__ot">OT {total.OT}</span>
        )}
        <span className="weekly-roster-row__mm">
          MM <b>{calcTotalMM(data.summaryData, excluded)}</b>
        </span>
      </div>
    </button>
  );
}
