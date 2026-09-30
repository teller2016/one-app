import { useEffect, useRef } from 'react';
import { Chart, registerables } from 'chart.js';
import type { ChartOptions, Plugin } from 'chart.js';

Chart.register(...registerables);
import { Badge } from '../../../components/Badge';
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

// 차트 옵션 — 색·폰트는 호출 시점의 chartTheme(CSS 토큰)에서 주입한다.
// 목업 Weekly.dc.html: 요일마다 T·OT 두 막대(폭 14, 사이 3)를 프로젝트 색으로 쌓는다(OT 는 50%).
// 격자선 없이 왼쪽 축·바닥선만, 눈금은 모노 10 · 흐린 잉크. 범례는 차트 밖 HTML(T / OT 견본 두 개).
const BAR_THICKNESS = 14;

const barOptions = (theme: ChartTheme): ChartOptions<'bar'> => ({
  responsive: true,
  maintainAspectRatio: false,
  datasets: {
    bar: {
      barThickness: BAR_THICKNESS,
      // T·OT 두 스택이 한 요일 안에서 붙어 서도록 — 요일 칸은 넓게, 스택 사이만 조금
      categoryPercentage: 0.5,
      barPercentage: 1,
    },
  },
  scales: {
    x: {
      stacked: true,
      ticks: {
        color: theme.tickColor,
        font: { size: theme.captionSize, family: theme.fontFamily },
      },
      grid: { display: false },
      border: { color: theme.axisColor },
    },
    y: {
      stacked: true,
      beginAtZero: true,
      suggestedMax: 10,
      ticks: {
        stepSize: 5,
        color: theme.tickColor,
        font: { size: 10, family: theme.monoFamily },
      },
      grid: { display: false },
      border: { color: theme.axisColor },
    },
  },
  plugins: {
    legend: { display: false },
  },
});

const roundOptions = (): ChartOptions<'doughnut'> => ({
  responsive: true,
  maintainAspectRatio: false,
  // 목업: 지름 150 · 안쪽 104 → 가운데 구멍 69%
  cutout: '69%',
  plugins: {
    legend: { display: false },
  },
});

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
    ctx.fillText(String(val), el.x, el.y - 7);
    ctx.fillStyle = theme.centerSubColor;
    ctx.font = theme.centerSubFont;
    ctx.fillText('시간', el.x, el.y + 13);
    ctx.restore();
  },
});

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

  const themeMode = useThemeMode();

  const theme = readChartTheme();

  useEffect(() => {
    const chartTheme = readChartTheme();
    const charts: Chart[] = [];
    if (barRef.current && data.barChartData.datasets.length) {
      charts.push(
        new Chart(barRef.current, {
          type: 'bar',
          data: {
            labels: data.barChartData.labels,
            datasets: data.barChartData.datasets.map((ds) => {
              const base = chartTheme.getColor(ds.colorIndex, 0);
              return {
                label: ds.label,
                data: ds.data,
                stack: ds.stack,
                // 목업: OT 는 같은 프로젝트 색의 50%
                backgroundColor: ds.stack === 'OT' ? chartTheme.withAlpha(base, 0.5) : base,
                // 쌓인 조각 사이 1px 경계(색각 보정) — 목업의 조각 윗선
                borderColor: chartTheme.segmentBorder.borderColor,
                borderWidth: { top: 1, right: 0, bottom: 0, left: 0 },
                borderSkipped: false,
              };
            }),
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
                // 목업은 이음매 없는 링 — 조각 경계선을 그리지 않는다
                borderWidth: 0,
              },
            ],
          },
          options: roundOptions(),
          plugins: [centerTextPlugin(total.T + total.OT, chartTheme)],
        }) as Chart,
      );
    }
    return () => charts.forEach((c) => c.destroy());
  }, [name, data, total.T, total.OT, themeMode]);

  const legend = data.roundChartData.labels.map((label, i) => ({
    label,
    color: theme.getColor(data.roundChartData.colorIndexes[i], 0),
  }));

  // 목업 Weekly.dc.html 상세 — 이름 h1 + 시간(모노 22) · 오른쪽 전체 MM → MM 칩 → 차트 2개(1.5 : 1) → 상세 일정
  return (
    <div className="weekly-detail">
      <div className="weekly-detail__head">
        <h2 className="weekly-detail__name">{name}</h2>
        <span className={`weekly-hours weekly-hours--${tone}`}>
          {total.T}
          <span className="weekly-hours__den">/{WEEKLY_STANDARD_HOURS}</span>
        </span>
        <span className="weekly-detail__mm">
          전체 MM — T <b>{mm.T}</b> · OT <b>{mm.OT}</b>
        </span>
      </div>

      <ProjectChips
        summaryData={data.summaryData}
        excluded={excluded}
        onToggle={onToggleExclude}
      />

      {/* 차트 2분할 */}
      <div className="weekly-detail__duo">
        <div className="weekly-panel">
          <div className="weekly-panel__head">
            <span className="weekly-panel__title">요일별 T / OT</span>
            <span className="weekly-panel__keys" aria-hidden="true">
              <span className="weekly-panel__key">
                <i />T
              </span>
              <span className="weekly-panel__key weekly-panel__key--ot">
                <i />
                OT
              </span>
            </span>
          </div>
          <div className="weekly-panel__bar">
            <canvas ref={barRef} />
          </div>
        </div>
        <div className="weekly-panel">
          <span className="weekly-panel__title">프로젝트 비중</span>
          <div className="weekly-panel__round">
            <div className="weekly-panel__donut">
              <canvas ref={roundRef} />
            </div>
            <ul className="weekly-legend">
              {legend.map((l) => (
                <li key={l.label}>
                  <i style={{ background: l.color }} />
                  {l.label}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* 상세 일정 — 프로젝트마다 한 열(3열 그리드): 태그 → T/OT 블록(유형 뱃지 + [Copy] + 일정 줄) */}
      <div className="weekly-sched">
        <div className="weekly-sched__head">
          <span className="weekly-panel__title">상세 일정</span>
        </div>
        <div className="weekly-sched__grid">
          {Object.entries(data.scheduleData).map(([proj, pd]) => {
            if (!pd.T.length && !pd.OT.length) return null;
            const idx = projectList.indexOf(proj);
            const colorText = theme.getColor(idx, 1);
            const colorTint = theme.getColor(idx, 0);
            return (
              <div key={proj} className="weekly-srow">
                <span
                  className="weekly-ptag"
                  style={{ color: colorText, background: theme.withAlpha(colorTint, 0.16) }}
                >
                  {proj}
                </span>
                {(['T', 'OT'] as const).map((type) => {
                  const list = pd[type];
                  if (!list.length) return null;
                  return (
                    <div key={type} className="weekly-sblock">
                      <div className="weekly-sblock__head">
                        <Badge variant={type === 'OT' ? 'busy' : 'accent'} dot={false}>
                          {type}
                        </Badge>
                        <Button
                          size="xs"
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
                          <li key={s} title={s}>
                            {s}
                          </li>
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
    </div>
  );
}
