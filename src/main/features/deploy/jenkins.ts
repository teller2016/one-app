// 젠킨스 REST API — 빌드 트리거 + 상태 추적
// 인증: Basic Auth(ID + API 토큰 또는 비밀번호).
// 비밀번호 인증은 CSRF crumb 이 필요할 수 있어 403 시 crumb 발급 후 재시도한다.
import type {
  DeployStatus,
  DeployBuildDetail,
  DeployBuildSummary,
  DeployCommit,
  DeployRunningBuild,
} from '../../../shared/types';
// 전역 fetch 를 타임아웃 래퍼로 대체 — 소켓 hang 시 무한 대기 방지
import { fetchWithTimeout as fetch } from '../../lib/http';
import { sleep } from '../../lib/util';

export type JenkinsAuth = {
  baseUrl: string; // 예: https://jenkins.example.com (끝 슬래시 없음)
  username: string;
  secret: string; // API 토큰 또는 비밀번호
};

const authHeader = (a: JenkinsAuth) =>
  'Basic ' + Buffer.from(`${a.username}:${a.secret}`).toString('base64');

/** "폴더/잡" 형태 경로를 {base}/job/폴더/job/잡 URL 로 변환 */
const jobUrl = (a: JenkinsAuth, jobPath: string) =>
  `${a.baseUrl}/job/${jobPath
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/job/')}`;

