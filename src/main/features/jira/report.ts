// Jira 티켓 보고 — 프로젝트·기간·레이블로 티켓을 모아 한 번에 복사할 목록을 만든다.
//
// 필터는 두 층이다. **서버(JQL)** 는 프로젝트·기간만 자르고, 상태·담당자·레이블·유형은
// **렌더러가 받은 결과 안에서 걸러낸다**(facet). 그래야 선택지가 실제 결과에 있는 값만 보이고,
// 레이블·담당자 후보를 따로 묻는 API(인스턴스마다 다르다)에 기대지 않는다. 월간 보고 규모
// (수백 건)에서는 한 번 받아 두고 화면에서 거르는 쪽이 빠르기도 하다.
//
// 이 모듈은 One App 본체와 단독 배포판(standalone/lite)이 **같은 파일을 import** 한다 —
// 여기서 electron 외의 데스크톱 전용 의존(파일 경로·터미널 등)을 끌어오지 말 것.
import { ipcMain } from 'electron';
import type {
  JiraLabelsResult,
  JiraProjectOption,
  JiraProjectsResult,
  JiraReportIssue,
  JiraReportPrefs,
  JiraReportQuery,
  JiraReportResult,
} from '../../../shared/types';
import { buildReportJql, normalizeProjectKeys } from '../../../shared/jira-report';
import { fetchWithTimeout as fetch, readJson } from '../../lib/http';
import { jiraAuth, mapIssue, type RawIssue } from './jira';
import { getReportPrefs, saveReportPrefs } from './store';

const TIMEOUT_MS = 15_000;
/** 한 페이지 크기 — Cloud `search/jql` 은 fields 가 많으면 이보다 적게 돌려주기도 한다(토큰으로 이어 받는다) */
const PAGE_SIZE = 100;
/** 전체 상한 — 이보다 많으면 truncated 로 알리고 기간을 좁히게 한다 */
const MAX_ISSUES = 1000;
/** 프로젝트 목록 페이지 크기 — `project/search` 의 최대값 */
const PROJECT_PAGE = 50;
const PROJECTS_TTL_MS = 10 * 60_000;

const FIELDS =
  'summary,status,issuetype,project,parent,priority,updated,created,resolutiondate,assignee,reporter,labels';

/** 보고용으로 더 받는 필드 — 기본 RawIssue 위에 얹는다 */
type RawReportIssue = RawIssue & {
  fields: RawIssue['fields'] & {
    created?: string;
    resolutiondate?: string | null;
    assignee?: { displayName?: string } | null;
    reporter?: { displayName?: string } | null;
    labels?: string[];
  };
};

const NOT_CONFIGURED = '환경설정 → 연동에서 Jira 주소·이메일·API 토큰을 입력하세요.';

/** 상태코드 → 사용자 문구. 400 은 본문의 errorMessages(JQL 오류 위치)를 함께 보여준다 */
async function describeHttpError(res: Response): Promise<string> {
  if (res.status === 401 || res.status === 403) {
    return 'Jira 인증 실패 — 이메일과 API 토큰을 확인하세요.';
  }
  if (res.status === 400) {
    const detail = await res
      .json()
      .then((b: { errorMessages?: string[] }) => (b.errorMessages ?? []).join(' '))
      .catch((): string => '');
    return detail
      ? `Jira 가 조회 조건을 거절했습니다 — ${detail}`
      : 'Jira 가 조회 조건을 거절했습니다 (HTTP 400) — JQL 을 확인하세요.';
  }
  return `Jira 응답 오류 (HTTP ${res.status})`;
}

/** 네트워크 예외 → 사용자 문구 (타임아웃 문장은 fetchWithTimeout 이 이미 만들어 준다) */
function describeConnError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('시간 초과')
    ? `Jira 응답이 없습니다 — ${message}`
    : `Jira 에 연결할 수 없습니다 — ${message}`;
}

/** fetch 의 네트워크 예외를 사람이 읽을 Error 로 바꿔 던진다 */
async function request(url: string, headers: Record<string, string>): Promise<Response> {
  try {
    return await fetch(url, { headers }, TIMEOUT_MS);
  } catch (err) {
    throw new Error(describeConnError(err));
  }
}

/** REST 응답 이슈 → 보고 행. 기본 열은 내 이슈 목록과 같은 mapIssue 로 맞춘다 */
function mapReportIssue(it: RawReportIssue, baseUrl: string): JiraReportIssue {
  const f = it.fields;
  return {
    ...mapIssue(it, baseUrl, false),
    assignee: f.assignee?.displayName ?? null,
    reporter: f.reporter?.displayName ?? null,
    labels: Array.isArray(f.labels) ? f.labels.filter((l) => typeof l === 'string') : [],
    createdAt: f.created ?? '',
    resolvedAt: f.resolutiondate ?? null,
  };
}

