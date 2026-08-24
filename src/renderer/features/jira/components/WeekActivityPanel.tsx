import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  JiraActivityIssue,
  JiraEngagement,
} from '../../../../shared/types';
import { Badge } from '../../../components/Badge';
import { Banner } from '../../../components/Banner';
import { Button } from '../../../components/Button';
import { EmptyState } from '../../../components/EmptyState';
import { Icon } from '../../../components/Icon';
import type { IconName } from '../../../components/Icon';
import { RefreshButton } from '../../../components/RefreshButton';
import { Segment } from '../../../components/Segment';
import { TextLink } from '../../../components/TextLink';
import { Tooltip } from '../../../components/Tooltip';
import { useAsync } from '../../../lib/useAsync';
import { useCopy } from '../../../lib/useCopy';

import { statusBadgeVariant } from '../lib/issue';
import { eventTime, MAX_WEEKS_BACK, weekLabel, weekRange } from '../lib/week';

/** 관여도 필터 — 'all' 은 필터 해제 */
type Filter = 'all' | JiraEngagement;

/** 관여도별 표시 정보 (아이콘·이름·설명) */
const ENGAGEMENT: Record<
  JiraEngagement,
  { icon: IconName; label: string; hint: string }
> = {
  resolved: {
    icon: 'check',
    label: '해결',
    hint: '이 주에 내가 해결·완료 상태로 넘겼습니다',
  },
  progressed: {
    icon: 'play',
    label: '진행',
    hint: '이 주에 내가 상태를 옮겼지만 완료까지는 아닙니다',
  },
  touched: {
    icon: 'circle',
    label: '연관',
    hint: '상태 전환 없이 담당·작업시간·필드 변경만 있었습니다',
  },
};

const ORDER: JiraEngagement[] = ['resolved', 'progressed', 'touched'];

/** 이력 한 줄 — "화 14:20 · 상태 · 진행 중 → 완료" */
function EventRow({
  at,
  field,
  from,
  to,
}: {
  at: string;
  field: string;
  from: string | null;
  to: string | null;
}) {
  const before = from?.trim() ? from : '—';
  const after = to?.trim() ? to : '—';
  return (
    <div className="jira-week__event">
      <span className="jira-week__event-time">{eventTime(at)}</span>
      <span className="jira-week__event-field">{field}</span>
      <span className="jira-week__event-change" title={`${before} → ${after}`}>
        <span className="jira-week__event-from">{before}</span>
        <Icon name="arrow-right" size={11} />
        <span className="jira-week__event-to">{after}</span>
      </span>
    </div>
  );
}

