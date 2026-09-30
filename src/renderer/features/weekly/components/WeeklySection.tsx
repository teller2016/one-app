import { useEffect, useState } from 'react';
import { Button } from '../../../components/Button';
import { Checkbox } from '../../../components/Checkbox';
import { TopbarSlot } from '../../../components/TopbarSlot';
import { Banner } from '../../../components/Banner';
import { Badge } from '../../../components/Badge';
import { Icon } from '../../../components/Icon';
import { EmptyState } from '../../../components/EmptyState';
import { useCopy } from '../../../lib/useCopy';
import { RosterRow } from './RosterRow';
import { EmployeeDetail } from './EmployeeDetail';
import {
  buildReport,
  DEFAULT_MM_EXCLUDED,
  WEEKLY_STANDARD_HOURS,
  type WeeklyReport,
} from '../lib/report';
import type { WeeklyPeriod } from '../../../../shared/types';

const LS_KEY = 'weekly:mmExcluded';
const LS_MON_WEEK = 'weekly:monWeek';
const MAX_OFFSET = 12; // 수집기의 최대 이동 거리와 동일

const loadExcluded = (): Set<string> => {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw
      ? new Set(JSON.parse(raw) as string[])
      : new Set(DEFAULT_MM_EXCLUDED);
  } catch {
    return new Set(DEFAULT_MM_EXCLUDED);
  }
};

