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

  // 목업 Weekly.dc.html 명단 행 — 66px · 이름 13/500 + 시간 모노 12.5(미달/초과면 주의색) · 4px 바 · MM 모노 11
  return (
    <button
      type="button"
      className={`weekly-roster-row weekly-roster-row--${tone}${selected ? ' is-selected' : ''}`}
      onClick={() => onSelect(name)}
      aria-pressed={selected}
    >
      <span className="weekly-roster-row__line">
        <span className="weekly-roster-row__name">{name}</span>
        <span className="weekly-roster-row__hours">
          {total.T}
          <i>/{WEEKLY_STANDARD_HOURS}</i>
        </span>
      </span>
      {/* T 진행바 — 채움 색은 tone 모디파이어가 결정 */}
      <span className="weekly-roster-row__bar">
        <span className="weekly-roster-row__fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="weekly-roster-row__mm">
        MM T <b>{mm.T}</b> / OT <b>{mm.OT}</b>
      </span>
    </button>
  );
}