/** 티켓 한 줄 + 펼침 이력 */
function ActivityRow({
  issue,
  expanded,
  onToggle,
  onOpenDetail,
  onCopyLink,
}: {
  issue: JiraActivityIssue;
  expanded: boolean;
  onToggle: (key: string) => void;
  onOpenDetail: (key: string) => void;
  onCopyLink: (issue: JiraActivityIssue) => void;
}) {
  const eg = ENGAGEMENT[issue.engagement];
  const hint = issue.historyMissing
    ? `${eg.hint} (상세 이력을 못 받아 추정한 값입니다)`
    : eg.hint;
  const last = issue.events.at(-1);
  return (
    <div className="jira-week__item">
      <div className="jira-week__row">
        <Tooltip label={`${eg.label} — ${hint}`}>
          <span
            className={
              `jira-week__mark jira-week__mark--${issue.engagement}` +
              (issue.historyMissing ? ' jira-week__mark--guess' : '')
            }
            aria-label={eg.label}
          >
            <Icon name={eg.icon} size={13} />
          </span>
        </Tooltip>

        <span className="jira__keywrap">
          <button
            type="button"
            className="jira__key"
            onClick={() => void window.oneApp.openExternal(issue.url)}
            title={`${issue.key} — 브라우저에서 열기`}
          >
            {issue.key}
          </button>
          <button
            type="button"
            className="icon-btn jira__copy"
            onClick={() => onCopyLink(issue)}
            title="이슈 링크 복사"
            aria-label={`${issue.key} 링크 복사`}
          >
            <Icon name="copy" size={12} />
          </button>
        </span>

        <button
          type="button"
          className="jira__title"
          onClick={() => onOpenDetail(issue.key)}
          title={`${issue.key} — 여기서 바로 보기`}
        >
          {issue.summary}
        </button>

        {/* 내 마지막 활동 시각 — 이력이 없으면 티켓 갱신 시각으로 대신한다 */}
        <span
          className="jira-week__when"
          title={last ? '내 마지막 변경' : '티켓 최종 갱신'}
        >
          {eventTime(last?.at ?? issue.updatedAt)}
        </span>

        <Badge variant={statusBadgeVariant(issue)}>{issue.status}</Badge>

        <button
          type="button"
          className={
            'icon-btn jira-week__toggle' + (expanded ? ' jira-week__toggle--on' : '')
          }
          onClick={() => onToggle(issue.key)}
          disabled={issue.events.length === 0}
          aria-expanded={expanded}
          aria-label={`${issue.key} 변경 이력`}
          title={
            issue.events.length === 0
              ? '표시할 변경 이력이 없습니다'
              : `내 변경 ${issue.events.length}건`
          }
        >
          <Icon name="chevron-down" size={13} />
        </button>
      </div>

      {expanded && issue.events.length > 0 && (
        <div className="jira-week__events">
          {issue.events.map((e, i) => (
            <EventRow key={`${e.at}-${e.field}-${i}`} {...e} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 주간 활동 — 한 주(월~일) 동안 내가 손댄 티켓을 관여도(해결·진행·연관)와 함께 나열한다.
 * 데이터는 main 의 `jira:activity`(세 갈래 JQL + changelog 판정)에서 온다.
 */
export function WeekActivityPanel({
  onOpenDetail,
}: {
  /** 제목 클릭 — 상세 패널은 섹션이 하나만 들고 있다(중복 마운트 방지) */
  onOpenDetail: (key: string) => void;
}) {
  const [offset, setOffset] = useState(0);
  const range = useMemo(() => weekRange(offset), [offset]);
  const [filter, setFilter] = useState<Filter>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const copy = useCopy();

  // 새로고침 버튼만 캐시를 건너뛴다(`force`). `reload()` 는 인자를 받지 않으므로
  // 다음 1회분 의사를 ref 로 넘기고 조회 시점에 비운다.
  const forceRef = useRef(false);

  // ⚠️ 주 이동은 **캐시된 주(즉시)와 미캐시 주(약 1초)를 섞어** 부르므로 응답이 역순으로
  // 도착할 수 있다. `useAsync` 의 세대 카운터가 오래된 응답을 버린다 — 이걸 손으로 하면
  // 라벨은 이번 주, 목록은 지난 주가 되고 그 상태의 [링크 N] 이 주간보고에 다른 주의
  // 링크를 넣는다. try/catch 도 훅이 맡아 IPC 예외 때 로딩이 갇히지 않는다.
  const fetchActivity = useCallback(() => {
    const force = forceRef.current;
    forceRef.current = false;
    return window.oneApp.jira.activity(range.start, range.end, force);
  }, [range.start, range.end]);

  const {
    data,
    loading,
    error: fetchError,
    reload,
  } = useAsync(fetchActivity, {
    errorFallback: '활동 내역을 불러오지 못했습니다.',
  });

  const refresh = () => {
    forceRef.current = true;
    void reload();
  };

  // 결과에서 화면 값을 끌어낸다 — 첫 렌더(data=null)는 '설정됨'으로 보아 안내 배너가
  // 깜빡이지 않게 한다. 실패해도 `configured` 는 응답을 그대로 따른다(미설정 안내용).
  // ⚠️ `useMemo` 로 참조를 고정한다 — 매 렌더 새 배열이면 아래 counts·projects 메모가
  // 통째로 다시 돌고 `exhaustive-deps` 경고도 뜬다
  const issues = useMemo<JiraActivityIssue[]>(
    () => (data?.ok ? (data.issues ?? []) : []),
    [data],
  );
  const configured = data?.configured ?? true;
  const warnings = data?.warnings ?? [];
  // IPC 예외(훅이 잡은 것)와 결과 자체의 실패 문구를 한 자리에서 보여준다
  const error =
    fetchError ||
    (data && !data.ok ? (data.error ?? '활동 내역을 불러오지 못했습니다.') : '');

  // 주가 바뀌면 펼친 행을 접는다 — 다른 주의 티켓이라 펼침 상태를 이어갈 의미가 없다
  useEffect(() => {
    setExpanded(new Set());
  }, [range.start, range.end]);

  const counts = useMemo(() => {
    const map = { resolved: 0, progressed: 0, touched: 0 };
    for (const it of issues) map[it.engagement] += 1;
    return map;
  }, [issues]);

  // 프로젝트별 분포 — 표시 전용 요약(필터는 관여도만)
  const projects = useMemo(() => {
    const map = new Map<string, number>();
    for (const it of issues) map.set(it.projectKey, (map.get(it.projectKey) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [issues]);

  const visible =
    filter === 'all' ? issues : issues.filter((it) => it.engagement === filter);

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const move = (delta: number) =>
    setOffset((cur) => Math.min(0, Math.max(-MAX_WEEKS_BACK, cur + delta)));

  // 링크 묶음 복사 — 주간보고에 그대로 붙여넣는 용도라 URL 만 담고,
  // 링크 사이에 빈 줄을 하나 둔다(붙여넣은 뒤 줄 사이에 설명을 적어 넣기 위해)
  const copyLinks = () =>
    copy(visible.map((it) => it.url).join('\n\n'), {
      success: `링크 ${visible.length}개를 복사했습니다`,
    });

  return (
    <div className="jira-week">
      {/* 주 이동 — 미래는 막고, 이번 주에서 벗어나면 돌아오는 버튼이 뜬다 */}
      <div className="jira-week__nav">
        <button
          type="button"
          className="icon-btn"
          onClick={() => move(-1)}
          disabled={offset <= -MAX_WEEKS_BACK}
          aria-label="이전 주"
          title="이전 주"
        >
          <Icon name="chevron-left" size={15} />
        </button>
        <span className="jira-week__label">{weekLabel(range)}</span>
        <button
          type="button"
          className="icon-btn"
          onClick={() => move(1)}
          disabled={offset >= 0}
          aria-label="다음 주"
          title="다음 주"
        >
          <Icon name="chevron-right" size={15} />
        </button>
        {offset !== 0 && (
          <TextLink small onClick={() => setOffset(0)}>
            이번 주
          </TextLink>
        )}
        <span className="jira-week__nav-gap" />
        <RefreshButton
          size={14}
          spinning={loading}
          onClick={refresh}
          title="이 주 활동 새로고침"
        />
      </div>

      {!configured && (
        <Banner variant="info">
          환경설정 → 연동에서 Jira 주소·이메일·API 토큰을 입력하면 주간 활동이 표시됩니다.
        </Banner>
      )}
      {configured && error && <Banner variant="danger">{error}</Banner>}
      {warnings.map((w) => (
        <Banner variant="warning" key={w}>
          {w}
        </Banner>
      ))}

      {issues.length > 0 && (
        <div className="jira-week__toolbar">
          <Segment<Filter>
            options={[
              { value: 'all', label: `전체 ${issues.length}` },
              ...ORDER.map((k) => ({
                value: k,
                label: (
                  <>
                    <Icon name={ENGAGEMENT[k].icon} size={12} />
                    {`${ENGAGEMENT[k].label} ${counts[k]}`}
                  </>
                ),
              })),
            ]}
            value={filter}
            onChange={setFilter}
          />
          <div className="jira-week__toolbar-right">
            {projects.length > 0 && (
              <span className="jira-week__projects">
                {projects.map(([key, count]) => `${key} ${count}`).join(' · ')}
              </span>
            )}
            {/* 주간보고에 붙여넣을 링크 묶음 — 지금 보이는 목록(필터 반영)만 담는다 */}
            <Button
              variant="ghost"
              size="sm"
              disabled={visible.length === 0}
              onClick={() => void copyLinks()}
              title="보이는 티켓의 Jira 링크를 줄바꿈으로 복사"
            >
              <Icon name="copy" size={13} />
              {`링크 ${visible.length}`}
            </Button>
          </div>
        </div>
      )}

      {loading && issues.length === 0 ? (
        <p className="hint">불러오는 중...</p>
      ) : issues.length === 0 && configured && !error ? (
        <EmptyState
          icon="clock"
          message="이 주에 기록된 작업이 없습니다"
          hint="Jira 에 남은 상태 변경·담당·작업시간 기록을 기준으로 모읍니다."
        />
      ) : visible.length === 0 ? (
        <EmptyState icon="search" message="이 조건에 맞는 티켓이 없습니다" />
      ) : (
        <div className="jira-week__card">
          {visible.map((it) => (
            <ActivityRow
              key={it.key}
              issue={it}
              expanded={expanded.has(it.key)}
              onToggle={toggle}
              onOpenDetail={onOpenDetail}
              onCopyLink={(i) =>
                void copy(i.url, { success: `${i.key} 링크를 복사했습니다` })
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
