import { ipcMain } from 'electron';
import {
  fetchOpenPrs,
  enrichApprovals,
  fetchRecentBranches,
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

/** PR 대시보드 IPC 핸들러 등록 */
export function registerPrsIpc() {
  // 설정(조직 필터 + 빠른 PR 저장소) 조회/저장 — 폴러도 이 값을 읽는다
  ipcMain.handle('prs:config:get', (): PrsConfig => getPrsConfig());
  ipcMain.handle(
    'prs:config:set',
    (_e, config: PrsConfig): PrsConfig => savePrsConfig(config),
  );

  // 열린 PR 목록 조회 (+ 승인 수 보강)
  ipcMain.handle('prs:fetch', async (): Promise<PrListResult> => {
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
  ipcMain.handle(
    'prs:branches',
    async (_e, repo: string): Promise<PrBranchesResult> => {
      const gitea = getGiteaConfig();
      if (!gitea) return { ok: false, error: NO_GITEA };
      try {
        return { ok: true, branches: await fetchRecentBranches(gitea.url, gitea.token, repo) };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  // base 대비 head 커밋 목록 (PR 제목/본문 자동 생성용)
  ipcMain.handle(
    'prs:branch-commits',
    async (_e, repo: string, base: string, head: string): Promise<PrCommitsResult> => {
      const gitea = getGiteaConfig();
      if (!gitea) return { ok: false, error: NO_GITEA };
      try {
        return {
          ok: true,
          commits: await fetchBranchCommits(gitea.url, gitea.token, repo, base, head),
        };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  // PR 생성 (토큰 필수)
  ipcMain.handle(
    'prs:create',
    async (_e, input: PrCreateInput): Promise<PrCreateResult> => {
      const gitea = getGiteaConfig();
      if (!gitea) return { ok: false, error: NO_GITEA };
      if (!gitea.token) return { ok: false, error: NO_TOKEN };
      try {
        const { number, url } = await createPr(gitea.url, gitea.token, input);
        return { ok: true, number, url };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  // 머지 전 상태 확인 (mergeable)
  ipcMain.handle(
    'prs:merge-info',
    async (_e, repo: string, number: number): Promise<PrMergeInfoResult> => {
      const gitea = getGiteaConfig();
      if (!gitea) return { ok: false, error: NO_GITEA };
      try {
        const info = await fetchMergeInfo(gitea.url, gitea.token, repo, number);
        return { ok: true, ...info };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  // PR 머지 (토큰 필수)
  ipcMain.handle(
    'prs:merge',
    async (
      _e,
      repo: string,
      number: number,
      method: PrMergeMethod,
    ): Promise<PrMergeResult> => {
      const gitea = getGiteaConfig();
      if (!gitea) return { ok: false, error: NO_GITEA };
      if (!gitea.token) return { ok: false, error: NO_TOKEN };
      try {
        await mergePr(gitea.url, gitea.token, repo, number, method);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );
}
