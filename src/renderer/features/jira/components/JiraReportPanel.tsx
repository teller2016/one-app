import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  JiraProjectOption,
  JiraReportDateField,
  JiraReportIssue,
  JiraReportPeriod,
  JiraReportQuery,
} from '../../../../shared/types';
import { buildReportJql, REPORT_DATE_FIELDS } from '../../../../shared/jira-report';
import {
  dayKey,
  monthEndDayKey,
  shiftMonthKey,
  thisMonthKey,
} from '../../../../shared/date';
import { Badge } from '../../../components/Badge';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { Checkbox } from '../../../components/Checkbox';
import { DatePicker } from '../../../components/DatePicker';
import { EmptyState } from '../../../components/EmptyState';
import { Icon } from '../../../components/Icon';
import { Input } from '../../../components/Input';
import { MultiSelect } from '../../../components/MultiSelect';
import { RefreshButton } from '../../../components/RefreshButton';
import { Segment } from '../../../components/Segment';
import { Select } from '../../../components/Select';
import { Textarea } from '../../../components/Textarea';
import { Tooltip } from '../../../components/Tooltip';
import { errMsg } from '../../../lib/errMsg';
import { useCopy } from '../../../lib/useCopy';

import { statusBadgeVariant } from '../lib/issue';
import {
  DEFAULT_TEMPLATE,
  renderReport,
  renderTemplateLine,
  TEMPLATE_PRESETS,
  TEMPLATE_VARS,
} from '../lib/reportTemplate';

type PeriodMode = JiraReportPeriod['mode'];

/** 결과 정렬 — 서버 정렬(생성순)과 무관하게 화면에서 다시 정렬한다 */
type SortKey = 'created' | 'updated' | 'key' | 'status' | 'assignee';

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'created', label: '생성순' },
  { value: 'updated', label: '최근 갱신' },
  { value: 'key', label: '번호순' },
  { value: 'status', label: '상태별' },
  { value: 'assignee', label: '담당자별' },
];

/** facet 에서 빈 값(미배정·레이블 없음)을 고를 수 있게 하는 표기 */
const NONE = '(없음)';

/** "SSB-123" → 123 (번호순 정렬용) */
const keyNumber = (key: string): number => Number(key.split('-').pop() ?? 0);
const compareKey = (a: JiraReportIssue, b: JiraReportIssue) =>
  a.projectKey.localeCompare(b.projectKey) || keyNumber(a.key) - keyNumber(b.key);

const SORT_CMP: Record<SortKey, (a: JiraReportIssue, b: JiraReportIssue) => number> = {
  created: (a, b) => a.createdAt.localeCompare(b.createdAt) || compareKey(a, b),
  updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt) || compareKey(a, b),
  key: compareKey,
  status: (a, b) => a.status.localeCompare(b.status) || compareKey(a, b),
  // 미배정은 맨 뒤로
  assignee: (a, b) =>
    (a.assignee ?? '￿').localeCompare(b.assignee ?? '￿') || compareKey(a, b),
};

/** "2026-08" → "2026년 8월" */
const monthLabel = (month: string): string => {
  const [y, m] = month.split('-');
  return `${y}년 ${Number(m)}월`;
};

/** ISO → "YYYY-MM-DD" (표의 날짜 열) */
const isoToDay = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : dayKey(d);
};

/** 기준 필드에 해당하는 티켓의 날짜 */
const dateOf = (it: JiraReportIssue, field: JiraReportDateField): string =>
  field === 'created' ? it.createdAt : field === 'resolved' ? it.resolvedAt ?? '' : it.updatedAt;

/** 이름순 비교 — 숫자를 자릿수가 아니라 값으로 본다("26/9/3" < "26/10/15"), 빈 값 표기는 맨 뒤 */
const compareName = (a: string, b: string): number =>
  a === NONE ? 1 : b === NONE ? -1 : a.localeCompare(b, 'ko', { numeric: true });

/**
 * 결과 안에서 값별 개수를 세어 MultiSelect 옵션으로.
 * 정렬은 기본 '많이 나온 값부터'. 레이블은 **이름순** — 레이블이 배포일(26/09/03 같은 날짜)이라
 * 시간순으로 읽혀야 하기 때문(2026-09-03 사용자 요청). Jira 는 레이블 생성 시각을 주지 않으므로
 * 이름순이 곧 시간순이 되게 날짜형 이름을 전제한다.
 */
