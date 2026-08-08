import type { PrItem } from '../../../../shared/types';
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
            {/* 저장소명은 싣지 않는다 — 위 저장소 탭으로 이미 좁혀져 있어 모든 행이
                같은 값이라 자리만 먹었다. 그 자리에 정작 아쉬웠던 작성자를 넣는다 */}
            <span className="prs__item-top">
              <span className="prs__item-author">{pr.author}</span>
              {pr.createdAt ? (
                <span className="prs__item-when">{rel(pr.createdAt)}</span>
              ) : null}
            </span>
            <span className="prs__item-title" title={pr.title}>
              {pr.title}
            </span>
            {/* 상태 뱃지(승인·리뷰 대기·충돌)는 싣지 않는다 — 목록은 훑는 화면이고
                정본은 어차피 상세 패널이다(2026-08-08 사용자 요청). 대상 브랜치 칩은
                '어디로 들어가는지'라 성격이 달라 남긴다. */}
            <span className="prs__item-meta">
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
