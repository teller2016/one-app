import { useEffect, useRef } from 'react';
import { Chart, registerables } from 'chart.js';
import type { ChartOptions, Plugin } from 'chart.js';

Chart.register(...registerables);
import { ProjectChips } from './ProjectChips';
import { calcTotalMM, getColor, WEEKLY_STANDARD_HOURS, type EmployeeReport } from '../lib/report';

// 다크 테마 차트 색 (_base.scss 변수와 톤 맞춤)
const TICK_COLOR = '#9aa0a6';
const GRID_COLOR = '#34363b';

const barOptions: ChartOptions<'bar'> = {
  responsive: true,
  maintainAspectRatio: false,
  scales: {
    x: { ticks: { color: TICK_COLOR, font: { size: 11 } }, grid: { display: false } },
    y: {
      stacked: true,
      beginAtZero: true,
      ticks: { color: TICK_COLOR, font: { size: 11 } },
      grid: { color: GRID_COLOR },
    },
  },
  plugins: {
    legend: { labels: { color: TICK_COLOR, boxWidth: 10, font: { size: 10 } } },
  },
};

const roundOptions: ChartOptions<'doughnut'> = {
  responsive: true,
  maintainAspectRatio: false,
  cutout: '68%',
  plugins: {
    legend: {
      position: 'right',
      labels: { color: TICK_COLOR, boxWidth: 10, font: { size: 10 } },
    },
  },
};

/** 도넛 중앙에 총 시간 표시 */
const centerTextPlugin = (val: number): Plugin<'doughnut'> => ({
  id: 'weeklyCenterText',
  afterDraw(chart) {
    const meta = chart.getDatasetMeta(0);
    if (!meta?.data?.length) return;
    const el = meta.data[0];
    const { ctx } = chart;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#e4e6eb';
    ctx.font = '700 21px sans-serif';
    ctx.fillText(String(val), el.x, el.y - 6);
    ctx.fillStyle = TICK_COLOR;
    ctx.font = '400 10px sans-serif';
    ctx.fillText('시간', el.x, el.y + 13);
    ctx.restore();
  },
});

/** 선택한 사원의 상세 — 요일별 T/OT 막대, 프로젝트 비중 도넛, 상세 일정(Copy) */
export function EmployeeDetail({
  name,
  data,
  projectList,
  excluded,
  onToggleExclude,
  onCopy,
}: {
  name: string;
  data: EmployeeReport;
  projectList: string[];
  excluded: Set<string>;
  onToggleExclude: (project: string) => void;
  onCopy: (text: string) => void;
}) {
  const barRef = useRef<HTMLCanvasElement>(null);
  const roundRef = useRef<HTMLCanvasElement>(null);
  const total = data.summaryTotalData;
  const tone = total.T !== WEEKLY_STANDARD_HOURS ? 'warn' : 'good';
  const mm = calcTotalMM(data.summaryData, excluded);

  // 차트 생성/파기 — 사원 변경 시 다시 그린다
  useEffect(() => {
    const charts: Chart[] = [];
    if (barRef.current && data.barChartData.datasets.length) {
      charts.push(
        new Chart(barRef.current, {
          type: 'bar',
          data: data.barChartData,
          options: barOptions,
        }),
      );
    }
    if (roundRef.current && data.roundChartData.datasets[0].data.length) {
      charts.push(
        new Chart(roundRef.current, {
          type: 'doughnut',
          data: data.roundChartData,
          options: roundOptions,
          plugins: [centerTextPlugin(total.T + total.OT)],
        }) as Chart,
      );
    }
    return () => charts.forEach((c) => c.destroy());
  }, [name, data, total.T, total.OT]);

  return (
    <div className="weekly-detail">
      <div className="weekly-detail__head">
        <h3>{name}</h3>
        <span className={`weekly-hours weekly-hours--${tone}`}>
          <span className="weekly-hours__big">{total.T}</span>
          <span className="weekly-hours__den">/{WEEKLY_STANDARD_HOURS}</span>
        </span>
      </div>
      <div className="weekly-detail__mm">
        전체 MM — T <b>{mm.T}</b> · OT <b>{mm.OT}</b>
      </div>

      <ProjectChips
        summaryData={data.summaryData}
        excluded={excluded}
        onToggle={onToggleExclude}
      />

      {/* 차트 2분할 */}
      <div className="weekly-detail__duo">
        <div className="weekly-panel">
          <div className="weekly-panel__title">요일별 T / OT</div>
          <canvas ref={barRef} />
        </div>
        <div className="weekly-panel">
          <div className="weekly-panel__title">프로젝트 비중</div>
          <canvas ref={roundRef} />
        </div>
      </div>

      {/* 상세 일정 */}
      <div className="weekly-panel weekly-sched">
        <div className="weekly-panel__title">상세 일정</div>
        {Object.entries(data.scheduleData).map(([proj, pd]) => {
          if (!pd.T.length && !pd.OT.length) return null;
          const color = getColor(projectList.indexOf(proj));
          return (
            <div key={proj} className="weekly-srow">
              <span
                className="weekly-ptag"
                style={{ color, background: `${color}1f` }}
              >
                {proj}
              </span>
              {(['T', 'OT'] as const).map((type) => {
                const list = pd[type];
                if (!list.length) return null;
                return (
                  <div key={type} className="weekly-sblock">
                    <div className="weekly-sblock__head">
                      <span className={`weekly-stype weekly-stype--${type.toLowerCase()}`}>
                        {type}
                      </span>
                      <button
                        type="button"
                        className="weekly-copy"
                        onClick={(e) => {
                          e.stopPropagation();
                          onCopy(`[${proj}]\n${list.join('\n')}`);
                        }}
                      >
                        Copy
                      </button>
                    </div>
                    <ul className="weekly-slist">
                      {list.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
