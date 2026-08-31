import { handleShared } from '../../lib/moIpc';
import {
  fetchOpenPrs,
  enrichApprovals,
  enrichBranches,
  fetchRecentBranches,
  fetchBaseCandidates,
  fetchAllBranchNames,
  fetchBranchCommits,
  createPr,
  fetchMergeInfo,
  fetchRepoMergeables,
  mergePr,
} from './gitea';
import { getPrsConfig, savePrsConfig } from './store';
import { getGiteaConfig } from '../settings/store';
import type {
  PrsConfig,
  PrListResult,
  PrBranchesResult,
  PrBaseBranchesResult,
  PrAllBranchesResult,
  PrCommitsResult,
  PrCreateInput,
  PrCreateResult,
  PrMergeInfoResult,
  PrMergeablesResult,
  PrMergeMethod,
  PrMergeResult,
} from '../../../shared/types';

// 목록 캐시 — 섹션을 오갈 때마다 리뷰 N+1 을 포함한 전체 재조회가 돌던 것을 막는다.
// 수동 새로고침(force)·PR 생성·머지는 캐시를 버린다.
const LIST_TTL_MS = 60_000;
let listCache: { at: number; full: boolean; result: PrListResult } | null = null;
let listInflight: { full: boolean; p: Promise<PrListResult> } | null = null;
// 무효화 세대 — 무효화 이전에 시작된 조회가 늦게 돌아와 stale 목록을 다시 캐시하는 것을 막는다
let listGen = 0;

/** 목록 캐시 무효화 — 내가 만든 변화(생성·머지)는 즉시 목록에 반영돼야 한다 */
function invalidatePrList(): void {
  listCache = null;
  // ⚠️ 캐시만 비우면 부족하다 — 생성·머지 직후의 재조회가 "생성 전에 시작된" in-flight
  // 조회에 합류해 새 PR 없는 목록을 받고, 그 결과가 다시 캐시로 앉아 최대 60초 굳었다
  // (2026-08-31 감사). in-flight 합류를 끊고 세대를 올려 늦은 결과의 캐시 기록도 막는다.
  listInflight = null;
  listGen++;
}

const NO_GITEA = 'Gitea 주소가 설정되지 않았습니다. [환경설정 → 연동]을 확인하세요.';
const NO_TOKEN =
  'PR 생성/머지에는 Gitea 토큰이 필요합니다. [환경설정 → 연동]에 토큰을 저장하세요.';
const BAD_REPO = '저장소 이름이 올바르지 않습니다.';

// handleShared 로 등록한 채널은 폰(MO)에서도 호출되므로 owner/repo 형식을 검증한다
// (API 경로에 그대로 들어가는 값 — '..' 같은 세그먼트로 다른 엔드포인트를 때릴 수 없게)
const isValidRepo = (repo: unknown): repo is string =>
  typeof repo === 'string' && /^[\w.-]+\/[\w.-]+$/.test(repo) && !repo.includes('..');

/** 열린 PR 목록 실조회 — light 면 보강(리뷰 N+1 · 브랜치)을 건너뛴다 */
async function fetchPrList(light: boolean): Promise<PrListResult> {
  const gitea = getGiteaConfig();
  if (!gitea) return { ok: true, configured: false };
  try {
    const prs = await fetchOpenPrs(gitea.url, gitea.token);
    if (light) return { ok: true, configured: true, prs };
    // 승인 수(PR별 요청)와 머지 방향(저장소별 요청)은 서로 독립이라 함께 돌린다
    const [approved, branched] = await Promise.all([
      enrichApprovals(gitea.url, gitea.token, prs),
      enrichBranches(gitea.url, gitea.token, prs),
    ]);
    const dirs = new Map(branched.map((p) => [`${p.repo}#${p.number}`, p]));
    const enriched = approved.map((p) => {
      const d = dirs.get(`${p.repo}#${p.number}`);
      return d ? { ...p, head: d.head, base: d.base, mergeable: d.mergeable } : p;
    });
    return { ok: true, configured: true, prs: enriched };
  } catch (err) {
    return { ok: false, configured: true, error: (err as Error).message };
  }
}