function facetOptions(
  issues: JiraReportIssue[],
  pick: (it: JiraReportIssue) => string[],
  order: 'count' | 'name' = 'count',
): { value: string; label: string }[] {
  const counts = new Map<string, number>();
  for (const it of issues) {
    for (const v of pick(it)) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) =>
      order === 'name' ? compareName(a[0], b[0]) : b[1] - a[1] || compareName(a[0], b[0]),
    )
    .map(([value, n]) => ({ value, label: `${value} (${n})` }));
}

/** 선택된 값이 없으면(전체) 통과, 있으면 하나라도 겹쳐야 통과 */
const passes = (selected: string[] | undefined, values: string[]): boolean =>
  !selected || values.some((v) => selected.includes(v));

/**
 * 티켓 보고 — 프로젝트·기간으로 티켓을 모아 필터하고, 템플릿대로 한 번에 복사한다.
 *
 * 서버(JQL)는 프로젝트·기간만 자르고 상태·담당자·레이블·유형은 받은 결과 안에서 거른다(facet).
 * 선택지가 실제 결과에 있는 값만 보이고, 후보를 따로 조회하는 API 에 기대지 않는다.
 * `onOpenDetail` 을 주면 제목 클릭이 앱 안 상세 패널을 열고, 없으면(단독 배포판) 브라우저로 연다.
 */
