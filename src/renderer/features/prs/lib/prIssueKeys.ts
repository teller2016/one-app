import type { JiraIssueStatus, PrItem } from '../../../../shared/types';
import { issueKeysIn } from '../../../../shared/jira-url';

/**
 * PR 의 Jira 이슈 키 후보 — **브랜치 우선, 그다음 제목**(2026-10-21 사용자 지정).
 * 브랜치(`feature/SSB-86`)는 티켓에서 만든 이름이라 제목보다 믿을 만하고, 제목은 사람이
 * 고쳐 쓰거나(`Reapply "Merge …"`) 키를 빼먹는다. 브랜치에 키가 없으면 제목에서 찾는다.
 *
 * ⚠️ 목록 1단계(light)에는 `head` 가 없다(전역 검색 API 가 브랜치를 주지 않는다) — 그때는
 * 제목만 보고, 보강본이 오면 브랜치 기준으로 바뀐다.
 */
export const prIssueKeys = (pr: Pick<PrItem, 'head' | 'title'>): string[] => [
  ...new Set([...issueKeysIn(pr.head ?? ''), ...issueKeysIn(pr.title)]),
];

/**
 * 대표 키 하나 — 후보 중 **Jira 에서 상태를 받은 첫 키**, 아직 모르면 첫 후보.
 * 브랜치 이름의 키 모양 오탐(`release/V2-1`)이 Jira 에 없으면 제목의 진짜 키로 넘어간다.
 * 목록 뱃지·머지 후 해결 제안이 같은 키를 보게 이 함수 하나로 고른다.
 */
export const primaryIssueKey = (
  pr: Pick<PrItem, 'head' | 'title'>,
  statuses: Record<string, JiraIssueStatus>,
): string | undefined => {
  const keys = prIssueKeys(pr);
  return keys.find((k) => statuses[k]) ?? keys[0];
};
