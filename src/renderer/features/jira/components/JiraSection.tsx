import { useCallback, useEffect, useMemo, useState } from 'react';
import type { JiraIssue } from '../../../../shared/types';
import { Badge } from '../../../components/Badge';
import { Banner } from '../../../components/Banner';
import { Icon } from '../../../components/Icon';
import type { IconName } from '../../../components/Icon';
import { RefreshButton } from '../../../components/RefreshButton';
import { SectionHeader } from '../../../components/SectionHeader';

/** ISO 시각 → '3시간 전' 상대 표기 */
const rel = (iso: string) => {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '';
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
};

/** 상태 카테고리 → 뱃지 색 (해야 할 일=회색, 진행 중=노랑, 완료=초록) */
const badgeVariant = (cat: JiraIssue['statusCategory']) =>
  cat === 'done' ? ('ok' as const) : cat === 'indeterminate' ? ('busy' as const) : ('idle' as const);

/**
 * 타입 이름 → 표시 정보 (커스텀 타입 대응을 위해 키워드로 판별).
 * 그룹 정렬 순서: 에픽 → 스토리 → 작업 → 버그 → 하위 작업·sub-bug → 기타
 */
const typeInfo = (name: string): { rank: number; icon: IconName; tone: string } => {
  const n = name.toLowerCase();
  const isSub = n.includes('하위') || n.includes('sub');
  if (n.includes('버그') || n.includes('bug'))
    return { rank: isSub ? 4 : 3, icon: 'bug', tone: 'bug' };
  if (n.includes('에픽') || n.includes('epic')) return { rank: 0, icon: 'check', tone: 'epic' };
  if (n.includes('스토리') || n.includes('story')) return { rank: 1, icon: 'check', tone: 'story' };
  if (isSub) return { rank: 4, icon: 'corner-down-right', tone: 'sub' };
  return { rank: 2, icon: 'check', tone: 'task' };
};

/** Jira 내 이슈 — 타입별 그룹 카드. 행 클릭 → 브라우저(Jira)에서 열기. */
export function JiraSection() {
  const [issues, setIssues] = useState<JiraIssue[]>([]);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await window.oneApp.jira.list();
    setConfigured(res.configured);
    if (res.ok && res.issues) {
      setIssues(res.issues);
      setError('');
    } else {
      setError(res.error ?? '이슈를 불러오지 못했습니다.');
    }
    setLoading(false);
  }, []);

  // 최초 로드 + 2분 자동 새로고침 (PR 섹션과 동일 주기)
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 120_000);
    return () => clearInterval(timer);
  }, [load]);

  // 타입별 그룹핑 — 그룹은 rank 순, 그룹 안은 API 정렬(최신 갱신순) 유지
  const groups = useMemo(() => {
    const map = new Map<string, JiraIssue[]>();
    for (const it of issues) {
      const list = map.get(it.issueType) ?? [];
      list.push(it);
      map.set(it.issueType, list);
    }
    return [...map.entries()]
      .map(([type, items]) => ({ type, items, ...typeInfo(type) }))
      .sort((a, b) => a.rank - b.rank || a.type.localeCompare(b.type));
  }, [issues]);

  return (
    <div className="section">
      <div className="jira__head">
        <SectionHeader
          title="Jira"
          icon={<Icon name="clipboard-list" size={18} />}
          sub="내게 할당된 미해결 이슈입니다. 클릭하면 브라우저에서 열려요."
        />
        <RefreshButton
          size={14}
          spinning={loading}
          onClick={() => void load()}
          title="이슈 목록 새로고침"
        />
      </div>

      {!configured && (
        <Banner variant="info">
          환경설정 → 연동에서 Jira 주소·이메일·API 토큰을 입력하면 내 이슈가
          표시됩니다.
        </Banner>
      )}
      {configured && error && <Banner variant="danger">{error}</Banner>}

      {loading && issues.length === 0 ? (
        <p className="hint">불러오는 중...</p>
      ) : issues.length === 0 && configured && !error ? (
        <div className="empty-state">
          <span className="empty-state__icon">
            <Icon name="check" size={20} />
          </span>
          <p>미해결 이슈가 없습니다. 깔끔하네요!</p>
        </div>
      ) : (
        groups.map(({ type, items, icon, tone }) => (
          <div className="jira__group" key={type}>
            <div className="jira__group-head">
              <span className={`jira__type jira__type--${tone}`}>
                <Icon name={icon} size={12} />
              </span>
              <span className="jira__group-name">{type}</span>
              <span className="jira__group-count">{items.length}</span>
            </div>
            <div className="jira__card">
              {items.map((it) => (
                <button
                  type="button"
                  className="jira__row"
                  key={it.key}
                  onClick={() => void window.oneApp.openExternal(it.url)}
                  title={[
                    `${it.key} — 브라우저에서 열기`,
                    it.priority && `우선순위 ${it.priority}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                >
                  <span className="jira__key">{it.key}</span>
                  <span className="jira__title">{it.summary}</span>
                  {it.parentKey && (
                    <span
                      className="jira__parent"
                      title={`부모 이슈 ${it.parentKey}`}
                    >
                      <Icon name="corner-down-right" size={11} />
                      {it.parentKey}
                    </span>
                  )}
                  <Badge variant={badgeVariant(it.statusCategory)}>
                    {it.status}
                  </Badge>
                  <span className="jira__time">{rel(it.updatedAt)}</span>
                  <span className="jira__open" aria-hidden="true">
                    <Icon name="arrow-up-right" size={12} />
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