export function JiraReportPanel({
  onOpenDetail,
}: {
  onOpenDetail?: (key: string) => void;
}) {
  const copy = useCopy();

  // ── 조회 조건 (마지막 선택은 userData 에 저장 — 달마다 같은 조건) ──
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [projectKeys, setProjectKeys] = useState<string[]>([]);
  const [dateField, setDateField] = useState<JiraReportDateField>('updated');
  const [periodMode, setPeriodMode] = useState<PeriodMode>('month');
  const [month, setMonth] = useState(thisMonthKey);
  const [rangeStart, setRangeStart] = useState(() => `${thisMonthKey()}-01`);
  const [rangeEnd, setRangeEnd] = useState(() => monthEndDayKey(thisMonthKey()));
  const [advanced, setAdvanced] = useState(false);
  const [customJql, setCustomJql] = useState('');
  const [template, setTemplate] = useState(DEFAULT_TEMPLATE);
  // 자리표시자 목록 펼침 — (i) 버튼. 목록에서 누르면 템플릿 커서 자리에 삽입된다
  const [helpOpen, setHelpOpen] = useState(false);
  // 템플릿 입력칸과 마지막 커서 위치 (공용 Input 은 ref 를 받지 않아 이벤트에서 집는다)
  const templateEl = useRef<HTMLInputElement | null>(null);
  const caret = useRef<number | null>(null);

  // ── 프로젝트 선택지 ──
  const [projects, setProjects] = useState<JiraProjectOption[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState('');

  // ── 결과 ──
  const [issues, setIssues] = useState<JiraReportIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [configured, setConfigured] = useState(true);
  const [truncated, setTruncated] = useState(false);
  const [queried, setQueried] = useState(false);

  // ── 화면 필터(facet)·정렬·선택 ──
  const [fStatus, setFStatus] = useState<string[] | undefined>(undefined);
  const [fAssignee, setFAssignee] = useState<string[] | undefined>(undefined);
  const [fLabel, setFLabel] = useState<string[] | undefined>(undefined);
  const [fType, setFType] = useState<string[] | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('created');
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  // 저장된 선택 불러오기 (한 번)
  useEffect(() => {
    let alive = true;
    window.oneApp.jira.report
      .getPrefs()
      .then((p) => {
        if (!alive) return;
        setProjectKeys(p.projectKeys);
        setDateField(p.dateField);
        setPeriodMode(p.periodMode);
        setTemplate(p.template || DEFAULT_TEMPLATE);
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setPrefsLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const loadProjects = useCallback(async (force = false) => {
    setProjectsLoading(true);
    try {
      const res = await window.oneApp.jira.report.projects(force);
      setConfigured(res.configured);
      if (!res.ok) {
        setProjectsError(res.error ?? '프로젝트 목록을 불러오지 못했습니다.');
        return;
      }
      setProjects(res.projects ?? []);
      setProjectsError('');
    } catch (e) {
      setProjectsError(errMsg(e, '프로젝트 목록을 불러오지 못했습니다.'));
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  // ── 조건 → JQL 미리보기 (main 과 같은 함수) ──
  const period = useMemo<JiraReportPeriod>(
    () =>
      periodMode === 'month'
        ? { mode: 'month', month }
        : periodMode === 'range'
          ? { mode: 'range', start: rangeStart, end: rangeEnd }
          : { mode: 'all' },
    [periodMode, month, rangeStart, rangeEnd],
  );
  const query = useMemo<JiraReportQuery>(
    () => ({
      projectKeys,
      period,
      dateField,
      jql: advanced ? customJql : undefined,
    }),
    [projectKeys, period, dateField, advanced, customJql],
  );
  const preview = useMemo(() => {
    try {
      return { jql: buildReportJql(query), error: '' };
    } catch (e) {
      return { jql: '', error: errMsg(e) };
    }
  }, [query]);

  // ── 조회 ──
  const run = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await window.oneApp.jira.report.search(query);
      setConfigured(res.configured);
      if (!res.ok) {
        setError(res.error ?? '조회에 실패했습니다.');
        setIssues([]);
        setTruncated(false);
        return;
      }
      setIssues(res.issues ?? []);
      setTruncated(res.truncated === true);
      setQueried(true);
      setSelected(new Set()); // 새 결과 — 이전 선택은 의미가 없다
      // 조건을 기억해 다음 달에도 같은 조건으로 바로 조회되게
      void window.oneApp.jira.report.savePrefs({ projectKeys, dateField, periodMode });
    } catch (e) {
      setError(errMsg(e, '조회에 실패했습니다.'));
    } finally {
      setLoading(false);
    }
  }, [query, projectKeys, dateField, periodMode]);

  // 저장된 프로젝트가 있으면 열자마자 한 번 조회 — 달마다 같은 조건으로 여는 사용 방식
  const autoRan = useRef(false);
  useEffect(() => {
    if (!prefsLoaded || autoRan.current) return;
    autoRan.current = true;
    if (projectKeys.length > 0) void run();
  }, [prefsLoaded, projectKeys.length, run]);

  // ── facet 선택지 · 보이는 목록 ──
  const facets = useMemo(
    () => ({
      status: facetOptions(issues, (it) => [it.status]),
      assignee: facetOptions(issues, (it) => [it.assignee ?? NONE]),
      label: facetOptions(issues, (it) => (it.labels.length ? it.labels : [NONE]), 'name'),
      type: facetOptions(issues, (it) => [it.issueType]),
    }),
    [issues],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = issues.filter(
      (it) =>
        passes(fStatus, [it.status]) &&
        passes(fAssignee, [it.assignee ?? NONE]) &&
        passes(fLabel, it.labels.length ? it.labels : [NONE]) &&
        passes(fType, [it.issueType]) &&
        (!q || it.key.toLowerCase().includes(q) || it.summary.toLowerCase().includes(q)),
    );
    return list.sort(SORT_CMP[sort]);
  }, [issues, fStatus, fAssignee, fLabel, fType, search, sort]);

  const filtered = visible.length !== issues.length;

  // ── 선택·복사 ──
  const selectedVisible = useMemo(
    () => visible.filter((it) => selected.has(it.key)),
    [visible, selected],
  );
  const allVisibleSelected = visible.length > 0 && selectedVisible.length === visible.length;
  const copyTargets = selectedVisible.length > 0 ? selectedVisible : visible;

  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const it of visible) {
        if (allVisibleSelected) next.delete(it.key);
        else next.add(it.key);
      }
      return next;
    });
  const toggleOne = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const doCopy = () => {
    if (copyTargets.length === 0) return;
    void copy(renderReport(template, copyTargets), {
      success: `${copyTargets.length}건을 복사했습니다`,
    });
  };

  const saveTemplate = (next: string) => {
    const value = next.trim() || DEFAULT_TEMPLATE;
    setTemplate(value);
    void window.oneApp.jira.report.savePrefs({ template: value });
  };

  /**
   * 자리표시자를 템플릿의 커서 자리에 넣는다 (커서를 모르면 끝에 붙인다).
   *
   * ⚠️ 커서는 **입력 요소에서 직접** 읽는다 — `onSelect` 추적만 믿으면 안 된다.
   * React 의 select 이벤트는 실제 마우스·키 조작에서만 합성돼, 코드로 옮긴 커서는
   * 핸들러가 못 본다(2026-09-03 실측: 중간에 커서를 둬도 끝에 붙었다).
   */
  const insertVar = (name: string) => {
    const token = `{${name}}`;
    const live = templateEl.current?.selectionStart;
    const pos = Math.min(live ?? caret.current ?? template.length, template.length);
    const next = template.slice(0, pos) + token + template.slice(pos);
    saveTemplate(next);
    // 커서를 삽입한 토큰 뒤로 옮기고 입력칸으로 포커스를 되돌린다
    // (state 반영 후여야 setSelectionRange 가 새 값 기준으로 먹는다)
    const after = pos + token.length;
    caret.current = after;
    const el = templateEl.current;
    if (el) {
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(after, after);
      });
    }
  };

  const presetValue = TEMPLATE_PRESETS.find((p) => p.template === template)?.template ?? '';

  const openIssue = (it: JiraReportIssue) => {
    if (onOpenDetail) onOpenDetail(it.key);
    else void window.oneApp.openExternal(it.url);
  };

  const canGoNextMonth = month < thisMonthKey();
  const dateFieldLabel =
    REPORT_DATE_FIELDS.find((f) => f.value === dateField)?.label ?? '날짜';

  if (!configured) {
    return (
      <Banner variant="info">
        환경설정 → 연동에서 Jira 주소·이메일·API 토큰을 입력하면 티켓을 조회할 수 있습니다.
      </Banner>
    );
  }

  return (
    <div className="jira-report">
      {/* ── 조회 조건 ── */}
      <div className="jira-report__query">
        <div className="jira-report__row">
          <div className="jira-report__field jira-report__field--grow">
            <span className="jira-report__label">프로젝트</span>
            <MultiSelect
              options={projects.map((p) => ({
                value: p.key,
                label: `${p.key} · ${p.name}`,
              }))}
              values={projectKeys}
              onChange={(v) => setProjectKeys(v ?? [])}
              emptyLabel={
                projectsLoading ? '불러오는 중...' : projects.length ? '프로젝트 선택' : '프로젝트 없음'
              }
              countLabel={(n) => `${n}개 프로젝트`}
              disabled={advanced || projectsLoading}
              aria-label="프로젝트"
            />
            <Tooltip label="프로젝트 목록 새로고침">
              <RefreshButton
                size={13}
                spinning={projectsLoading}
                onClick={() => void loadProjects(true)}
              />
            </Tooltip>
          </div>

          <div className="jira-report__field">
            <span className="jira-report__label">기간</span>
            <Segment<PeriodMode>
              options={[
                { value: 'month', label: '월' },
                { value: 'range', label: '직접' },
                { value: 'all', label: '전체' },
              ]}
              value={periodMode}
              onChange={setPeriodMode}
              disabled={advanced}
            />
          </div>

          {periodMode === 'month' && (
            <div className="jira-report__month">
              <button
                type="button"
                className="icon-btn"
                aria-label="이전 달"
                disabled={advanced}
                onClick={() => setMonth((m) => shiftMonthKey(m, -1))}
              >
                <Icon name="chevron-left" size={14} />
              </button>
              <span className="jira-report__month-label">{monthLabel(month)}</span>
              <button
                type="button"
                className="icon-btn"
                aria-label="다음 달"
                disabled={advanced || !canGoNextMonth}
                onClick={() => setMonth((m) => shiftMonthKey(m, 1))}
              >
                <Icon name="chevron-right" size={14} />
              </button>
            </div>
          )}

          {periodMode === 'range' && (
            <div className="jira-report__range">
              <DatePicker value={rangeStart} onChange={setRangeStart} disabled={advanced} />
              <span className="jira-report__tilde">~</span>
              <DatePicker value={rangeEnd} onChange={setRangeEnd} disabled={advanced} />
            </div>
          )}

          {periodMode !== 'all' && (
            <div className="jira-report__field">
              <span className="jira-report__label">기준</span>
              <Select
                options={REPORT_DATE_FIELDS}
                value={dateField}
                onChange={(v) => setDateField(v as JiraReportDateField)}
                small
                disabled={advanced}
                aria-label="기간 기준 필드"
              />
            </div>
          )}

          <div className="jira-report__run">
            <Button
              variant="primary"
              loading={loading}
              disabled={!preview.jql}
              onClick={() => void run()}
            >
              <Icon name="search" size={14} />
              조회
            </Button>
          </div>
        </div>

        <div className="jira-report__row jira-report__row--sub">
          <Checkbox
            label="JQL 직접 입력"
            checked={advanced}
            onChange={(e) => {
              setAdvanced(e.target.checked);
              // 처음 켤 때는 지금 조건으로 만든 JQL 을 출발점으로 준다
              if (e.target.checked && !customJql.trim()) setCustomJql(preview.jql);
            }}
          />
          {!advanced && preview.jql && (
            <span className="jira-report__jql" title={preview.jql}>
              <code>{preview.jql}</code>
              <Tooltip label="JQL 복사">
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="JQL 복사"
                  onClick={() => void copy(preview.jql, { success: 'JQL 을 복사했습니다' })}
                >
                  <Icon name="copy" size={12} />
                </button>
              </Tooltip>
            </span>
          )}
          {!advanced && preview.error && (
            <span className="jira-report__jql jira-report__jql--warn">{preview.error}</span>
          )}
        </div>

        {advanced && (
          <Textarea
            code
            rows={3}
            value={customJql}
            onChange={(e) => setCustomJql(e.target.value)}
            placeholder='예: project = SSB AND labels = "release" ORDER BY created ASC'
            aria-label="JQL"
          />
        )}
      </div>

      {projectsError && <Banner variant="warning">{projectsError}</Banner>}
      {error && <Banner variant="danger">{error}</Banner>}
      {truncated && (
        <Banner variant="warning">
          결과가 많아 앞 {issues.length}건만 받았습니다 — 기간을 좁히거나 프로젝트를 줄여 주세요.
        </Banner>
      )}

      {/* ── 결과 필터·정렬 (받은 결과 안에서) ── */}
      {issues.length > 0 && (
        <div className="jira-report__tools">
          <MultiSelect
            options={facets.status}
            values={fStatus}
            onChange={setFStatus}
            allLabel="상태 전체"
            countLabel={(n) => `상태 ${n}개`}
            small
            aria-label="상태 필터"
          />
          <MultiSelect
            options={facets.assignee}
            values={fAssignee}
            onChange={setFAssignee}
            allLabel="담당자 전체"
            countLabel={(n) => `담당자 ${n}명`}
            small
            aria-label="담당자 필터"
          />
          <MultiSelect
            options={facets.label}
            values={fLabel}
            onChange={setFLabel}
            allLabel="레이블 전체"
            countLabel={(n) => `레이블 ${n}개`}
            small
            aria-label="레이블 필터"
          />
          <MultiSelect
            options={facets.type}
            values={fType}
            onChange={setFType}
            allLabel="유형 전체"
            countLabel={(n) => `유형 ${n}개`}
            small
            aria-label="유형 필터"
          />
          <Input
            small
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="번호·제목 검색"
            aria-label="번호·제목 검색"
            className="jira-report__search"
          />
          <div className="jira-report__tools-right">
            <Select
              options={SORTS}
              value={sort}
              onChange={(v) => setSort(v as SortKey)}
              small
              aria-label="정렬"
            />
            <span className="jira-report__count">
              {filtered ? `${visible.length} / ${issues.length}건` : `${issues.length}건`}
              {selectedVisible.length > 0 && ` · 선택 ${selectedVisible.length}`}
            </span>
          </div>
        </div>
      )}

      {/* ── 복사 형식 + 복사 ── */}
      {issues.length > 0 && (
        <div className="jira-report__copybar">
          <Select
            options={TEMPLATE_PRESETS.map((p) => ({ value: p.template, label: p.label }))}
            value={presetValue}
            onChange={saveTemplate}
            small
            placeholder="형식 프리셋"
            aria-label="복사 형식 프리셋"
            className="jira-report__preset"
          />
          <Input
            small
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            onBlur={(e) => saveTemplate(e.target.value)}
            // 자리표시자를 커서 자리에 넣기 위해 요소와 커서 위치를 기억한다
            // (공용 Input 은 ref 를 받지 않으므로 이벤트에서 요소를 집는다)
            onFocus={(e) => {
              templateEl.current = e.currentTarget;
              caret.current = e.currentTarget.selectionStart;
            }}
            onSelect={(e) => {
              caret.current = e.currentTarget.selectionStart;
            }}
            placeholder={DEFAULT_TEMPLATE}
            aria-label="복사 템플릿"
            className="jira-report__template"
          />
          <Tooltip label={helpOpen ? '자리표시자 목록 닫기' : '쓸 수 있는 자리표시자 보기'}>
            <button
              type="button"
              className={'icon-btn' + (helpOpen ? ' jira-report__help--on' : '')}
              aria-label="쓸 수 있는 자리표시자 보기"
              aria-expanded={helpOpen}
              onClick={() => setHelpOpen((v) => !v)}
            >
              <Icon name="info" size={14} />
            </button>
          </Tooltip>
          <Button
            variant="primary"
            size="sm"
            disabled={copyTargets.length === 0}
            onClick={doCopy}
          >
            <Icon name="copy" size={13} />
            {selectedVisible.length > 0
              ? `선택 ${selectedVisible.length}건 복사`
              : `전체 ${visible.length}건 복사`}
          </Button>
        </div>
      )}
      {/* 자리표시자 목록 — (i) 로 펼친다. 누르면 템플릿에 삽입되고, 값은 첫 티켓 기준 예시 */}
      {issues.length > 0 && helpOpen && (
        <div className="jira-report__vars">
          <p className="jira-report__vars-hint">
            누르면 템플릿 커서 자리에 들어갑니다. 탭은 <code>\t</code>, 줄바꿈은{' '}
            <code>\n</code> 으로 넣으세요.
          </p>
          <div className="jira-report__vars-list">
            {TEMPLATE_VARS.map((v) => {
              const sample = copyTargets[0] ? v.get(copyTargets[0]) : '';
              return (
                <button
                  type="button"
                  key={v.name}
                  className="jira-report__var"
                  // 누를 때 입력칸의 포커스·커서를 잃지 않게 한다 — 잃으면 커서가 어디였는지
                  // 알 수 없어 연달아 넣을 때 자리가 끝으로 튄다
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertVar(v.name)}
                  title={sample ? `${v.label} — 예: ${sample}` : v.label}
                >
                  <code>{`{${v.name}}`}</code>
                  <span className="jira-report__var-label">{v.label}</span>
                  {sample && <span className="jira-report__var-sample">{sample}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {issues.length > 0 && copyTargets[0] && (
        <p className="hint jira-report__preview" title="첫 줄 미리보기">
          {renderTemplateLine(template, copyTargets[0])}
        </p>
      )}

      {/* ── 결과 표 ── */}
      {loading && issues.length === 0 ? (
        <p className="hint">불러오는 중...</p>
      ) : !queried ? (
        <EmptyState
          icon="clipboard-list"
          message="프로젝트와 기간을 고르고 [조회]를 누르세요."
          hint="조회한 조건은 저장되어 다음에 열 때 바로 불러옵니다."
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon="search"
          message={filtered ? '필터에 맞는 티켓이 없습니다.' : '조건에 맞는 티켓이 없습니다.'}
        />
      ) : (
        <div className="jira-report__table" role="table" aria-label="티켓 목록">
          <div className="jira-report__trow jira-report__trow--head" role="row">
            <span className="jira-report__cell jira-report__cell--check">
              <Checkbox
                checked={allVisibleSelected}
                onChange={toggleAll}
                aria-label="보이는 티켓 전체 선택"
              />
            </span>
            <span className="jira-report__cell">번호</span>
            <span className="jira-report__cell">제목</span>
            <span className="jira-report__cell">유형</span>
            <span className="jira-report__cell">상태</span>
            <span className="jira-report__cell">담당자</span>
            <span className="jira-report__cell">{dateFieldLabel}</span>
          </div>
          {visible.map((it) => (
            <div
              key={it.key}
              className={
                'jira-report__trow' + (selected.has(it.key) ? ' jira-report__trow--on' : '')
              }
              role="row"
            >
              <span className="jira-report__cell jira-report__cell--check">
                <Checkbox
                  checked={selected.has(it.key)}
                  onChange={() => toggleOne(it.key)}
                  aria-label={`${it.key} 선택`}
                />
              </span>
              <span className="jira-report__cell">
                <button
                  type="button"
                  className="jira__key"
                  onClick={() => void window.oneApp.openExternal(it.url)}
                  title={`${it.key} — 브라우저에서 열기`}
                >
                  {it.key}
                </button>
              </span>
              <span className="jira-report__cell jira-report__cell--title">
                <button
                  type="button"
                  className="jira__title"
                  onClick={() => openIssue(it)}
                  title={onOpenDetail ? `${it.key} — 여기서 바로 보기` : `${it.key} — 브라우저에서 열기`}
                >
                  {it.summary}
                </button>
                {it.labels.map((l) => (
                  <span key={l} className="jira-report__chip">
                    {l}
                  </span>
                ))}
              </span>
              <span className="jira-report__cell jira-report__cell--dim">{it.issueType}</span>
              <span className="jira-report__cell">
                <Badge variant={statusBadgeVariant(it)}>{it.status}</Badge>
              </span>
              <span className="jira-report__cell jira-report__cell--dim">
                {it.assignee ?? '—'}
              </span>
              <span className="jira-report__cell jira-report__cell--date">
                {isoToDay(dateOf(it, dateField)) || '—'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
