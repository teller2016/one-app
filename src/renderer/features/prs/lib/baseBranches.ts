// PR 대상(base) 후보 정렬 — "주된 브랜치가 상단"이 되도록 신호를 우선순위로 합친다.
// 신호 출처: 프로젝트 레지스트리 defaultBranch(사용자 설정) · Gitea default_branch ·
// 저장소별 최근 사용(userData/prs.json) · 관례 이름표 · 보호 브랜치 · 마지막 커밋 시각.
import { mainBranchRank, type PrBaseBranch } from '../../../../shared/types';

/** 정렬·표시용 base 후보 (원본 + 렌더러만 아는 신호) */
export type BaseOption = PrBaseBranch & {
  isProjectDefault?: boolean; // 프로젝트 레지스트리에 설정된 기본 브랜치
  isRecent?: boolean; // 이 저장소에서 마지막으로 고른 base
};

/** 낮을수록 상단 — 순위표 자체가 "주된 브랜치" 정의다 */
const rankOf = (b: BaseOption): number => {
  if (b.isProjectDefault) return 0;
  if (b.isDefault) return 1;
  if (b.isRecent) return 2;
  const conv = mainBranchRank(b.name);
  if (conv !== null) return 10 + conv; // main → master → develop → … → release/* → hotfix/*
  if (b.protected) return 50;
  return 90;
};

/**
 * base 후보에 렌더러 신호를 붙여 정렬한다.
 * 동순위는 마지막 커밋 최신순 → 이름순(커밋 시각이 없는 검색 목록 대비).
 */
export function sortBaseOptions(
  names: PrBaseBranch[],
  opts: { projectDefault?: string; recent?: string },
): BaseOption[] {
  return names
    .map<BaseOption>((b) => ({
      ...b,
      isProjectDefault: !!opts.projectDefault && b.name === opts.projectDefault,
      isRecent: !!opts.recent && b.name === opts.recent,
    }))
    .sort(
      (a, b) =>
        rankOf(a) - rankOf(b) ||
        (b.committedAt ?? 0) - (a.committedAt ?? 0) ||
        a.name.localeCompare(b.name),
    );
}

/**
 * 후보에 표시할 라벨 태그 (없으면 null).
 * 보호를 '최근'보다 먼저 보여준다 — 최근에 골랐다는 정보보다 위험 신호가 중요하다.
 */
export const baseTagOf = (b: BaseOption): string | null =>
  b.isProjectDefault || b.isDefault
    ? '기본'
    : b.protected
      ? '보호'
      : b.isRecent
        ? '최근'
        : null;

/**
 * 이 base 를 고르면 타이핑 확인을 요구할지 — 프로젝트 기본이 아닌 주요 브랜치(보호 또는
 * 관례 이름)로 PR 을 만드는 경우. main 에 실수로 PR 을 만드는 사고를 막는다.
 */
export const needsBaseConfirm = (
  base: string,
  projectDefault: string | undefined,
  candidate: BaseOption | undefined,
): boolean =>
  !!base &&
  base !== projectDefault &&
  (!!candidate?.protected || mainBranchRank(base) !== null);