/** PR 대시보드 IPC 핸들러 등록 */
export function registerPrsIpc() {
  // 설정(조직 필터 + 빠른 PR 저장소) 조회/저장
  handleShared('prs:config:get', (): PrsConfig => getPrsConfig());
  handleShared(
    'prs:config:set',
    (config: PrsConfig): PrsConfig => savePrsConfig(config),
  );

  // 열린 PR 목록 조회 (+ 승인 수 보강)
  // light=true 는 목록만 — PR별 리뷰 조회(N+1)·브랜치 보강을 생략해 요청을 1건으로
  // 줄인다(2026-08-07 성능 감사: 카드 하나에 60여 요청). 섹션은 이것을 먼저 그린 뒤
  // 보강본으로 갈아끼운다.
  handleShared(
    'prs:fetch',
    async (opts?: { light?: boolean; force?: boolean }): Promise<PrListResult> => {
      const light = opts?.light === true;
      if (opts?.force === true) {
        invalidatePrList();
      } else {
        // light 요청은 보강된 캐시도 그대로 쓴다 — 더 풍부한 결과라 손해가 없다
        const hit = listCache;
        if (hit && Date.now() - hit.at < LIST_TTL_MS && (hit.full || light)) {
          return hit.result;
        }
        // 같은 조회가 이미 떠 있으면 붙는다 (2단계 로딩과 폴링이 겹칠 때 중복 방지)
        const cur = listInflight;
        if (cur && (cur.full || light)) return cur.p;
      }

      const gen = listGen;
      const p = fetchPrList(light).then((r) => {
        // 성공한 조회만 캐시한다 — 실패를 캐시하면 1분간 에러 화면이 굳는다.
        // 조회 중 무효화(생성·머지)가 지나갔으면 stale 결과라 캐시에 앉히지 않는다.
        if (gen === listGen && r.ok && r.configured)
          listCache = { at: Date.now(), full: !light, result: r };
        return r;
      });
      listInflight = { full: !light, p };
      void p.finally(() => {
        if (listInflight?.p === p) listInflight = null;
      });
      return p;
    },
  );

  // 저장소의 최근 브랜치 목록 (빠른 PR 후보)
  handleShared(
    'prs:branches',
    async (repo: string): Promise<PrBranchesResult> => {
      const gitea = getGiteaConfig();
      if (!gitea) return { ok: false, error: NO_GITEA };
      if (!isValidRepo(repo)) return { ok: false, error: BAD_REPO };
      try {
        return { ok: true, branches: await fetchRecentBranches(gitea.url, gitea.token, repo) };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  // PR 대상(base) 후보 — 기본·보호·관례 주요 브랜치만 (가볍게)
  handleShared(
    'prs:base-branches',
    async (repo: string): Promise<PrBaseBranchesResult> => {
      const gitea = getGiteaConfig();
      if (!gitea) return { ok: false, error: NO_GITEA };
      if (!isValidRepo(repo)) return { ok: false, error: BAD_REPO };
      try {
        const { branches, defaultBranch } = await fetchBaseCandidates(
          gitea.url,
          gitea.token,
          repo,
        );
        return { ok: true, branches, defaultBranch };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  // 전체 브랜치 이름 (base 검색 — 사용자가 [다른 브랜치 찾기]를 눌렀을 때만)
  handleShared(
    'prs:all-branches',
    async (repo: string): Promise<PrAllBranchesResult> => {
      const gitea = getGiteaConfig();
      if (!gitea) return { ok: false, error: NO_GITEA };
      if (!isValidRepo(repo)) return { ok: false, error: BAD_REPO };
      try {
        return { ok: true, names: await fetchAllBranchNames(gitea.url, gitea.token, repo) };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  // base 대비 head 커밋 목록 (PR 제목/본문 자동 생성용)
  handleShared(
    'prs:branch-commits',
    async (repo: string, base: string, head: string): Promise<PrCommitsResult> => {
      const gitea = getGiteaConfig();
      if (!gitea) return { ok: false, error: NO_GITEA };
      if (!isValidRepo(repo)) return { ok: false, error: BAD_REPO };
      try {
        const { commits, files, stats } = await fetchBranchCommits(
          gitea.url,
          gitea.token,
          repo,
          base,
          head,
        );
        return { ok: true, commits, files, stats };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  // PR 생성 (토큰 필수)
  handleShared(
    'prs:create',
    async (input: PrCreateInput): Promise<PrCreateResult> => {
      const gitea = getGiteaConfig();
      if (!gitea) return { ok: false, error: NO_GITEA };
      if (!gitea.token) return { ok: false, error: NO_TOKEN };
      if (!isValidRepo(input?.repo)) return { ok: false, error: BAD_REPO };
      try {
        const { number, url } = await createPr(gitea.url, gitea.token, input);
        invalidatePrList(); // 방금 만든 PR 이 다음 목록 조회에 바로 보이게
        return { ok: true, number, url };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  // 머지 전 상태 확인 (mergeable)
  handleShared(
    'prs:merge-info',
    async (repo: string, number: number): Promise<PrMergeInfoResult> => {
      const gitea = getGiteaConfig();
      if (!gitea) return { ok: false, error: NO_GITEA };
      if (!isValidRepo(repo)) return { ok: false, error: BAD_REPO };
      try {
        const info = await fetchMergeInfo(gitea.url, gitea.token, repo, number);
        return { ok: true, ...info };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  // 저장소 열린 PR 의 충돌 여부만 재확인 (1요청) — 머지 직후 재검사 창에서 짧게 폴링한다.
  // 목록 전체 조회(prs:fetch)는 리뷰 N+1 이 붙어 반복 호출에 맞지 않는다.
  handleShared(
    'prs:mergeables',
    async (repo: string): Promise<PrMergeablesResult> => {
      const gitea = getGiteaConfig();
      if (!gitea) return { ok: false, error: NO_GITEA };
      if (!isValidRepo(repo)) return { ok: false, error: BAD_REPO };
      try {
        const mergeable = await fetchRepoMergeables(gitea.url, gitea.token, repo);
        return { ok: true, mergeable };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  // PR 머지 (토큰 필수)
  handleShared(
    'prs:merge',
    async (
      repo: string,
      number: number,
      method: PrMergeMethod,
    ): Promise<PrMergeResult> => {
      const gitea = getGiteaConfig();
      if (!gitea) return { ok: false, error: NO_GITEA };
      if (!gitea.token) return { ok: false, error: NO_TOKEN };
      if (!isValidRepo(repo)) return { ok: false, error: BAD_REPO };
      try {
        await mergePr(gitea.url, gitea.token, repo, number, method);
        invalidatePrList(); // 머지된 PR 이 목록에 남아 있지 않게
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );
}
