// Gitea PR 조회 — 전역 이슈 검색 API(type=pulls)로 접근 가능한 모든 저장소의
// 열린 PR 을 한 번에 가져오고, PR 별 리뷰 승인 수를 보강한다.
import type {
  PrItem,
  DeployCommit,
  PrBranch,
  PrCreateInput,
  PrMergeMethod,
} from '../../../shared/types';

type GiteaIssue = {
  number?: number;
  title?: string;
  html_url?: string;
  created_at?: string;
  updated_at?: string;
  user?: { login?: string };
  repository?: { full_name?: string };
};

type GiteaReview = {
  state?: string; // APPROVED / REQUEST_CHANGES / COMMENT …
  user?: { login?: string } | null;
  submitted_at?: string;
};

const authHeaders = (token: string | null): Record<string, string> =>
  token ? { Authorization: `token ${token}` } : {};

/** 열린 PR 목록 (최신순, 최대 50개) */
export async function fetchOpenPrs(
  giteaUrl: string,
  token: string | null,
): Promise<PrItem[]> {
  let res: Response;
  try {
    res = await fetch(
      `${giteaUrl}/api/v1/repos/issues/search?type=pulls&state=open&limit=50`,
      { headers: authHeaders(token) },
    );
  } catch {
    throw new Error('Gitea 에 연결할 수 없습니다 — 주소·네트워크(VPN)를 확인하세요.');
  }
  if (res.status === 401 || res.status === 403)
    throw new Error('Gitea 인증 실패 — 환경설정의 Gitea 토큰을 확인하세요.');
  if (!res.ok) throw new Error(`Gitea 응답 오류 (HTTP ${res.status})`);

  const data = (await res.json()) as GiteaIssue[];
  return (Array.isArray(data) ? data : []).flatMap((it) => {
    const repo = it.repository?.full_name;
    if (!repo || it.number == null) return [];
    return [
      {
        repo,
        number: it.number,
        title: it.title ?? '',
        author: it.user?.login ?? '',
        createdAt: it.created_at ? Date.parse(it.created_at) : undefined,
        updatedAt: it.updated_at ? Date.parse(it.updated_at) : undefined,
        url: it.html_url ?? `${giteaUrl}/${repo}/pulls/${it.number}`,
      },
    ];
  });
}

/** PR 별 승인 리뷰어 수 보강 — 리뷰어별 최신 리뷰가 APPROVED 인 수 (실패는 조용히 생략) */
export async function enrichApprovals(
  giteaUrl: string,
  token: string | null,
  prs: PrItem[],
): Promise<PrItem[]> {
  return Promise.all(
    prs.map(async (pr) => {
      try {
        const res = await fetch(
          `${giteaUrl}/api/v1/repos/${pr.repo}/pulls/${pr.number}/reviews`,
          { headers: authHeaders(token) },
        );
        if (!res.ok) return pr;
        const reviews = (await res.json()) as GiteaReview[];
        // 리뷰어별 최신 리뷰 상태만 집계 (봇/무명 리뷰 제외)
        const latest = new Map<string, { state: string; at: number }>();
        for (const rv of Array.isArray(reviews) ? reviews : []) {
          const who = rv.user?.login;
          const state = rv.state ?? '';
          if (!who || state === 'COMMENT') continue;
          const at = rv.submitted_at ? Date.parse(rv.submitted_at) : 0;
          const cur = latest.get(who);
          if (!cur || at >= cur.at) latest.set(who, { state, at });
        }
        const approvals = [...latest.values()].filter(
          (v) => v.state === 'APPROVED',
        ).length;
        return { ...pr, approvals };
      } catch {
        return pr;
      }
    }),
  );
}

// ── 빠른 PR (생성·머지) ──────────────────────────────────────

const BASE_BRANCHES = new Set(['develop', 'master', 'main']);

/** 최근 커밋순 브랜치 목록 (base 브랜치 제외, 상위 8개) — 방금 push 한 브랜치 찾기용 */
export async function fetchRecentBranches(
  giteaUrl: string,
  token: string | null,
  repo: string,
): Promise<PrBranch[]> {
  let res: Response;
  try {
    res = await fetch(`${giteaUrl}/api/v1/repos/${repo}/branches?limit=100`, {
      headers: authHeaders(token),
    });
  } catch {
    throw new Error('Gitea 에 연결할 수 없습니다 — 주소·네트워크(VPN)를 확인하세요.');
  }
  if (res.status === 404) throw new Error(`저장소를 찾을 수 없습니다: ${repo}`);
  if (res.status === 401 || res.status === 403)
    throw new Error('Gitea 인증 실패 — 환경설정의 Gitea 토큰을 확인하세요.');
  if (!res.ok) throw new Error(`Gitea 응답 오류 (HTTP ${res.status})`);

  const data = (await res.json()) as {
    name?: string;
    commit?: { timestamp?: string; message?: string };
  }[];
  return (Array.isArray(data) ? data : [])
    .filter((b) => b.name && !BASE_BRANCHES.has(b.name))
    .map((b) => ({
      name: b.name as string,
      committedAt: b.commit?.timestamp ? Date.parse(b.commit.timestamp) : undefined,
      lastMessage: (b.commit?.message ?? '').split('\n')[0],
    }))
    .sort((a, b) => (b.committedAt ?? 0) - (a.committedAt ?? 0))
    .slice(0, 8);
}