/** weekOffset 에 해당하는 주 표시 문자열 — 예: "6.28(일) ~ 7.4(토)" / "6.29(월) ~ 7.5(일)" */
const weekRangeLabel = (offset: number, monWeek: boolean): string => {
  const start = new Date();
  const back = monWeek ? (start.getDay() + 6) % 7 : start.getDay();
  start.setDate(start.getDate() - back + offset * 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const fmt = (d: Date) => `${d.getMonth() + 1}.${d.getDate()}`;
  return monWeek
    ? `${fmt(start)}(월) ~ ${fmt(end)}(일)`
    : `${fmt(start)}(일) ~ ${fmt(end)}(토)`;
};

/**
 * 주간보고 섹션 — FE챕터 개인별 주간 일정을 수집해 사원별 T/OT·MM 을 분석한다.
 * (fe-schedule-extension 대시보드 이식)
 */
export function WeeklySection() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [progressStep, setProgressStep] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [period, setPeriod] = useState<WeeklyPeriod | null>(null);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(loadExcluded);
  const [credsReady, setCredsReady] = useState<boolean | null>(null);
  const [monWeek, setMonWeek] = useState(
    () => localStorage.getItem(LS_MON_WEEK) === '1',
  );

  const toggleMonWeek = (on: boolean) => {
    setMonWeek(on);
    try {
      localStorage.setItem(LS_MON_WEEK, on ? '1' : '0');
    } catch {
      // 저장 실패해도 동작에는 지장 없음
    }
  };

  // 수집 진행 단계 구독
  useEffect(() => {
    if (!window.oneApp?.weekly) return;
    const off = window.oneApp.weekly.onProgress(({ step }) =>
      setProgressStep(step),
    );
    return off;
  }, []);

  // 계정 정보 설정 여부 확인
  useEffect(() => {
    window.oneApp?.settings
      .get()
      .then((s) => setCredsReady(!!s.bizboxId && s.hasPassword));
  }, []);

  const copyText = useCopy();

  const toggleExclude = (project: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(project)) next.delete(project);
      else next.add(project);
      try {
        localStorage.setItem(LS_KEY, JSON.stringify([...next]));
      } catch {
        // 저장 실패해도 동작에는 지장 없음
      }
      return next;
    });
  };

  const run = async () => {
    if (!window.oneApp?.weekly) {
      setError('앱 연결(preload)이 되지 않았습니다.');
      return;
    }
    setLoading(true);
    setError(null);
    setProgressStep('수집 시작 중…');
    let res: Awaited<ReturnType<typeof window.oneApp.weekly.fetch>>;
    try {
      res = await window.oneApp.weekly.fetch(weekOffset, monWeek);
    } catch (err) {
      // IPC 자체가 실패해도(핸들러 미등록 등) 로딩이 멈추지 않게 처리
      setLoading(false);
      setError((err as Error)?.message ?? '수집 요청에 실패했습니다.');
      return;
    }
    setLoading(false);
    if (!res.ok) {
      setError(res.error ?? '수집에 실패했습니다.');
      return;
    }
    const next = buildReport(res.rows ?? []);
    setReport(next);
    setPeriod(res.period ?? null);
    setSelectedName(next.nameList[0] ?? null);
  };

  const selected =
    report && selectedName ? report.byName[selectedName] : undefined;

  // T 정규시간(38h) 미달/초과(≠38)인 인원 수 — 상단 요약에 표시
  const offCount = report
    ? report.nameList.filter(
        (n) => report.byName[n].summaryTotalData.T !== WEEKLY_STANDARD_HOURS,
      ).length
    : 0;

  // 주 표시 — "지난주" 같은 이름 + 괄호 안 날짜 범위(모노)
  const weekName =
    weekOffset === 0
      ? '이번주'
      : weekOffset === -1
        ? '지난주'
        : `${weekOffset > 0 ? '+' : ''}${weekOffset}주`;

  // 목업 Weekly.dc.html — 탑바(주 이동 · 월~일 기준 · [주간보고 분석]) → 요약 띠(기간·인원·미달/초과)
  // → 풀블리드 2단(좌 명단 280 · 우 상세). 섹션 제목은 없다(탑바 경로가 대신한다).
  return (
    <div className="section weekly">
      <TopbarSlot
        left={
          <div className="weekly__weeknav">
            <Button
              size="xs"
              onClick={() => setWeekOffset((v) => Math.max(v - 1, -MAX_OFFSET))}
              disabled={loading || weekOffset <= -MAX_OFFSET}
              aria-label="이전 주"
              icon
            >
              <Icon name="chevron-left" size={14} />
            </Button>
            <span className="weekly__weeklabel">
              {weekName}{' '}
              <span className="weekly__weekrange">({weekRangeLabel(weekOffset, monWeek)})</span>
            </span>
            <Button
              size="xs"
              onClick={() => setWeekOffset((v) => Math.min(v + 1, MAX_OFFSET))}
              disabled={loading || weekOffset >= MAX_OFFSET}
              aria-label="다음 주"
              icon
            >
              <Icon name="chevron-right" size={14} />
            </Button>
            {weekOffset !== 0 && (
              <Button size="xs" onClick={() => setWeekOffset(0)} disabled={loading}>
                이번주
              </Button>
            )}
          </div>
        }
        right={
          <div className="weekly__actions">
            <Checkbox
              className="weekly__monweek"
              title="월요일~일요일 기준으로 계산합니다. 페이지가 일~토 단위라 두 주를 수집하므로 시간이 조금 더 걸려요."
              checked={monWeek}
              onChange={(e) => toggleMonWeek(e.target.checked)}
              disabled={loading}
              label="월~일 기준"
            />
            <Button variant="primary" onClick={run} loading={loading}>
              주간보고 분석
            </Button>
          </div>
        }
      />

      {credsReady === false && (
        <div className="weekly__notice">
          <Banner>
            비즈박스 계정 정보가 없습니다. <b>환경설정</b> 탭에서 아이디/비밀번호를
            먼저 저장하세요.
          </Banner>
        </div>
      )}

      {error && (
        <div className="weekly__notice">
          <Banner variant="danger">{error}</Banner>
        </div>
      )}

      {/* 로딩 */}
      {loading && (
        <div className="weekly__state">
          <div className="spinner spinner--lg" />
          <p>{progressStep || '일정 데이터를 불러오는 중…'}</p>
        </div>
      )}

      {/* 결과 */}
      {!loading && report && (
        <>
          {/* 요약 띠 — 기간(모노) · 인원 · 기준시간 미달/초과 (목업 높이 44 · 바닥선) */}
          <div className="weekly__meta">
            {period && (
              <Badge variant="pill">
                <span className="weekly__mono">
                  {period.start} ~ {period.end}
                </span>
              </Badge>
            )}
            <Badge variant="pill">{report.nameList.length}명</Badge>
            {offCount > 0 && (
              <Badge variant="fail">
                기준 {WEEKLY_STANDARD_HOURS}시간 미달·초과 {offCount}명
              </Badge>
            )}
          </div>

          {report.nameList.length === 0 ? (
            <div className="weekly__state">
              <EmptyState icon="bar-chart" message="표시할 사원 데이터가 없습니다." />
            </div>
          ) : (
            <div className="weekly__panes">
              {/* 왼쪽: 팀 목록 280 (자기 스크롤) */}
              <aside className="weekly__roster">
                {report.nameList.map((name) => (
                  <RosterRow
                    key={name}
                    name={name}
                    data={report.byName[name]}
                    excluded={excluded}
                    selected={name === selectedName}
                    onSelect={setSelectedName}
                  />
                ))}
              </aside>

              {/* 오른쪽: 선택한 사원 상세 (자기 스크롤) */}
              <div className="weekly__detail-pane">
                {selected && selectedName && (
                  <EmployeeDetail
                    name={selectedName}
                    data={selected}
                    projectList={report.projectList}
                    excluded={excluded}
                    onToggleExclude={toggleExclude}
                    onCopy={copyText}
                  />
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* 최초 안내 */}
      {!loading && !report && !error && (
        <div className="weekly__state">
          <EmptyState
            icon="info"
            message="[주간보고 분석]을 누르면 그룹웨어에서 해당 주의 일정을 수집해
            팀원별로 정리합니다. (백그라운드 브라우저 — 수십 초 걸릴 수 있어요)"
          />
        </div>
      )}
    </div>
  );
}
