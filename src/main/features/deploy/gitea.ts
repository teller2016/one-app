// Gitea REST API — 배포 미리보기(마지막 빌드 이후 새 커밋)용 비교 조회.
// 젠킨스가 기록한 저장소 URL(내부망 주소일 수 있음)에서 owner/repo 만 추출하고,
// 실제 호출은 환경설정의 Gitea 주소로 한다. 토큰은 선택(비공개 저장소용).
import type { DeployCommit } from '../../../shared/types';
// 전역 fetch 를 타임아웃 래퍼로 대체 — 소켓 hang 시 무한 대기 방지
import { fetchWithTimeout as fetch } from '../../lib/http';

/** 저장소 URL 에서 owner/repo 추출 — 예: http://host:3000/owner/repo.git */
export function parseOwnerRepo(
  repoUrl: string,
): { owner: string; repo: string } | null {
  try {
    const u = new URL(repoUrl);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const owner = parts[parts.length - 2];
    const repo = parts[parts.length - 1].replace(/\.git$/, '');
    return owner && repo ? { owner, repo } : null;
  } catch {
    return null;
  }
}

/** 젠킨스 브랜치 표기 정리 — refs/remotes/origin/develop → develop */
export function normalizeBranch(branch: string): string {
  return branch.replace(/^refs\/remotes\/[^/]+\//, '').replace(/^origin\//, '');
}

type GiteaCompareResponse = {
  total_commits?: number;
  commits?: {
    sha?: string;
    commit?: {
      message?: string;
      author?: { name?: string; date?: string };
    };
  }[];
};

/**
 * base 커밋 이후 branch 에 쌓인 커밋 목록 (Gitea compare API).
 * 반환 순서는 최신이 먼저 오도록 뒤집는다.
 */
export async function fetchCompareCommits(
  giteaUrl: string,
  token: string | null,
  owner: string,
  repo: string,
  baseSha: string,
  branch: string,
): Promise<{ totalCommits: number; commits: DeployCommit[] }> {
  const url = `${giteaUrl}/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
    repo,
  )}/compare/${encodeURIComponent(`${baseSha}...${branch}`)}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: token ? { Authorization: `token ${token}` } : {},
    });
  } catch {
    throw new Error('Gitea 에 연결할 수 없습니다 — 주소·네트워크(VPN)를 확인하세요.');
  }
  if (res.status === 401 || res.status === 403)
    throw new Error('Gitea 인증 실패 — 환경설정의 Gitea 토큰을 확인하세요.');
  if (res.status === 404)
    throw new Error(
      '저장소 또는 기준 커밋을 찾을 수 없습니다 — Gitea 주소·저장소 권한을 확인하세요.',
    );
  if (!res.ok) throw new Error(`Gitea 응답 오류 (HTTP ${res.status})`);

  const data = (await res.json()) as GiteaCompareResponse;
  const commits: DeployCommit[] = (data.commits ?? [])
    .map((c) => ({
      id: c.sha ?? '',
      message: (c.commit?.message ?? '').trim(),
      author: c.commit?.author?.name ?? '',
      timestamp: c.commit?.author?.date
        ? Date.parse(c.commit.author.date)
        : undefined,
    }))
    .reverse(); // 최신 커밋이 먼저
  return { totalCommits: data.total_commits ?? commits.length, commits };
}

/** Gitea 웹 비교 페이지 URL */
export const compareWebUrl = (
  giteaUrl: string,
  owner: string,
  repo: string,
  baseSha: string,
  branch: string,
) => `${giteaUrl}/${owner}/${repo}/compare/${baseSha}...${branch}`;
