import { useEffect, useRef, useState } from 'react';
import { Button } from '../../../components/Button';
import { SectionHeader } from '../../../components/SectionHeader';
import { Banner } from '../../../components/Banner';
import { RosterRow } from './RosterRow';
import { EmployeeDetail } from './EmployeeDetail';
import { buildReport, DEFAULT_MM_EXCLUDED, type WeeklyReport } from '../lib/report';
import type { WeeklyPeriod } from '../../../../shared/types';

const LS_KEY = 'weekly:mmExcluded';
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

/** weekOffset 에 해당하는 주(일~토) 표시 문자열 — 예: "6.28(일) ~ 7.4(토)" */
const weekRangeLabel = (offset: number): string => {
  const start = new Date();
  start.setDate(start.getDate() - start.getDay() + offset * 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  const fmt = (d: Date) => `${d.getMonth() + 1}.${d.getDate()}`;
  return `${fmt(start)}(일) ~ ${fmt(end)}(토)`;
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
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // 토스트 타이머 정리
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1500);
  };

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text).then(
      () => showToast('복사되었습니다'),
      () => showToast('복사 실패'),
    );
  };

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
      res = await window.oneApp.weekly.fetch(weekOffset);
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

  // T 40시간 미달/초과(≠40)인 인원 수 — 상단 요약에 표시
  const offCount = report
    ? report.nameList.filter((n) => report.byName[n].summaryTotalData.T !== 40)
        .length
    : 0;

  return (
    <div className="section weekly">
      <SectionHeader
        title="📊 주간보고"
        sub="FE챕터 개인별 주간 일정을 분석해 팀원별 T/OT·MM 을 보여줍니다."
      />

      {credsReady === false && (
        <Banner>
          ⚠️ 비즈박스 계정 정보가 없습니다. <b>환경설정</b> 탭에서 아이디/비밀번호를
          먼저 저장하세요.
        </Banner>
      )}

      {/* 주 선택 + 실행 */}
      <div className="weekly__toolbar">
        <div className="weekly__weeknav">
          <Button
            onClick={() => setWeekOffset((v) => Math.max(v - 1, -MAX_OFFSET))}
            disabled={loading || weekOffset <= -MAX_OFFSET}
            aria-label="이전 주"
          >
            ◀
          </Button>
          <span className="weekly__weeklabel">
            {weekOffset === 0
              ? `이번주 (${weekRangeLabel(0)})`
              : weekOffset === -1
                ? `지난주 (${weekRangeLabel(-1)})`
                : `${weekOffset > 0 ? '+' : ''}${weekOffset}주 (${weekRangeLabel(weekOffset)})`}
          </span>
          <Button
            onClick={() => setWeekOffset((v) => Math.min(v + 1, MAX_OFFSET))}
            disabled={loading || weekOffset >= MAX_OFFSET}
            aria-label="다음 주"
          >
            ▶
          </Button>
          {weekOffset !== 0 && (
            <Button onClick={() => setWeekOffset(0)} disabled={loading}>
              이번주
            </Button>
          )}
        </div>
        <Button variant="primary" onClick={run} disabled={loading}>
          {loading ? '분석 중…' : '주간보고 분석'}
        </Button>
      </div>

      {error && <Banner>⚠️ {error}</Banner>}

      {/* 로딩 */}
      {loading && (
        <div className="weekly__loading">
          <div className="weekly__spinner" />
          <p>{progressStep || '일정 데이터를 불러오는 중…'}</p>
        </div>
      )}

      {/* 결과 */}
      {!loading && report && (
        <>
          <div className="weekly__meta">
            {period && (
              <span className="weekly__period">
                {period.start} ~ {period.end}
              </span>
            )}
            <span className="weekly__period">{report.nameList.length}명</span>
            {offCount > 0 && (
              <span className="weekly__period weekly__period--warn">
                40시간 ≠ {offCount}명
              </span>
            )}
          </div>

          {report.nameList.length === 0 ? (
            <div className="weekly__empty">표시할 사원 데이터가 없습니다.</div>
          ) : (
            <div className="weekly__panes">
              {/* 왼쪽: 팀 목록 (항상 보임, 스크롤 시 고정) */}
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

              {/* 오른쪽: 선택한 사원 상세 */}
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
        <div className="weekly__empty">
          [주간보고 분석]을 누르면 그룹웨어에서 해당 주의 일정을 수집해
          팀원별로 정리합니다. (백그라운드 브라우저 — 수십 초 걸릴 수 있어요)
        </div>
      )}

      {toast && <div className="weekly-toast">{toast}</div>}
    </div>
  );
}