/** CSRF crumb 발급 (비밀번호 인증 대비). crumb 은 세션에 묶이므로 쿠키도 함께 반환 */
async function fetchCrumbHeaders(
  a: JenkinsAuth,
): Promise<Record<string, string> | null> {
  try {
    const res = await fetch(`${a.baseUrl}/crumbIssuer/api/json`, {
      headers: { Authorization: authHeader(a) },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      crumbRequestField: string;
      crumb: string;
    };
    const headers: Record<string, string> = {
      [data.crumbRequestField]: data.crumb,
    };
    const cookies =
      (
        res.headers as Headers & { getSetCookie?: () => string[] }
      ).getSetCookie?.() ?? [];
    if (cookies.length > 0) {
      headers.Cookie = cookies.map((c) => c.split(';')[0]).join('; ');
    }
    return headers;
  } catch {
    return null;
  }
}

/**
 * 빌드 트리거. 성공 시 큐 아이템 URL 반환 (없으면 빈 문자열 — lastBuild 폴백으로 추적)
 */
export async function triggerBuild(
  a: JenkinsAuth,
  jobPath: string,
): Promise<{ queueUrl: string }> {
  const base = jobUrl(a, jobPath);
  let crumbHeaders: Record<string, string> = {};
  const doPost = (endpoint: 'build' | 'buildWithParameters') =>
    fetch(`${base}/${endpoint}`, {
      method: 'POST',
      headers: { Authorization: authHeader(a), ...crumbHeaders },
    });

  let res: Response;
  try {
    res = await doPost('build');
    // 403 이면 CSRF crumb 필요 → 발급 후 재시도
    if (res.status === 403) {
      const crumb = await fetchCrumbHeaders(a);
      if (crumb) {
        crumbHeaders = crumb;
        res = await doPost('build');
      }
    }
    // 파라미터가 정의된 잡은 /build 를 400 으로 거부
    // → 파라미터 기본값으로 실행되는 buildWithParameters 로 재시도
    if (res.status === 400) {
      res = await doPost('buildWithParameters');
    }
  } catch {
    throw new Error(
      `젠킨스에 연결할 수 없습니다 (${a.baseUrl}) — URL·네트워크(VPN)를 확인하세요.`,
    );
  }

  if (res.status === 201 || res.ok) {
    // Location 헤더가 큐 아이템 URL. 내부 호스트명일 수 있어 baseUrl 기준으로 재조립
    const location = res.headers.get('location') ?? '';
    const m = location.match(/\/queue\/item\/(\d+)/);
    return { queueUrl: m ? `${a.baseUrl}/queue/item/${m[1]}` : '' };
  }
  if (res.status === 401)
    throw new Error('인증 실패 — 아이디/API 토큰(비밀번호)을 확인하세요.');
  if (res.status === 403)
    throw new Error('권한 없음(403) — 계정에 빌드 권한이 있는지 확인하세요.');
  if (res.status === 404)
    throw new Error(`잡을 찾을 수 없습니다: ${jobPath} (잡 이름/경로 확인)`);
  if (res.status === 400)
    throw new Error(
      '빌드 요청 거부(HTTP 400) — 잡의 파라미터 설정(필수 파라미터 여부)을 확인하세요.',
    );
  throw new Error(`젠킨스 응답 오류 (HTTP ${res.status})`);
}

/** 최근 빌드 상태 조회 — 화면 진입 시 표시용 */
export async function fetchLastStatus(
  a: JenkinsAuth,
  jobPath: string,
): Promise<DeployStatus> {
  try {
    const res = await fetch(`${jobUrl(a, jobPath)}/lastBuild/api/json`, {
      headers: { Authorization: authHeader(a) },
    });
    if (res.status === 404) return { state: 'idle' }; // 빌드 이력 없음 or 잡 없음
    if (res.status === 401) return { state: 'error', error: '인증 실패' };
    if (!res.ok) return { state: 'error', error: `HTTP ${res.status}` };
    const b = (await res.json()) as {
      number: number;
      url?: string;
      building: boolean;
      result: string | null;
      timestamp?: number;
      duration?: number;
      estimatedDuration?: number;
    };
    const buildUrl = `${jobUrl(a, jobPath)}/${b.number}/`;
    if (b.building)
      return {
        state: 'building',
        buildNumber: b.number,
        buildUrl,
        startedAt: b.timestamp,
        estimatedMs:
          b.estimatedDuration && b.estimatedDuration > 0
            ? b.estimatedDuration
            : undefined,
      };
    if (!b.result) return { state: 'idle', buildNumber: b.number };
    return {
      state: b.result === 'SUCCESS' ? 'success' : 'failure',
      buildNumber: b.number,
      buildUrl,
      result: b.result,
      finishedAt:
        b.timestamp != null ? b.timestamp + (b.duration ?? 0) : undefined,
    };
  } catch {
    return { state: 'error', error: '젠킨스에 연결할 수 없습니다.' };
  }
}

// 빌드 상세에서 필요한 필드만 받아오기 위한 tree 파라미터
const DETAIL_TREE =
  'number,building,result,timestamp,duration,' +
  'actions[causes[shortDescription,userName],lastBuiltRevision[SHA1,branch[name]],remoteUrls],' +
  'changeSet[items[commitId,msg,comment,timestamp,author[fullName],authorEmail]],' +
  'changeSets[items[commitId,msg,comment,timestamp,author[fullName],authorEmail]]';

type RawChangeItem = {
  commitId?: string;
  msg?: string;
  comment?: string; // 본문 포함 전체 메시지
  timestamp?: number;
  author?: { fullName?: string };
  authorEmail?: string;
};

type RawAction = {
  causes?: { shortDescription?: string; userName?: string }[];
  lastBuiltRevision?: { SHA1?: string; branch?: { name?: string }[] };
  remoteUrls?: string[];
} | null;

/** 빌드 상세 조회 — 커밋 내역(changeSet)·시작자·revision 포함 */
export async function fetchBuildDetail(
  a: JenkinsAuth,
  jobPath: string,
  buildNumber?: number,
): Promise<DeployBuildDetail> {
  const build = buildNumber ?? 'lastBuild';
  let res: Response;
  try {
    res = await fetch(
      `${jobUrl(a, jobPath)}/${build}/api/json?tree=${encodeURIComponent(
        DETAIL_TREE,
      )}`,
      { headers: { Authorization: authHeader(a) } },
    );
  } catch {
    throw new Error('젠킨스에 연결할 수 없습니다.');
  }
  if (res.status === 404) throw new Error('빌드 이력이 없습니다.');
  if (res.status === 401)
    throw new Error('인증 실패 — 아이디/API 토큰을 확인하세요.');
  if (!res.ok) throw new Error(`젠킨스 응답 오류 (HTTP ${res.status})`);

  const b = (await res.json()) as {
    number: number;
    building: boolean;
    result: string | null;
    timestamp?: number;
    duration?: number;
    actions?: RawAction[];
    changeSet?: { items?: RawChangeItem[] }; // freestyle 잡
    changeSets?: { items?: RawChangeItem[] }[]; // pipeline 잡
  };

  const actions = (b.actions ?? []).filter(Boolean) as NonNullable<RawAction>[];
  const cause = actions.find((x) => Array.isArray(x.causes))?.causes?.[0];
  const gitData = actions.find((x) => x.lastBuiltRevision || x.remoteUrls);

  const items: RawChangeItem[] = [
    ...(b.changeSet?.items ?? []),
    ...(b.changeSets ?? []).flatMap((cs) => cs.items ?? []),
  ];
  const commits: DeployCommit[] = items.map((it) => ({
    id: it.commitId ?? '',
    message: (it.comment ?? it.msg ?? '').trim(),
    author: it.author?.fullName ?? it.authorEmail ?? '',
    timestamp: it.timestamp,
  }));

  return {
    number: b.number,
    building: b.building,
    result: b.result,
    timestamp: b.timestamp,
    duration: b.duration,
    startedBy: cause?.userName ?? cause?.shortDescription,
    revision: gitData?.lastBuiltRevision?.SHA1,
    branch: gitData?.lastBuiltRevision?.branch?.[0]?.name,
    repoUrl: gitData?.remoteUrls?.[0],
    commits,
  };
}

/**
 * 트리거 이후 상태 추적: 큐 대기 → 빌드 번호 확정 → 완료(성공/실패)까지 폴링.
 * 단계가 바뀔 때마다 onStatus 로 알린다. (최대 30분)
 */
export async function watchBuild(
  a: JenkinsAuth,
  jobPath: string,
  queueUrl: string,
  onStatus: (s: DeployStatus) => void,
): Promise<void> {
  const headers = { Authorization: authHeader(a) };
  const deadline = Date.now() + 30 * 60 * 1000;

  // 1) 큐 대기 → 빌드 번호 확정
  onStatus({ state: 'queued' });
  let buildNumber: number | null = null;

  while (buildNumber == null) {
    if (Date.now() > deadline) {
      onStatus({ state: 'error', error: '상태 추적 시간 초과(30분)' });
      return;
    }
    await sleep(2000);
    try {
      if (queueUrl) {
        const res = await fetch(`${queueUrl}/api/json`, { headers });
        if (res.ok) {
          const item = (await res.json()) as {
            cancelled?: boolean;
            executable?: { number: number };
          };
          if (item.cancelled) {
            onStatus({ state: 'failure', result: 'CANCELLED' });
            return;
          }
          if (item.executable) buildNumber = item.executable.number;
          continue;
        }
        // 큐 아이템은 빌드 시작 후 일정 시간이 지나면 사라짐(404) → lastBuild 폴백
      }
      const last = await fetch(`${jobUrl(a, jobPath)}/lastBuild/api/json`, {
        headers,
      });
      if (last.ok) {
        const b = (await last.json()) as { number: number; building: boolean };
        if (b.building) buildNumber = b.number;
      }
    } catch {
      // 일시적 통신 오류 — 다음 폴링에서 재시도
    }
  }

  // 2) 빌드 진행 → 완료
  const buildUrl = `${jobUrl(a, jobPath)}/${buildNumber}/`;
  onStatus({ state: 'building', buildNumber, buildUrl });
  let metaPushed = false; // 시작 시각·예상 소요는 첫 폴링에서 한 번만 보강

  for (;;) {
    if (Date.now() > deadline) {
      onStatus({ state: 'error', buildNumber, error: '상태 추적 시간 초과(30분)' });
      return;
    }
    await sleep(3000);
    try {
      const res = await fetch(`${buildUrl}api/json`, { headers });
      if (!res.ok) continue;
      const b = (await res.json()) as {
        building: boolean;
        result: string | null;
        timestamp?: number;
        estimatedDuration?: number;
      };
      if (b.building && !metaPushed && b.timestamp) {
        metaPushed = true;
        onStatus({
          state: 'building',
          buildNumber,
          buildUrl,
          startedAt: b.timestamp,
          estimatedMs:
            b.estimatedDuration && b.estimatedDuration > 0
              ? b.estimatedDuration
              : undefined,
        });
      }
      if (!b.building && b.result) {
        onStatus({
          state: b.result === 'SUCCESS' ? 'success' : 'failure',
          buildNumber,
          buildUrl,
          result: b.result,
          finishedAt: Date.now(),
        });
        return;
      }
    } catch {
      // 재시도
    }
  }
}

// 빌드 이력 목록에서 필요한 필드만 (최근 10개)
const HISTORY_TREE =
  'builds[number,building,result,timestamp,duration,' +
  'actions[causes[shortDescription,userName]]]{0,10}';

/** 최근 빌드 이력 조회 — 번호·결과·시각·소요·시작자 */
export async function fetchBuildHistory(
  a: JenkinsAuth,
  jobPath: string,
): Promise<DeployBuildSummary[]> {
  let res: Response;
  try {
    res = await fetch(
      `${jobUrl(a, jobPath)}/api/json?tree=${encodeURIComponent(HISTORY_TREE)}`,
      { headers: { Authorization: authHeader(a) } },
    );
  } catch {
    throw new Error('젠킨스에 연결할 수 없습니다.');
  }
  if (res.status === 401)
    throw new Error('인증 실패 — 아이디/API 토큰을 확인하세요.');
  if (res.status === 404) throw new Error(`잡을 찾을 수 없습니다: ${jobPath}`);
  if (!res.ok) throw new Error(`젠킨스 응답 오류 (HTTP ${res.status})`);

  const data = (await res.json()) as {
    builds?: {
      number: number;
      building?: boolean;
      result?: string | null;
      timestamp?: number;
      duration?: number;
      actions?: ({ causes?: { shortDescription?: string; userName?: string }[] } | null)[];
    }[];
  };
  return (data.builds ?? []).map((b) => {
    const cause = (b.actions ?? [])
      .filter(Boolean)
      .find((x) => Array.isArray(x?.causes))?.causes?.[0];
    return {
      number: b.number,
      building: !!b.building,
      result: b.result ?? null,
      timestamp: b.timestamp,
      duration: b.duration,
      startedBy: cause?.userName ?? cause?.shortDescription,
    };
  });
}

/**
 * 콘솔 로그 tail 조회 — 마지막 maxBytes 만 가져온다.
 * progressiveText 는 start 가 로그 크기보다 크면 본문 없이 X-Text-Size 헤더만 주므로,
 * 먼저 크기를 알아낸 뒤 끝부분만 다시 요청한다.
 */
export async function fetchConsoleTail(
  a: JenkinsAuth,
  jobPath: string,
  buildNumber: number,
  maxBytes = 64_000,
): Promise<{ text: string; truncated: boolean }> {
  const base = `${jobUrl(a, jobPath)}/${buildNumber}/logText/progressiveText`;
  const headers = { Authorization: authHeader(a) };

  let probe: Response;
  try {
    probe = await fetch(`${base}?start=2000000000`, { headers });
  } catch {
    throw new Error('젠킨스에 연결할 수 없습니다.');
  }
  if (probe.status === 404) throw new Error('해당 빌드의 로그가 없습니다.');
  if (probe.status === 401)
    throw new Error('인증 실패 — 아이디/API 토큰을 확인하세요.');
  if (!probe.ok) throw new Error(`로그 조회 실패 (HTTP ${probe.status})`);

  const size = Number(probe.headers.get('x-text-size') ?? '0');
  const start = Math.max(0, size - maxBytes);

  const res = await fetch(`${base}?start=${start}`, { headers });
  if (!res.ok) throw new Error(`로그 조회 실패 (HTTP ${res.status})`);
  const text = await res.text();
  return { text, truncated: start > 0 };
}

/** 진행 중인 빌드 중지 (젠킨스 /stop) — 비밀번호 인증은 crumb 재시도 */
export async function stopBuild(
  a: JenkinsAuth,
  jobPath: string,
  buildNumber: number,
): Promise<void> {
  const url = `${jobUrl(a, jobPath)}/${buildNumber}/stop`;
  let crumbHeaders: Record<string, string> = {};
  const doPost = () =>
    fetch(url, {
      method: 'POST',
      headers: { Authorization: authHeader(a), ...crumbHeaders },
    });

  let res: Response;
  try {
    res = await doPost();
    if (res.status === 403) {
      const crumb = await fetchCrumbHeaders(a);
      if (crumb) {
        crumbHeaders = crumb;
        res = await doPost();
      }
    }
  } catch {
    throw new Error('젠킨스에 연결할 수 없습니다.');
  }

  // 성공 시 잡 페이지로 302 리다이렉트되는 것이 일반적 (fetch 가 따라가면 res.ok)
  if (res.ok || res.status === 302) return;
  if (res.status === 401)
    throw new Error('인증 실패 — 아이디/API 토큰을 확인하세요.');
  if (res.status === 403)
    throw new Error('권한 없음(403) — 계정에 중지 권한이 있는지 확인하세요.');
  if (res.status === 404) throw new Error('빌드를 찾을 수 없습니다.');
  throw new Error(`중지 요청 실패 (HTTP ${res.status})`);
}

// ── 젠킨스 전체 현황(대기열 + 실행 중) 조회 ──
// 큐/실행자 정보는 잡 단위가 아니라 젠킨스 서버 단위 엔드포인트에서 온다.

/** 저장된 잡 경로("폴더/잡")를 매칭용 키로 정규화 */
export const jobKeyFromPath = (jobPath: string) =>
  jobPath.split('/').filter(Boolean).join('/');

/** 젠킨스가 준 잡/빌드 URL 에서 잡 키("폴더/잡")를 뽑는다 (호스트 무시, /job/ 세그먼트만) */
function jobKeyFromUrl(url: string): string {
  const segs = url.split('/');
  const names: string[] = [];
  for (let i = 0; i < segs.length - 1; i++) {
    if (segs[i] === 'job') names.push(decodeURIComponent(segs[i + 1]));
  }
  return names.join('/');
}

/** 젠킨스가 준 URL 을 우리가 아는 baseUrl 기준으로 재조립 (내부 호스트명 대비) */
function rebaseUrl(a: JenkinsAuth, url?: string): string | undefined {
  if (!url) return undefined;
  try {
    return `${a.baseUrl}${new URL(url).pathname}`;
  } catch {
    return `${a.baseUrl}/${url.replace(/^\/+/, '')}`; // 상대 경로
  }
}

/** 큐 항목 (대상 매칭용 jobKey 포함) */
export type QueueEntry = {
  id: number;
  name: string;
  why?: string;
  since?: number;
  stuck?: boolean;
  jobKey: string;
};

/** 젠킨스 대기열 조회 — 다른 빌드에 밀려 대기 중인 항목 파악 */
export async function fetchQueue(a: JenkinsAuth): Promise<QueueEntry[]> {
  const tree = 'items[id,why,stuck,inQueueSince,task[name,url]]';
  const res = await fetch(
    `${a.baseUrl}/queue/api/json?tree=${encodeURIComponent(tree)}`,
    { headers: { Authorization: authHeader(a) } },
  );
  if (res.status === 401)
    throw new Error('인증 실패 — 아이디/API 토큰을 확인하세요.');
  if (!res.ok) throw new Error(`대기열 조회 실패 (HTTP ${res.status})`);
  const data = (await res.json()) as {
    items?: {
      id: number;
      why?: string | null;
      stuck?: boolean;
      inQueueSince?: number;
      task?: { name?: string; url?: string };
    }[];
  };
  return (data.items ?? []).map((it) => ({
    id: it.id,
    name: it.task?.name ?? '(이름 없음)',
    why: it.why ?? undefined,
    since: it.inQueueSince,
    stuck: it.stuck,
    jobKey: it.task?.url ? jobKeyFromUrl(it.task.url) : '',
  }));
}

/** 지금 실행 중인 빌드 조회 — 노드별 실행자에서 currentExecutable 수집 */
export async function fetchRunningBuilds(
  a: JenkinsAuth,
): Promise<DeployRunningBuild[]> {
  const exec =
    'currentExecutable[number,url,fullDisplayName,timestamp,estimatedDuration]';
  const tree = `computer[displayName,executors[${exec}],oneOffExecutors[${exec}]]`;
  const res = await fetch(
    `${a.baseUrl}/computer/api/json?tree=${encodeURIComponent(tree)}`,
    { headers: { Authorization: authHeader(a) } },
  );
  if (res.status === 401)
    throw new Error('인증 실패 — 아이디/API 토큰을 확인하세요.');
  if (!res.ok) throw new Error(`실행 현황 조회 실패 (HTTP ${res.status})`);

  type RawExec = {
    number?: number;
    url?: string;
    fullDisplayName?: string;
    timestamp?: number;
    estimatedDuration?: number;
  } | null;
  const data = (await res.json()) as {
    computer?: {
      displayName?: string;
      executors?: { currentExecutable?: RawExec }[];
      oneOffExecutors?: { currentExecutable?: RawExec }[];
    }[];
  };

  // 파이프라인 잡은 flyweight(oneOffExecutor)와 노드 실행자에 동시에 잡히므로
  // 빌드 URL(jobKey+번호) 기준으로 중복 제거한다.
  const seen = new Set<string>();
  const out: DeployRunningBuild[] = [];
  for (const c of data.computer ?? []) {
    const slots = [...(c.executors ?? []), ...(c.oneOffExecutors ?? [])];
    for (const slot of slots) {
      const ce = slot.currentExecutable;
      if (!ce) continue;
      const dedupKey = ce.url
        ? jobKeyFromUrl(ce.url) + '#' + (ce.number ?? '')
        : (ce.fullDisplayName ?? '') + '#' + (ce.number ?? '');
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      out.push({
        name: ce.fullDisplayName ?? '(이름 없음)',
        number: ce.number,
        url: rebaseUrl(a, ce.url),
        startedAt: ce.timestamp,
        estimatedMs:
          ce.estimatedDuration && ce.estimatedDuration > 0
            ? ce.estimatedDuration
            : undefined,
        node: c.displayName,
      });
    }
  }
  return out;
}
