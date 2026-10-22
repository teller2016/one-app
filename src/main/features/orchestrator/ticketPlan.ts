// 티켓 세션을 어디서 열지 — 순수 판정(ticketPlan.test.ts). 기획 결정(2026-10-21·22):
//   ① 그 티켓 브랜치의 워크트리가 있으면 거기 ② 브랜치만 있으면(로컬·원격) 그 브랜치로 새 워크트리
//   ③ 주 체크아웃이 비어 있으면(기본 브랜치·변경 없음·세션 없음) 주 체크아웃 — 브랜치는 워커(스킬)가 딴다
//   ④ 아니면 새 워크트리 — 브랜치 이름은 이슈 유형으로(버그 계열 fix/키, 그 외 feature/키). -v2 같은 새 이름은 만들지 않는다.
// 티켓 키는 브랜치 마지막 조각의 앞머리로 맞춘다(`feature/SSB-137` · `fix/SSB-137-쿠폰`) — shared `branchIssueKey`, Jira [작업] 모달·list_sessions 와 같은 규칙.
import { branchIssueKey } from '../../../shared/jira-url';

export type PlanWorktree = { path: string; branch?: string; isMain: boolean; dirty: boolean };

export type TicketPlace =
  /** 이미 그 티켓의 워크트리가 있다(주 체크아웃일 수도) */
  | { kind: 'existing'; path: string; branch: string; main: boolean }
  /** 비어 있는 주 체크아웃에서 시작 */
  | { kind: 'main'; path: string; branch: string | null }
  /** 새 워크트리 — fromBranch 면 이미 있는 브랜치, 아니면 새 브랜치 */
  | { kind: 'new'; branch: string; fromBranch: boolean };

/** 주 체크아웃을 그대로 써도 되는 브랜치 — 다른 작업 브랜치에 올라가 있으면 그 위에 새 티켓을 얹지 않는다 */
const BASE_BRANCHES = new Set(['main', 'master', 'develop', 'dev']);

const BUG_RE = /버그|bug|결함|장애|defect/i;

/** 이슈 유형으로 정한 새 브랜치 이름 — Jira [작업]의 스킬 자동 선택(bugfix/dev)과 같은 판별 */
export const branchNameFor = (key: string, issueType: string) => `${BUG_RE.test(issueType) ? 'fix' : 'feature'}/${key}`;

/**
 * 루트가 넘긴 브랜치 이름을 받아도 되는가 — 셸·경로로 새지 않게 좁게(git check-ref-format 의 부분집합).
 * ⚠️ femc-wt.sh 는 인자가 **있는 폴더면 그 워크트리를 채운다**(`[ -d "$TARGET" ]`, 작업 폴더 기준) — `.`·`src` 같은 이름이
 *    저장소 안 폴더로 읽히지 않게 조각 첫 글자 `.`·`-` 를 막고, 실행은 빈 임시 폴더에서 한다(worktreeSetup.ts).
 */
export const isSafeBranchName = (name: string): boolean =>
  /^(?![-./])(?!.*(?:\.\.|\/\/|\/[-.]))(?!.*(?:\/|\.|\.lock)$)[\w.\-/]{1,100}$/.test(name);

export function pickPlace(input: {
  key: string;
  issueType: string;
  worktrees: PlanWorktree[];
  /** 로컬·원격 브랜치 이름(원격은 `origin/…` 그대로) */
  branches: string[];
  /** 그 경로(또는 아래)에 떠 있는 세션 수 */
  sessionsAt: (path: string) => number;
}): TicketPlace {
  const { key } = input;
  const wt = input.worktrees.find((w) => branchIssueKey(w.branch) === key);
  if (wt?.branch) return { kind: 'existing', path: wt.path, branch: wt.branch, main: wt.isMain };

  const named = input.branches.map((b) => b.replace(/^origin\//, '')).find((b) => branchIssueKey(b) === key);
  if (named) return { kind: 'new', branch: named, fromBranch: true };

  const main = input.worktrees.find((w) => w.isMain);
  if (main && !main.dirty && input.sessionsAt(main.path) === 0 && (!main.branch || BASE_BRANCHES.has(main.branch))) {
    return { kind: 'main', path: main.path, branch: main.branch ?? null };
  }
  return { kind: 'new', branch: branchNameFor(key, input.issueType), fromBranch: false };
}