/**
 * 구형 `search` 페이징 — startAt/total. 신형 엔드포인트가 404 인 서버(Server/DC 계열)용.
 */
async function searchAllLegacy<T = RawReportIssue>(
  baseUrl: string,
  headers: Record<string, string>,
  jql: string,
  fields: string = FIELDS,
): Promise<{ issues: T[]; truncated: boolean }> {
  const out: T[] = [];
  let startAt = 0;
  for (;;) {
    const params = new URLSearchParams({
      jql,
      startAt: String(startAt),
      maxResults: String(PAGE_SIZE),
      fields,
    });
    const res = await request(`${baseUrl}/rest/api/3/search?${params}`, headers);
    if (!res.ok) throw new Error(await describeHttpError(res));
    const data = await readJson<{ issues?: T[]; total?: number }>(res, 'Jira');
    const page = data.issues ?? [];
    out.push(...page);
    startAt += page.length;
    const total = typeof data.total === 'number' ? data.total : startAt;
    if (page.length === 0 || startAt >= total) return { issues: out, truncated: false };
    if (out.length >= MAX_ISSUES) return { issues: out.slice(0, MAX_ISSUES), truncated: true };
  }
}

/**
 * JQL 로 전부 받기 — 신형 `search/jql`(nextPageToken 페이징) 우선, 404 면 구형으로 폴백.
 * ⚠️ 신형은 `total` 을 주지 않는다 — 끝 판정은 isLast / nextPageToken 부재로만 한다.
 */
async function searchAll<T = RawReportIssue>(
  baseUrl: string,
  headers: Record<string, string>,
  jql: string,
  fields: string = FIELDS,
): Promise<{ issues: T[]; truncated: boolean }> {
  const out: T[] = [];
  let token: string | undefined;
  for (;;) {
    const params = new URLSearchParams({ jql, maxResults: String(PAGE_SIZE), fields });
    if (token) params.set('nextPageToken', token);
    const res = await request(`${baseUrl}/rest/api/3/search/jql?${params}`, headers);
    if (res.status === 404 && out.length === 0) {
      return searchAllLegacy<T>(baseUrl, headers, jql, fields);
    }
    if (!res.ok) throw new Error(await describeHttpError(res));
    const data = await readJson<{
      issues?: T[];
      nextPageToken?: string;
      isLast?: boolean;
    }>(res, 'Jira');
    const page = data.issues ?? [];
    out.push(...page);
    if (!data.nextPageToken || data.isLast === true || page.length === 0) {
      return { issues: out, truncated: false };
    }
    if (out.length >= MAX_ISSUES) return { issues: out.slice(0, MAX_ISSUES), truncated: true };
    token = data.nextPageToken;
  }
}

