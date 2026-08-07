import type { PrItem } from '../../../../shared/types';
import { Badge } from '../../../components/Badge';
import { Icon } from '../../../components/Icon';
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
}: {
  items: PrItem[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  /** 저장소의 프로젝트 기본 브랜치 — 그 외 브랜치로 가는 PR 강조용 */
  defaultBranchOf: (repo: string) => string | undefined;
}) {
  return (
    <div className="prs__list">
      {items.map((pr) => {
        const key = keyOf(pr);
        const projectDefault = defaultBranchOf(pr.repo);
        const off = !!pr.base && !!projectDefault && pr.base !== projectDefault;
        return (
          <button
            type="button"
            key={key}
            className={'prs__item' + (key === selectedKey ? ' prs__item--sel' : '')}
            aria-pressed={key === selectedKey}
            onClick={() => onSelect(key)}
          >
            <span className="prs__item-top">
              <span className="prs__item-repo">{pr.repo.split('/').pop()}</span>
              {pr.createdAt ? (
                <span className="prs__item-when">{rel(pr.createdAt)}</span>
              ) : null}
            </span>
            <span className="prs__item-title" title={pr.title}>
              {pr.title}
            </span>
            <span className="prs__item-meta">
              {pr.approvals != null && pr.approvals > 0 ? (
                <Badge variant="ok">승인 {pr.approvals}</Badge>
              ) : (
                <Badge variant="idle">리뷰 대기</Badge>
              )}
              {pr.mergeable === false && <Badge variant="fail">충돌</Badge>}
              {off && (
                <span
                  className="prs__item-off"
                  title={`프로젝트 기본 브랜치가 아닌 ${pr.base} 로 들어가는 PR`}
                >
                  <Icon name="arrow-right" size={12} />
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
