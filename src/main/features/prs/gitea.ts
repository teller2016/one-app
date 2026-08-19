// Gitea PR 조회 — 전역 이슈 검색 API(type=pulls)로 접근 가능한 모든 저장소의
// 열린 PR 을 한 번에 가져오고, PR 별 리뷰 승인 수를 보강한다.
import type {
  PrItem,
  DeployCommit,
  PrBaseBranch,
  PrBranch,
  PrChangedFile,
  PrCreateInput,
  PrMergeMethod,
} from '../../../shared/types';
import { mainBranchRank } from '../../../shared/types';
// 인증 헤더·연결 실패·인증 실패 문구는 공용 클라이언트가 담당한다 (deploy 기능과 공유)
import { giteaFetch, giteaJson } from '../../lib/gitea';

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

/** 열린 PR 목록 (최신순, 최대 50개) */
export async function fetchOpenPrs(
  giteaUrl: string,
  token: string | null,
): Promise<PrItem[]> {
  const data = await giteaJson<GiteaIssue[]>(
    `${giteaUrl}/api/v1/repos/issues/search?type=pulls&state=open&limit=50`,
    token,
  );
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

/** 저장소별 /pulls 에서 보강하는 표시용 부가 정보 */
type PrDirection = { head?: string; base?: string; mergeable?: boolean };

/**
 * 저장소의 열린 PR 상태를 **1요청**으로 — 머지 방향(head/base)과 mergeable.
 * 실패·형식 이상은 빈 맵으로 조용히 넘긴다(표시용 부가 정보라 목록 자체를 막지 않는다).
 */
async function fetchRepoPrStates(
  giteaUrl: string,
  token: string | null,
  repo: string,
): Promise<Map<number, PrDirection>> {
  const map = new Map<number, PrDirection>();
  try {
    const res = await giteaFetch(
      `${giteaUrl}/api/v1/repos/${repo}/pulls?state=open&limit=${BRANCH_PAGE_SIZE}`,
      token,
      { raw: true },
    );
    if (!res.ok) return map;
    const data = (await res.json()) as {
      number?: number;
      head?: { ref?: string };
      base?: { ref?: string };
      mergeable?: boolean;
    }[];
    for (const p of Array.isArray(data) ? data : []) {
      if (p.number != null)
        map.set(p.number, {
          head: p.head?.ref,
          base: p.base?.ref,
          mergeable: typeof p.mergeable === 'boolean' ? p.mergeable : undefined,
        });
    }
  } catch {
    // 무시 — 브랜치·충돌 표시만 빠진다
  }
  return map;
}

/**
 * 저장소 열린 PR 의 충돌 여부만 (PR 번호 → mergeable) — **1요청**.
 * 머지 직후 Gitea 가 관련 PR 을 다시 충돌 검사하는 동안 `mergeable` 이 false 로 오는데,
 * 목록 전체 조회(리뷰 N+1)를 반복하지 않고 이 채널로 짧게 재확인한다.
 */
export async function fetchRepoMergeables(
  giteaUrl: string,
  token: string | null,
  repo: string,
): Promise<Record<number, boolean>> {
  const out: Record<number, boolean> = {};
  for (const [number, d] of await fetchRepoPrStates(giteaUrl, token, repo))
    if (typeof d.mergeable === 'boolean') out[number] = d.mergeable;
  return out;
}

/**
 * PR 별 머지 방향(head → base)·머지 가능 여부 보강 — 전역 이슈 검색 API 는 브랜치를
 * 주지 않는다(`ref` 는 빈 값). PR 마다 `/pulls/{n}` 을 부르는 대신 **저장소별 PR 목록
 * 1요청**으로 한꺼번에 채운다(저장소 수 ≪ PR 수). 같은 응답에 `mergeable` 이 있어
 * 목록의 충돌 표시도 추가 요청 없이 얻는다. 실패·누락은 조용히 생략 — 표시용 부가 정보다.
 */
export async function enrichBranches(
  giteaUrl: string,
  token: string | null,
  prs: PrItem[],
): Promise<PrItem[]> {
  const repos = [...new Set(prs.map((p) => p.repo))];
  const byRepo = new Map<string, Map<number, PrDirection>>();
  await Promise.all(
    repos.map(async (repo) => {
      const map = await fetchRepoPrStates(giteaUrl, token, repo);
      if (map.size) byRepo.set(repo, map);
    }),
  );
  return prs.map((pr) => {
    const hit = byRepo.get(pr.repo)?.get(pr.number);
    return hit ? { ...pr, ...hit } : pr;
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
        const res = await giteaFetch(
          `${giteaUrl}/api/v1/repos/${pr.repo}/pulls/${pr.number}/reviews`,
          token,
          { raw: true },
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

type GiteaBranch = {
  name?: string;
  protected?: boolean;
  // author 는 Gitea PayloadCommit 의 필드 — 서버 버전에 따라 없을 수 있어 전부 optional 이다
  commit?: {
    timestamp?: string;
    message?: string;
    author?: { name?: string; username?: string };
  };
};

// ⚠️ Gitea 는 페이지당 최대 50개만 준다(limit 을 더 크게 줘도 무시 — 실측).
// 브랜치가 수백 개인 저장소가 있어 전수 페이징은 하지 않는다.
const BRANCH_PAGE_SIZE = 50;

/** base 후보로 존재 여부를 단건 확인할 관례 이름 (프리픽스형 release/*·hotfix/* 는 검색으로 커버) */
const PROBE_NAMES = ['main', 'master', 'develop', 'development', 'staging', 'qa'];

/** 저장소 기본 브랜치 캐시 — 거의 바뀌지 않으므로 프로세스 수명 동안 10분 보관 */
const defaultBranchCache = new Map<string, { value: string; at: number }>();
const DEFAULT_BRANCH_TTL = 600_000;

// base 후보 캐시 — 관례 이름 프로빙은 대부분 404(=낭비)라 모달을 다시 열 때 재사용한다.
// TTL 을 짧게 둬 새 릴리스 브랜치가 곧 반영되게 한다.
type BaseCandidates = { branches: PrBaseBranch[]; defaultBranch?: string };
const baseCandidateCache = new Map<string, { value: BaseCandidates; at: number }>();
const BASE_CANDIDATE_TTL = 60_000;

// 전체 브랜치 이름 캐시 — 모달을 열 때마다 받으므로(검색용 프리페치) 여닫이 반복에 대비한다
const allBranchCache = new Map<string, { value: string[]; at: number }>();

const toPrBranch = (b: GiteaBranch): PrBranch => ({
  name: b.name as string,
  committedAt: b.commit?.timestamp ? Date.parse(b.commit.timestamp) : undefined,
  lastMessage: (b.commit?.message ?? '').split('\n')[0],
  // 누가 밀어 둔 브랜치인지 — head 선택에서 시각만으로는 남의 브랜치를 구분할 수 없다.
  // username(계정) 이 있으면 그쪽을 쓴다(PR 목록의 author 와 같은 값이라 눈에 익다).
  author: b.commit?.author?.username || b.commit?.author?.name || undefined,
});

/** 브랜치 목록 한 페이지 (Gitea 는 커밋 최신순으로 준다) */
async function fetchBranchPage(
  giteaUrl: string,
  token: string | null,
  repo: string,
  page = 1,
): Promise<GiteaBranch[]> {
  const data = await giteaJson<GiteaBranch[]>(
    `${giteaUrl}/api/v1/repos/${repo}/branches?limit=${BRANCH_PAGE_SIZE}&page=${page}`,
    token,
    { errors: { notFound: `저장소를 찾을 수 없습니다: ${repo}` } },
  );
  return Array.isArray(data) ? data : [];
}

/** 저장소가 선언한 기본 브랜치 — 실패는 조용히 undefined (부가 신호일 뿐) */
async function fetchDefaultBranch(
  giteaUrl: string,
  token: string | null,
  repo: string,
): Promise<string | undefined> {
  const hit = defaultBranchCache.get(repo);
  if (hit && Date.now() - hit.at < DEFAULT_BRANCH_TTL) return hit.value;
  try {
    const res = await giteaFetch(`${giteaUrl}/api/v1/repos/${repo}`, token, {
      raw: true,
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { default_branch?: string };
    const value = data.default_branch;
    if (value) defaultBranchCache.set(repo, { value, at: Date.now() });
    return value;
  } catch {
    return undefined;
  }
}

/** 브랜치 단건 존재 확인 — 없으면(404) null */
async function fetchBranch(
  giteaUrl: string,
  token: string | null,
  repo: string,
  name: string,
): Promise<GiteaBranch | null> {
  try {
    const res = await giteaFetch(
      `${giteaUrl}/api/v1/repos/${repo}/branches/${encodeURIComponent(name)}`,
      token,
      { raw: true },
    );
    if (!res.ok) return null;
    return (await res.json()) as GiteaBranch;
  } catch {
    return null;
  }
}

/**
 * 최근 커밋순 브랜치 목록 (상위 8개) — 방금 push 한 브랜치 찾기용.
 * 주요 브랜치(기본·보호·관례 이름)는 head 후보에서 제외한다.
 */
export async function fetchRecentBranches(
  giteaUrl: string,
  token: string | null,
  repo: string,
): Promise<PrBranch[]> {
  const [page, defaultBranch] = await Promise.all([
    fetchBranchPage(giteaUrl, token, repo, 1),
    fetchDefaultBranch(giteaUrl, token, repo),
  ]);
  return page
    .filter(
      (b) =>
        b.name &&
        b.name !== defaultBranch &&
        !b.protected &&
        mainBranchRank(b.name) === null,
    )
    .map(toPrBranch)
    .sort((a, b) => (b.committedAt ?? 0) - (a.committedAt ?? 0))
    .slice(0, 8);
}

/**
 * PR 대상(base) 후보 — 저장소 기본 브랜치 + 보호 브랜치 + 관례 주요 브랜치.
 * 최근 50개 페이지에서 걸러내고, 그 안에 없던 관례 이름·기본 브랜치는 단건 조회로 확인한다
 * (브랜치가 수백 개라 전수 페이징 대신 프로빙 — 보호 설정이 없는 저장소도 main 을 찾는다).
 */
export async function fetchBaseCandidates(
  giteaUrl: string,
  token: string | null,
  repo: string,
): Promise<BaseCandidates> {
  const hit = baseCandidateCache.get(repo);
  if (hit && Date.now() - hit.at < BASE_CANDIDATE_TTL) return hit.value;

  const [page, defaultBranch] = await Promise.all([
    fetchBranchPage(giteaUrl, token, repo, 1),
    fetchDefaultBranch(giteaUrl, token, repo),
  ]);

  const found = new Map<string, PrBaseBranch>();
  const add = (b: GiteaBranch) => {
    if (!b.name || found.has(b.name)) return;
    found.set(b.name, {
      ...toPrBranch(b),
      isDefault: b.name === defaultBranch,
      protected: !!b.protected,
    });
  };
  for (const b of page) {
    if (!b.name) continue;
    const isMain =
      b.name === defaultBranch || b.protected || mainBranchRank(b.name) !== null;
    if (isMain) add(b);
  }

  // 최근 50개에 안 잡힌 관례 이름·기본 브랜치는 단건 조회 (없으면 null → 무시)
  const missing = [...new Set([...(defaultBranch ? [defaultBranch] : []), ...PROBE_NAMES])]
    .filter((n) => !found.has(n));
  const probed = await Promise.all(
    missing.map((n) => fetchBranch(giteaUrl, token, repo, n)),
  );
  for (const b of probed) if (b) add(b);

  const value: BaseCandidates = { branches: [...found.values()], defaultBranch };
  baseCandidateCache.set(repo, { value, at: Date.now() });
  return value;
}

/**
 * 저장소의 전체 브랜치 이름 (base 검색용).
 * ⚠️ `/branches` 는 페이지당 50개라 수백 개면 십수 번 요청해야 한다 —
 * `git/refs/heads` 는 한 번에 전부 준다(커밋 시각은 없고 이름 사전순).
 */
export async function fetchAllBranchNames(
  giteaUrl: string,
  token: string | null,
  repo: string,
): Promise<string[]> {
  const hit = allBranchCache.get(repo);
  if (hit && Date.now() - hit.at < BASE_CANDIDATE_TTL) return hit.value;

  const data = await giteaJson<{ ref?: string }[]>(
    `${giteaUrl}/api/v1/repos/${repo}/git/refs/heads`,
    token,
    {
      label: '브랜치 목록 조회',
      errors: { notFound: `저장소를 찾을 수 없습니다: ${repo}` },
    },
  );
  const names = (Array.isArray(data) ? data : []).flatMap((r) =>
    r.ref?.startsWith('refs/heads/') ? [r.ref.slice('refs/heads/'.length)] : [],
  );
  allBranchCache.set(repo, { value: names, at: Date.now() });
  return names;
}

/**
 * base 대비 head 가 가진 커밋 목록 (PR 제목/본문 자동 생성용).
 *
 * ⚠️ 반환 순서는 **오래된 순**이다 — compare API 응답이 최신순이라 `reverse()` 로 뒤집는다
 * (PR 본문 불릿을 작업 순서대로 읽히게 하려는 것). 예전 주석이 "최신순"이라 적혀 있어
 * `commits[0]` 을 최신 커밋으로 오해하기 쉬웠다.
 *
 * 응답의 `parents` 로 머지 커밋을 표시해 준다(부모 2개 이상) — 브랜치에 `develop` 을
 * 끌어온 머지 커밋이 목록 맨 앞에 오면 그게 PR 제목이 돼 버렸다(실측: PR #1223).
 * 메시지 패턴(`Merge branch …`)으로 추측하면 한국어 머지 메시지를 놓치므로 부모 수로 본다.
 */
export async function fetchBranchCommits(
  giteaUrl: string,
  token: string | null,
  repo: string,
  base: string,
  head: string,
): Promise<{
  commits: DeployCommit[];
  files: PrChangedFile[];
  stats: { additions: number; deletions: number };
}> {
  const data = await giteaJson<{
    commits?: {
      sha?: string;
      commit?: { message?: string; author?: { name?: string; date?: string } };
      parents?: { sha?: string }[];
      files?: { filename?: string; status?: string }[];
      stats?: { additions?: number; deletions?: number };
    }[];
  }>(
    `${giteaUrl}/api/v1/repos/${repo}/compare/${encodeURIComponent(`${base}...${head}`)}`,
    token,
    { label: '브랜치 비교' },
  );
  const raw = data.commits ?? [];

  const commits = raw
    .map((c) => ({
      id: c.sha ?? '',
      message: (c.commit?.message ?? '').trim(),
      author: c.commit?.author?.name ?? '',
      timestamp: c.commit?.author?.date ? Date.parse(c.commit.author.date) : undefined,
      isMerge: (c.parents?.length ?? 0) > 1,
    }))
    .reverse();

  // 변경 파일: 커밋 전체에서 경로 기준 중복 제거 (뒤 커밋 상태가 이김)
  const fileMap = new Map<string, string>();
  const stats = { additions: 0, deletions: 0 };
  for (const c of raw) {
    for (const f of c.files ?? []) {
      if (f.filename) fileMap.set(f.filename, f.status ?? 'modified');
    }
    stats.additions += c.stats?.additions ?? 0;
    stats.deletions += c.stats?.deletions ?? 0;
  }
  const files: PrChangedFile[] = [...fileMap.entries()]
    .map(([path, status]) => ({ path, status }))
    .sort((a, b) => a.path.localeCompare(b.path));

  return { commits, files, stats };
}

/** PR 생성 — 성공 시 번호·URL 반환 (토큰 필수) */
export async function createPr(
  giteaUrl: string,
  token: string,
  input: PrCreateInput,
): Promise<{ number: number; url: string }> {
  const data = await giteaJson<{ number?: number; html_url?: string }>(
    `${giteaUrl}/api/v1/repos/${input.repo}/pulls`,
    token,
    {
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          head: input.head,
          base: input.base,
          title: input.title,
          body: input.body ?? '',
        }),
      },
      label: 'PR 생성',
      errors: {
        auth: 'Gitea 인증 실패 — 토큰 권한을 확인하세요.',
        notFound: '저장소 또는 브랜치를 찾을 수 없습니다.',
        byStatus: {
          409: '이미 같은 브랜치의 열린 PR 이 있거나, 커밋 차이가 없습니다.',
        },
      },
    },
  );
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
): Promise<{ mergeable: boolean; title: string; head?: string; base?: string }> {
  const data = await giteaJson<{
    mergeable?: boolean;
    title?: string;
    head?: { ref?: string };
    base?: { ref?: string };
  }>(`${giteaUrl}/api/v1/repos/${repo}/pulls/${number}`, token, {
    label: 'PR 조회',
    errors: { notFound: 'PR 을 찾을 수 없습니다.' },
  });
  return {
    mergeable: !!data.mergeable,
    title: data.title ?? '',
    head: data.head?.ref,
    base: data.base?.ref,
  };
}

/** PR 머지 (토큰 필수) — method: merge/squash/rebase */
export async function mergePr(
  giteaUrl: string,
  token: string,
  repo: string,
  number: number,
  method: PrMergeMethod,
): Promise<void> {
  // 오류면 giteaFetch 가 던진다 — 여기까지 오면 머지 완료(200)
  await giteaFetch(`${giteaUrl}/api/v1/repos/${repo}/pulls/${number}/merge`, token, {
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Do: method }),
    },
    label: '머지',
    errors: {
      auth: 'Gitea 인증 실패 — 토큰에 쓰기 권한이 있는지 확인하세요.',
      notFound: 'PR 을 찾을 수 없습니다.',
      byStatus: {
        405: '머지할 수 없는 상태입니다 — 컨플릭트 또는 보호 규칙을 확인하세요.',
      },
    },
  });
}