/** 조회 조건으로 티켓 목록을 받는다 — 결과에는 실제로 보낸 JQL 을 함께 돌려준다 */
export async function searchReport(query: JiraReportQuery): Promise<JiraReportResult> {
  const auth = jiraAuth();
  if (!auth) return { ok: false, configured: false, error: NOT_CONFIGURED };

  let jql: string;
  try {
    jql = buildReportJql(query);
  } catch (err) {
    return { ok: false, configured: true, error: err instanceof Error ? err.message : String(err) };
  }

  try {
    const { issues, truncated } = await searchAll(auth.url, auth.headers, jql);
    return {
      ok: true,
      configured: true,
      jql,
      truncated,
      issues: issues.map((it) => mapReportIssue(it, auth.url)),
    };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      jql,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── 프로젝트 목록 (선택지) ──

let projectsCache: { at: number; list: JiraProjectOption[] } | null = null;

/** 구형 `project`(배열 응답) — `project/search` 가 없는 서버용 */
async function loadProjectsLegacy(
  baseUrl: string,
  headers: Record<string, string>,
): Promise<JiraProjectOption[]> {
  const res = await request(`${baseUrl}/rest/api/3/project`, headers);
  if (!res.ok) throw new Error(await describeHttpError(res));
  const data = await readJson<{ key?: string; name?: string }[]>(res, 'Jira');
  return (Array.isArray(data) ? data : [])
    .filter((p) => typeof p.key === 'string')
    .map((p) => ({ key: p.key as string, name: p.name ?? (p.key as string) }));
}

/** `project/search` 를 끝까지 페이징 — isLast 가 오면 멈춘다 */
async function loadProjects(
  baseUrl: string,
  headers: Record<string, string>,
): Promise<JiraProjectOption[]> {
  const out: JiraProjectOption[] = [];
  let startAt = 0;
  for (;;) {
    const params = new URLSearchParams({
      startAt: String(startAt),
      maxResults: String(PROJECT_PAGE),
      orderBy: 'key',
    });
    const res = await request(`${baseUrl}/rest/api/3/project/search?${params}`, headers);
    if (res.status === 404 && out.length === 0) return loadProjectsLegacy(baseUrl, headers);
    if (!res.ok) throw new Error(await describeHttpError(res));
    const data = await readJson<{
      values?: { key?: string; name?: string }[];
      isLast?: boolean;
      total?: number;
    }>(res, 'Jira');
    const page = data.values ?? [];
    for (const p of page) {
      if (typeof p.key === 'string') out.push({ key: p.key, name: p.name ?? p.key });
    }
    startAt += page.length;
    const done =
      data.isLast === true ||
      page.length === 0 ||
      (typeof data.total === 'number' && startAt >= data.total);
    // 상한은 방어용 — 이보다 많은 프로젝트가 있는 인스턴스라면 선택지로 보여줄 양이 아니다
    if (done || startAt >= 2000) return out;
  }
}

/** 프로젝트 선택지 — 10분 캐시. force 는 새로고침 버튼 */
export async function fetchProjects(force = false): Promise<JiraProjectsResult> {
  const auth = jiraAuth();
  if (!auth) return { ok: false, configured: false, error: NOT_CONFIGURED };
  if (!force && projectsCache && Date.now() - projectsCache.at < PROJECTS_TTL_MS) {
    return { ok: true, configured: true, projects: projectsCache.list };
  }
  try {
    const list = await loadProjects(auth.url, auth.headers);
    projectsCache = { at: Date.now(), list };
    return { ok: true, configured: true, projects: list };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── 레이블 목록 (조회 조건) ──

/** 한 페이지 — `label` 엔드포인트의 최대값 */
const LABEL_PAGE = 1000;
/** 전체 상한 — 이보다 많은 레이블은 선택지로 보여줄 양이 아니다(검색으로 좁히게 한다) */
const LABEL_MAX = 5000;
const LABELS_TTL_MS = 10 * 60_000;

/** 캐시 — 프로젝트 조합별로 따로 담는다(키 없는 '' 는 인스턴스 전체) */
const labelsCache = new Map<string, { at: number; list: string[] }>();

/**
 * 레이블 이름에서 날짜를 읽는다 — `26/09/17_운영배포` → `2026-09-17`, `26/09` → `2026-09-01`.
 * 이 팀의 배포 레이블이 날짜로 시작하므로, **이름만으로 최신순**을 만들 수 있다.
 */
function labelDateKey(label: string): string | null {
  const m = /^(\d{2})\/(\d{2})(?:\/(\d{2}))?/.exec(label);
  if (!m) return null;
  return `20${m[1]}-${m[2]}-${m[3] ?? '01'}`;
}

/**
 * 최신 순 정렬 — **요청받은 순서**(2026-09-04): 이름이 날짜면 그 날짜로, 아니면 그 레이블이 붙은
 * 티켓의 최신 생성일로 내림차순. 둘 다 없으면 이름 역순으로 뒤에 붙인다.
 */
function sortLabelsNewestFirst(labels: string[], latestOf?: Map<string, string>): string[] {
  const keyOf = (l: string) => labelDateKey(l) ?? latestOf?.get(l)?.slice(0, 10) ?? '';
  return [...labels].sort((a, b) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    if (ka !== kb) return ka < kb ? 1 : -1; // 최신 먼저 (빈 키는 맨 뒤)
    return b.localeCompare(a, 'ko', { numeric: true });
  });
}

/**
 * 인스턴스 전체 레이블 — `GET /rest/api/3/label` 을 끝까지 페이징한다(프로젝트 미선택용).
 *
 * ⚠️ **자동완성(`jql/autocompletedata/suggestions`)으로는 안 된다** — 접두 하나에 **15개만**
 *    돌려주고(2026-09-03 실측) 파라미터로 늘릴 수 없다. 화면에서 `09` 처럼 **가운데 토막**으로
 *    찾으려면 목록 전체가 있어야 한다.
 * ⚠️ 이 엔드포인트가 없는 서버(Server/DC 구버전)면 404 다 — 빈 목록으로 돌려주고 화면은
 *    'JQL 직접 입력' 으로 넘어가게 한다(조회 자체를 막지 않는다).
 */
async function loadAllLabels(
  baseUrl: string,
  headers: Record<string, string>,
): Promise<{ list: string[]; truncated: boolean }> {
  const out: string[] = [];
  let startAt = 0;
  for (;;) {
    const params = new URLSearchParams({
      startAt: String(startAt),
      maxResults: String(LABEL_PAGE),
    });
    const res = await request(`${baseUrl}/rest/api/3/label?${params}`, headers);
    if (res.status === 404) return { list: out, truncated: false };
    if (!res.ok) throw new Error(await describeHttpError(res));
    const data = await readJson<{ values?: string[]; isLast?: boolean; total?: number }>(
      res,
      'Jira',
    );
    const page = (data.values ?? [])
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.trim())
      .filter(Boolean);
    out.push(...page);
    startAt += page.length;
    if (out.length >= LABEL_MAX) return { list: [...new Set(out)], truncated: true };
    const done =
      data.isLast === true ||
      page.length === 0 ||
      (typeof data.total === 'number' && startAt >= data.total);
    if (done) return { list: [...new Set(out)], truncated: false };
  }
}

/**
 * **그 프로젝트에서 실제로 쓰는 레이블만** — 이슈를 훑어 모은다(2026-09-04 요청).
 *
 * Jira 의 `label` 엔드포인트는 인스턴스 전역이라 프로젝트로 좁힐 수 없고, `labels` 는
 * 프로젝트 스코프가 있는 필드가 아니다. 그래서 `labels IS NOT EMPTY` 로 이슈를 받아 집계한다 —
 * **필드를 `labels,created` 둘로 줄여** 응답을 가볍게 하고, 덤으로 각 레이블의 **최신 생성일**을
 * 얻어 이름이 날짜가 아닌 레이블도 최신순으로 세울 수 있다.
 */
async function loadProjectLabels(
  baseUrl: string,
  headers: Record<string, string>,
  keys: string[],
): Promise<{ list: string[]; truncated: boolean }> {
  const jql = `project IN (${keys.join(', ')}) AND labels IS NOT EMPTY ORDER BY created DESC`;
  const { issues, truncated } = await searchAll<{
    fields?: { labels?: string[]; created?: string };
  }>(baseUrl, headers, jql, 'labels,created');

  const latest = new Map<string, string>();
  for (const it of issues) {
    const created = it.fields?.created ?? '';
    for (const raw of it.fields?.labels ?? []) {
      const l = typeof raw === 'string' ? raw.trim() : '';
      if (!l) continue;
      const cur = latest.get(l);
      if (cur === undefined || created > cur) latest.set(l, created);
    }
  }
  return { list: sortLabelsNewestFirst([...latest.keys()], latest), truncated };
}

/**
 * 레이블 선택지 — 프로젝트를 고른 상태면 **그 프로젝트가 쓰는 레이블만**, 아니면 인스턴스 전체.
 * 10분 캐시(프로젝트 조합별), force 는 새로고침 버튼. 순서는 최신 우선이라 화면은 그대로 쓴다.
 */
export async function fetchLabels(
  projectKeys: string[] = [],
  force = false,
): Promise<JiraLabelsResult> {
  const auth = jiraAuth();
  if (!auth) return { ok: false, configured: false, error: NOT_CONFIGURED };
  const keys = normalizeProjectKeys(projectKeys);
  const cacheKey = keys.join(',');
  const hit = labelsCache.get(cacheKey);
  if (!force && hit && Date.now() - hit.at < LABELS_TTL_MS) {
    return { ok: true, configured: true, labels: hit.list };
  }
  try {
    const { list, truncated } =
      keys.length > 0
        ? await loadProjectLabels(auth.url, auth.headers, keys)
        : await loadAllLabels(auth.url, auth.headers).then((r) => ({
            list: sortLabelsNewestFirst(r.list),
            truncated: r.truncated,
          }));
    labelsCache.set(cacheKey, { at: Date.now(), list });
    return { ok: true, configured: true, labels: list, truncated };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 보고 IPC 등록 — 본체는 `registerJiraIpc()` 안에서, 단독 배포판은 main.ts 에서 직접 부른다.
 * 폰(MO)에 열 이유가 없어 handleShared 가 아니라 ipcMain.handle 이다.
 */
export function registerJiraReportIpc(): void {
  ipcMain.handle('jira:report:projects', (_e, force?: boolean) => fetchProjects(force === true));
  ipcMain.handle('jira:report:labels', (_e, projectKeys?: string[], force?: boolean) =>
    fetchLabels(Array.isArray(projectKeys) ? projectKeys : [], force === true),
  );
  ipcMain.handle('jira:report:search', (_e, query: JiraReportQuery) => searchReport(query));
  ipcMain.handle('jira:report:prefs:get', () => getReportPrefs());
  ipcMain.handle('jira:report:prefs:set', (_e, prefs: Partial<JiraReportPrefs>) =>
    saveReportPrefs(prefs),
  );
}
