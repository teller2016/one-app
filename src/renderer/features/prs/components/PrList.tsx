import type { JiraIssueStatus, PrItem } from '../../../../shared/types';
import { Badge } from '../../../components/Badge';
import { Icon } from '../../../components/Icon';
import { statusBadgeVariant } from '../../jira';
import { primaryIssueKey } from '../lib/prIssueKeys';
import { rel } from '../lib/relTime';

const keyOf = (pr: PrItem) => `${pr.repo}#${pr.number}`;

/**
 * PR 목록 (마스터-디테일의 좌측) — 행을 고르면 우측 상세 패널이 그 PR 을 보여준다.
 * 대상이 프로젝트 기본 브랜치가 아니면(main 등) 행에서도 주의색으로 드러낸다.
 */
export function PrList({
  items,
  selectedKey,
  onSelect,
  defaultBranchOf,
  issueStatuses,
}: {
  items: PrItem[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  /** 저장소의 프로젝트 기본 브랜치 — 그 외 브랜치로 가는 PR 강조용 */
  defaultBranchOf: (repo: string) => string | undefined;
  /** 티켓 키 → Jira 상태 — 대표 키(브랜치 우선 → 제목)의 상태를 행 윗줄에 뱃지로 */
  issueStatuses: Record<string, JiraIssueStatus>;
}) {
  return (
    <div className="prs__list">
      {items.map((pr) => {
        const key = keyOf(pr);
        const projectDefault = defaultBranchOf(pr.repo);
        const off = !!pr.base && !!projectDefault && pr.base !== projectDefault;
        // 브랜치 우선 → 제목의 대표 키 하나 — 머지 후 해결 제안도 같은 키다(나머지는 상세 패널에)
        const issueKey = primaryIssueKey(pr, issueStatuses);
        const issue = issueKey ? issueStatuses[issueKey] : undefined;
        return (
          <button
            type="button"
            key={key}
            className={'prs__item' + (key === selectedKey ? ' prs__item--sel' : '')}
            aria-pressed={key === selectedKey}
            onClick={() => onSelect(key)}
          >
            {/* 저장소명은 싣지 않는다 — 위 저장소 탭으로 이미 좁혀져 있어 모든 행이
                같은 값이라 자리만 먹었다. 그 자리에 정작 아쉬웠던 작성자를 넣는다 */}
            <span className="prs__item-top">
              <span className="prs__item-author">{pr.author}</span>
              {pr.createdAt ? (
                <span className="prs__item-when">{rel(pr.createdAt)}</span>
              ) : null}
              {/* 티켓 상태(2026-10-21 사용자 요청) — '해결됨'·'운영배포대기' 처럼 PR 바깥의 진척을
                  목록에서 훑는다. 상태를 모르면(Jira 미설정·없는 키) 자리도 비운다 */}
              {issue && (
                <span className="prs__item-issue">
                  <Badge
                    variant={statusBadgeVariant(issue)}
                    dot={false}
                    title={`${issueKey} — Jira 상태: ${issue.status}`}
                  >
                    {issue.status}
                  </Badge>
                </span>
              )}
            </span>
            <span className="prs__item-title" title={pr.title}>
              {pr.title}
            </span>
            {/* 상태 뱃지(승인·리뷰 대기)는 싣지 않는다 — 목록은 훑는 화면이고 정본은
                어차피 상세 패널이다(2026-08-08 사용자 요청). 예외는 **충돌**(2026-08-10
                사용자 요청) — 손을 대야 하는 PR 을 목록에서 골라내는 신호라 성격이 다르다.
                '충돌 없음'은 넣지 않는다(정상은 알릴 필요가 없다). 대상 브랜치 칩도
                '어디로 들어가는지'라 남긴다. */}
            <span className="prs__item-meta">
              {pr.mergeable === false && (
                <span
                  className="prs__item-conflict"
                  title="대상 브랜치와 컨플릭트가 있어 머지할 수 없습니다"
                >
                  <Icon name="alert-triangle" size={12} />
                  충돌
                </span>
              )}
              {pr.base && (
                <span
                  className={
                    'prs__item-base' + (off ? ' prs__item-base--off' : '')
                  }
                  title={
                    off
                      ? `프로젝트 기본 브랜치가 아닌 ${pr.base} 로 들어가는 PR`
                      : `${pr.base} 로 들어가는 PR`
                  }
                >
                  <Icon name="arrow-right" size={11} />
                  {pr.base}
                </span>
              )}
              <span className="prs__item-num">#{pr.number}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
