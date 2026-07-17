import { useCallback, useEffect, useState } from 'react';
import type { JiraIssue } from '../../../../shared/types';
import { Badge } from '../../../components/Badge';
import { Banner } from '../../../components/Banner';
import { Icon } from '../../../components/Icon';
import { RefreshButton } from '../../../components/RefreshButton';
import { SectionHeader } from '../../../components/SectionHeader';
import { TextLink } from '../../../components/TextLink';

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

/** Jira 내 이슈 — 목록만 보여주고, 내용은 클릭해서 브라우저(Jira)로 확인한다. */
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
        <div className="jira__list">
          {issues.map((it) => (
            <div className="jira__row" key={it.key}>
              <div className="jira__main">
                <span className="jira__key">{it.key}</span>
                <TextLink
                  className="jira__title"
                  onClick={() => void window.oneApp.openExternal(it.url)}
                  title={`${it.key} — 브라우저에서 열기`}
                >
                  {it.summary}
                </TextLink>
              </div>
              <div className="jira__meta">
                <Badge variant={badgeVariant(it.statusCategory)}>
                  {it.status}
                </Badge>
                <span className="jira__sub">
                  {[it.issueType, it.priority, rel(it.updatedAt)]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
