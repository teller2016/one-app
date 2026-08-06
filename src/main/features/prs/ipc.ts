import { handleShared } from '../../lib/moIpc';
import {
  fetchOpenPrs,
  enrichApprovals,
  fetchRecentBranches,
  fetchBaseCandidates,
  fetchAllBranchNames,
  fetchBranchCommits,
  createPr,
  fetchMergeInfo,
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
  PrMergeMethod,
  PrMergeResult,
} from '../../../shared/types';

const NO_GITEA = 'Gitea 주소가 설정되지 않았습니다. [환경설정 → 연동]을 확인하세요.';
const NO_TOKEN =
  'PR 생성/머지에는 Gitea 토큰이 필요합니다. [환경설정 → 연동]에 토큰을 저장하세요.';
const BAD_REPO = '저장소 이름이 올바르지 않습니다.';

// handleShared 로 등록한 채널은 폰(MO)에서도 호출되므로 owner/repo 형식을 검증한다
// (API 경로에 그대로 들어가는 값 — '..' 같은 세그먼트로 다른 엔드포인트를 때릴 수 없게)
const isValidRepo = (repo: unknown): repo is string =>
  typeof repo === 'string' && /^[\w.-]+\/[\w.-]+$/.test(repo) && !repo.includes('..');

/** PR 대시보드 IPC 핸들러 등록 */
export function registerPrsIpc() {
  // 설정(조직 필터 + 빠른 PR 저장소) 조회/저장 — 폴러도 이 값을 읽는다
  handleShared('prs:config:get', (): PrsConfig => getPrsConfig());
  handleShared(
    'prs:config:set',
    (config: PrsConfig): PrsConfig => savePrsConfig(config),
  );

  // 열린 PR 목록 조회 (+ 승인 수 보강)
  handleShared('prs:fetch', async (): Promise<PrListResult> => {
    const gitea = getGiteaConfig();
    if (!gitea) return { ok: true, configured: false };
    try {
      const prs = await fetchOpenPrs(gitea.url, gitea.token);
      const enriched = await enrichApprovals(gitea.url, gitea.token, prs);
      return { ok: true, configured: true, prs: enriched };
    } catch (err) {
      return { ok: false, configured: true, error: (err as Error).message };
    }
  });

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
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );
}
