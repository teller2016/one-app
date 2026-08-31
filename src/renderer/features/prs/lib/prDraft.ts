import { isMergeCommit, type DeployCommit } from '../../../../shared/types';

/**
 * PR 제목·본문 초안 생성 — 커밋 목록에서 **머지 커밋과 다른 주요 브랜치에 이미
 * 머지된 커밋(`alreadyIn`)을 걸러낸 뒤** 대표 커밋을 고른다.
 *
 * 예전에는 `commits[0]`(= 오래된 순 배열의 첫 커밋)을 그대로 썼는데, 브랜치를 딴 직후
 * `develop` 을 끌어오면 그 머지 커밋이 맨 앞이라 PR 제목이
 * `[BBJ-3579] Merge pull request '…' from …` 처럼 나왔다(실측: store#1223).
 *
 * `alreadyIn` 제외도 같은 병 — main 머지를 거친 브랜치를 develop 으로 PR 하면
 * main 에서 딸려온 커밋이 통째로 다시 잡혀, 남의 옛 커밋이 제목이 되고 본문이
 * 중복 나열로 부풀었다(2026-08-31 사용자 신고).
 */

/** 커밋 메시지의 첫 줄 */
const subjectOf = (message: string) => message.split('\n')[0]?.trim() ?? '';

/**
 * conventional 접두사의 작업 유형별 대표 우선순위 — 낮을수록 먼저.
 * 브랜치의 주 작업이 곁가지(`chore`·`style`)에 밀려 제목이 되는 것을 막는다.
 */
const TYPE_RANK: Record<string, number> = {
  feat: 0,
  fix: 1,
  refactor: 2,
  perf: 3,
};
const RANK_OTHER = 4; // style·chore·docs·test·ci·build·접두사 없음

/** `feat(cart)!: …` → `feat` (없으면 null) */
const typeOf = (subject: string) => {
  const m = /^([a-z]+)(\([^)]*\))?!?:/i.exec(subject);
  return m ? m[1].toLowerCase() : null;
};

const rankOf = (subject: string) => {
  const type = typeOf(subject);
  return type != null ? TYPE_RANK[type] ?? RANK_OTHER : RANK_OTHER;
};

/**
 * 제목·본문 초안. `commits` 는 **오래된 순**(main 의 `fetchBranchCommits` 반환 순서).
 *
 * - 제목: `[브랜치라벨] 대표 커밋 제목` — 작업 유형 우선순위, 동순위면 가장 오래된 커밋
 * - 본문: 커밋 제목 불릿 (머지 커밋·다른 주요 브랜치에 이미 머지된 커밋 제외)
 * - 새 커밋이 하나도 없으면(역머지·되가져오기 브랜치 등) 제목은 라벨만 두고 본문은
 *   비머지 전체 → 그마저 없으면 전체 커밋을 싣는다 — 이미 머지된 커밋 문구를 제목에
 *   넣는 것보다 비워 두는 편이 낫다는 판단.
 */
export function draftPr(
  branchLabel: string,
  commits: DeployCommit[],
): { title: string; body: string } {
  const real = commits.filter((c) => !isMergeCommit(c));
  const fresh = real.filter((c) => !c.alreadyIn);
  const lead = fresh.reduce<DeployCommit | null>((best, c) => {
    if (!best) return c;
    // `<` 이므로 동순위에서는 먼저 나온(= 더 오래된) 커밋이 유지된다
    return rankOf(subjectOf(c.message)) < rankOf(subjectOf(best.message)) ? c : best;
  }, null);

  const subject = lead ? subjectOf(lead.message) : '';
  const title = `[${branchLabel}]${subject ? ` ${subject}` : ''}`.slice(0, 100);
  const forBody = fresh.length > 0 ? fresh : real.length > 0 ? real : commits;
  const body = forBody.map((c) => `- ${subjectOf(c.message)}`).join('\n');

  return { title, body };
}
