import { useEffect, useRef } from 'react';
import { Chart, registerables } from 'chart.js';
import type { ChartOptions, Plugin } from 'chart.js';

Chart.register(...registerables);
import { Button } from '../../../components/Button';
import { Icon } from '../../../components/Icon';
import { useThemeMode } from '../../../lib/theme';
import { ProjectChips } from './ProjectChips';
import {
  calcTotalMM,
  WEEKLY_STANDARD_HOURS,
  type EmployeeReport,
} from '../lib/report';
import { readChartTheme, type ChartTheme } from '../lib/chartTheme';

// 차트 옵션 — 색·폰트는 호출 시점의 chartTheme(CSS 토큰)에서 주입한다
const barOptions = (theme: ChartTheme): ChartOptions<'bar'> => ({
  responsive: true,
  maintainAspectRatio: false,
  scales: {
    x: {
      ticks: {
        color: theme.tickColor,
        font: { size: theme.captionSize, family: theme.fontFamily },
      },
      grid: { display: false },
    },
    y: {
      stacked: true,
      beginAtZero: true,
      ticks: {
        color: theme.tickColor,
        font: { size: theme.captionSize, family: theme.fontFamily },
      },
      grid: { color: theme.gridColor },
    },
  },
  plugins: {
    legend: {
      labels: {
        color: theme.legendColor,
        boxWidth: 10,
        font: { size: theme.captionSize, family: theme.fontFamily },
      },
    },
  },
});

const roundOptions = (theme: ChartTheme): ChartOptions<'doughnut'> => ({
  responsive: true,
  maintainAspectRatio: false,
  cutout: '68%',
  plugins: {
    legend: {
      position: 'right',
      labels: {
        color: theme.legendColor,
        boxWidth: 10,
        font: { size: theme.captionSize, family: theme.fontFamily },
      },
    },
  },
});

/** 도넛 중앙에 총 시간 표시 */
const centerTextPlugin = (val: number, theme: ChartTheme): Plugin<'doughnut'> => ({
  id: 'weeklyCenterText',
  afterDraw(chart) {
    const meta = chart.getDatasetMeta(0);
    if (!meta?.data?.length) return;
    const el = meta.data[0];
    const { ctx } = chart;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = theme.centerTextColor;
    ctx.font = theme.centerTextFont;
    ctx.fillText(String(val), el.x, el.y - 6);
    ctx.fillStyle = theme.centerSubColor;
    ctx.font = theme.centerSubFont;
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

  // 테마 전환 시 리렌더 + 아래 effect 재실행 → 차트가 새 토큰 색으로 다시 그려진다
  const themeMode = useThemeMode();

  // ptag 인라인 색용 — 렌더 시점에 토큰을 읽는다 (비용 무시 가능)
  const theme = readChartTheme();

  // 차트 생성/파기 — 사원 변경 시 다시 그린다
  useEffect(() => {
    // 토큰은 차트 생성 시점에 읽는다 (모듈 톱레벨 평가 금지 — chartTheme.ts 참고)
    const chartTheme = readChartTheme();
    const charts: Chart[] = [];
    if (barRef.current && data.barChartData.datasets.length) {
      charts.push(
        new Chart(barRef.current, {
          type: 'bar',
          data: {
            labels: data.barChartData.labels,
            datasets: data.barChartData.datasets.map((ds) => ({
              label: ds.label,
              data: ds.data,
              stack: ds.stack,
              backgroundColor: chartTheme.getColor(
                ds.colorIndex,
                ds.stack === 'OT' ? 1 : 0,
              ),
              // 스택 세그먼트 사이 1px 경계 — 색각 보정 (DESIGN.md)
              ...chartTheme.segmentBorder,
            })),
          },
          options: barOptions(chartTheme),
        }),
      );
    }
    if (roundRef.current && data.roundChartData.datasets[0].data.length) {
      charts.push(
        new Chart(roundRef.current, {
          type: 'doughnut',
          data: {
            labels: data.roundChartData.labels,
            datasets: [
              {
                data: data.roundChartData.datasets[0].data,
                backgroundColor: data.roundChartData.colorIndexes.map((ci) =>
                  chartTheme.getColor(ci, 0),
                ),
                // 도넛 세그먼트 사이 1px 경계 — 색각 보정 (DESIGN.md)
                ...chartTheme.segmentBorder,
              },
            ],
          },
          options: roundOptions(chartTheme),
          plugins: [centerTextPlugin(total.T + total.OT, chartTheme)],
        }) as Chart,
      );
    }
    return () => charts.forEach((c) => c.destroy());
  }, [name, data, total.T, total.OT, themeMode]);

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
          // 글자는 진한 O쌍(라이트 배경 대비 4.5:1+), 배경 틴트는 T쌍 — DESIGN.md 1장 ptag 규칙
          const idx = projectList.indexOf(proj);
          const colorText = theme.getColor(idx, 1);
          const colorTint = theme.getColor(idx, 0);
          return (
            <div key={proj} className="weekly-srow">
              <span
                className="weekly-ptag"
                style={{ color: colorText, background: `${colorTint}26` }}
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
                      <Button
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          onCopy(`[${proj}]\n${list.join('\n')}`);
                        }}
                      >
                        <Icon name="copy" size={12} />
                        Copy
                      </Button>
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