/** base 대비 head 가 가진 커밋 목록 (PR 제목/본문 자동 생성용, 최신순) */
export async function fetchBranchCommits(
  giteaUrl: string,
  token: string | null,
  repo: string,
  base: string,
  head: string,
): Promise<DeployCommit[]> {
  let res: Response;
  try {
    res = await fetch(
      `${giteaUrl}/api/v1/repos/${repo}/compare/${encodeURIComponent(`${base}...${head}`)}`,
      { headers: authHeaders(token) },
    );
  } catch {
    throw new Error('Gitea 에 연결할 수 없습니다.');
  }
  if (!res.ok) throw new Error(`브랜치 비교 실패 (HTTP ${res.status})`);
  const data = (await res.json()) as {
    commits?: {
      sha?: string;
      commit?: { message?: string; author?: { name?: string; date?: string } };
    }[];
  };
  return (data.commits ?? [])
    .map((c) => ({
      id: c.sha ?? '',
      message: (c.commit?.message ?? '').trim(),
      author: c.commit?.author?.name ?? '',
      timestamp: c.commit?.author?.date ? Date.parse(c.commit.author.date) : undefined,
    }))
    .reverse();
}

/** PR 생성 — 성공 시 번호·URL 반환 (토큰 필수) */
export async function createPr(
  giteaUrl: string,
  token: string,
  input: PrCreateInput,
): Promise<{ number: number; url: string }> {
  let res: Response;
  try {
    res = await fetch(`${giteaUrl}/api/v1/repos/${input.repo}/pulls`, {
      method: 'POST',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        head: input.head,
        base: input.base,
        title: input.title,
        body: input.body ?? '',
      }),
    });
  } catch {
    throw new Error('Gitea 에 연결할 수 없습니다.');
  }
  if (res.status === 409)
    throw new Error('이미 같은 브랜치의 열린 PR 이 있거나, 커밋 차이가 없습니다.');
  if (res.status === 401 || res.status === 403)
    throw new Error('Gitea 인증 실패 — 토큰 권한을 확인하세요.');
  if (res.status === 404)
    throw new Error('저장소 또는 브랜치를 찾을 수 없습니다.');
  if (!res.ok) throw new Error(`PR 생성 실패 (HTTP ${res.status})`);

  const data = (await res.json()) as { number?: number; html_url?: string };
  return {
    number: data.number ?? 0,
    url: data.html_url ?? `${giteaUrl}/${input.repo}/pulls/${data.number}`,
  };
}

/** 머지 전 상태 조회 — mergeable(컨플릭트 없음) 여부 */
export async function fetchMergeInfo(
  giteaUrl: string,
  token: string | null,
  repo: string,
  number: number,
): Promise<{ mergeable: boolean; title: string }> {
  let res: Response;
  try {
    res = await fetch(`${giteaUrl}/api/v1/repos/${repo}/pulls/${number}`, {
      headers: authHeaders(token),
    });
  } catch {
    throw new Error('Gitea 에 연결할 수 없습니다.');
  }
  if (res.status === 404) throw new Error('PR 을 찾을 수 없습니다.');
  if (!res.ok) throw new Error(`PR 조회 실패 (HTTP ${res.status})`);
  const data = (await res.json()) as { mergeable?: boolean; title?: string };
  return { mergeable: !!data.mergeable, title: data.title ?? '' };
}

/** PR 머지 (토큰 필수) — method: merge/squash/rebase */
export async function mergePr(
  giteaUrl: string,
  token: string,
  repo: string,
  number: number,
  method: PrMergeMethod,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${giteaUrl}/api/v1/repos/${repo}/pulls/${number}/merge`, {
      method: 'POST',
      headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ Do: method }),
    });
  } catch {
    throw new Error('Gitea 에 연결할 수 없습니다.');
  }
  if (res.ok) return; // 200 = 머지 완료
  if (res.status === 405)
    throw new Error('머지할 수 없는 상태입니다 — 컨플릭트 또는 보호 규칙을 확인하세요.');
  if (res.status === 401 || res.status === 403)
    throw new Error('Gitea 인증 실패 — 토큰에 쓰기 권한이 있는지 확인하세요.');
  if (res.status === 404) throw new Error('PR 을 찾을 수 없습니다.');
  throw new Error(`머지 실패 (HTTP ${res.status})`);
}
