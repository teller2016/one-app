// 젠킨스 REST API — 빌드 트리거 + 상태 추적
// 인증: Basic Auth(ID + API 토큰 또는 비밀번호).
// 비밀번호 인증은 CSRF crumb 이 필요할 수 있어 403 시 crumb 발급 후 재시도한다.
import type {
  DeployStatus,
  DeployBuildDetail,
  DeployCommit,
} from '../../../shared/types';

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    };
    const buildUrl = `${jobUrl(a, jobPath)}/${b.number}/`;
    if (b.building)
      return { state: 'building', buildNumber: b.number, buildUrl };
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
  'number,building,result,timestamp,' +
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
      };
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
