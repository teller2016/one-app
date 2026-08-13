// Jira Cloud 내 이슈 조회·상태 전환 — 환경설정의 주소·이메일·API 토큰(Basic Auth)으로 REST v3 호출
import type {
  JiraActionResult,
  JiraAddedResult,
  JiraAddedTicket,
  JiraComment,
  JiraDetailResult,
  JiraIssue,
  JiraListResult,
  JiraTransition,
  JiraTransitionsResult,
  JiraValidateResult,
} from '../../../shared/types';
import { getJiraApiConfig } from '../settings/store';
import {
  addTicket,
  isAdded,
  listAddedTickets,
  normalizeIssueKey,
  removeTicket,
} from './store';
import { sanitizeHtml } from '../../lib/sanitize';
// 전역 fetch 를 타임아웃 래퍼로 대체 — 소켓 hang 시 무한 대기 방지
// (검색은 자체 10초 AbortController 를 쓰며, 호출부 signal 이 우선한다)
import { fetchWithTimeout as fetch } from '../../lib/http';

/** Jira REST 응답의 이슈 형태 (필요 필드만) */
export interface RawIssue {
  key: string;
  fields: {
    summary?: string;
    status?: {
      name?: string;
      statusCategory?: { key?: string };
    };
    issuetype?: { name?: string };
    project?: { key?: string };
    parent?: { key?: string; fields?: { summary?: string } };
    priority?: { name?: string };
    updated?: string;
  };
  /** `expand=changelog` 로 요청했을 때만 온다 (주간 활동 — activity.ts) */
  changelog?: RawChangelog;
}

/** 변경 이력 한 사람의 한 번 편집 (여러 필드가 items 로 묶여 온다) */
export interface RawHistory {
  id?: string;
  created?: string; // ISO
  // 계정 식별자는 인스턴스에 따라 다르다 — Cloud 는 accountId, Server/DC 는 name/key
  author?: {
    accountId?: string;
    emailAddress?: string;
    displayName?: string;
    name?: string;
    key?: string;
  };
  items?: {
    field?: string;
    fieldId?: string;
    fromString?: string | null;
    toString?: string | null;
  }[];
}

/** 이력 묶음 — 검색 응답에 실려 오면 잘릴 수 있어 total 을 함께 본다 */
export interface RawChangelog {
  startAt?: number;
  maxResults?: number;
  total?: number;
  histories?: RawHistory[];
}

// resolution 만 보면 워크플로우 빈틈에 빠진다:
//  - 다시열림: 닫힐 때 채워진 resolution 이 재오픈 시 안 지워져 'Unresolved' 검색에서 누락
//  - 해결됨: resolution 을 안 채우는 전환이라 Unresolved 로 잡힘 (하단 접힘 그룹에서 처리)
// → 상태 카테고리(완료 아님) 조건을 OR 로 병행해 둘 다 커버한다.
const JQL =
  'assignee = currentUser() AND (resolution = Unresolved OR statusCategory != Done) ORDER BY updated DESC';
const FIELDS = 'summary,status,issuetype,project,parent,priority,updated';

// 목록 캐시 — 사이드바 뱃지·홈 카드·Jira 섹션·Nightwatch 후보가 같은 JQL 을 각자
// 폴링하므로 짧은 TTL 로 실제 네트워크 호출을 공유한다(2026-08-07 성능 감사: 4곳 중복).
// 수동 새로고침·상태 전환 직후는 force 로 우회하고, 실패 응답은 캐시하지 않는다.
const LIST_TTL_MS = 60_000;
// 목록 조회 타임아웃 — 2분 폴링이라 오래 매달릴 이유가 없다(재시도는 http.ts 가 담당)
const JIRA_TIMEOUT_MS = 10_000;
let listCache: { at: number; result: JiraListResult } | null = null;
let listInFlight: Promise<JiraListResult> | null = null;

/** 상태 전환 등 변이 후 캐시 무효화 — 다음 조회가 즉시 최신을 본다 */
function invalidateListCache(): void {
  listCache = null;
}

/** 내게 할당된 미해결 이슈 목록 — TTL 캐시 + 동시 요청 공유 래퍼 */
export async function fetchMyIssues(force = false): Promise<JiraListResult> {
  if (!force && listCache && Date.now() - listCache.at < LIST_TTL_MS) {
    return listCache.result;
  }
  if (listInFlight) return listInFlight;
  listInFlight = fetchMyIssuesRemote()
    .then((result) => {
      if (result.ok) listCache = { at: Date.now(), result };
      return result;
    })
    .finally(() => {
      listInFlight = null;
    });
  return listInFlight;
}

/**
 * Basic 인증 정보 — 환경설정의 주소·이메일·토큰. 미설정이면 null.
 * (Jira 를 부르는 모든 곳이 공유한다 — 헤더 조립을 중복하지 말 것)
 */
export function jiraAuth(): {
  url: string;
  authorization: string;
  headers: Record<string, string>;
} | null {
  const cfg = getJiraApiConfig();
  if (!cfg) return null;
  const authorization = `Basic ${Buffer.from(`${cfg.email}:${cfg.token}`).toString('base64')}`;
  return {
    url: cfg.url,
    authorization,
    headers: { Authorization: authorization, Accept: 'application/json' },
  };
}

/** REST 응답 이슈 → 앱 타입. pinned 는 직접 추가한 티켓 표시 */
export function mapIssue(it: RawIssue, baseUrl: string, pinned: boolean): JiraIssue {
  const catKey = it.fields.status?.statusCategory?.key;
  return {
    key: it.key,
    // project 필드가 없으면 이슈 키 접두(BBJ-123 → BBJ)로 폴백
    projectKey: it.fields.project?.key ?? it.key.split('-')[0],
    summary: it.fields.summary ?? '(제목 없음)',
    status: it.fields.status?.name ?? '—',
    statusCategory:
      catKey === 'done' ? 'done' : catKey === 'indeterminate' ? 'indeterminate' : 'new',
    issueType: it.fields.issuetype?.name ?? '',
    parentKey: it.fields.parent?.key ?? null,
    parentSummary: it.fields.parent?.fields?.summary ?? null,
    priority: it.fields.priority?.name ?? null,
    updatedAt: it.fields.updated ?? '',
    url: `${baseUrl}/browse/${it.key}`,
    ...(pinned ? { pinned: true } : {}),
  };
}

/** 검색 1회 결과 — 다른 결과 타입들과 같은 `{ ok, …, error }` 모양으로 맞춘다 */
export type SearchOutcome = { ok: boolean; issues: RawIssue[]; error?: string };

/**
 * JQL 검색 1회 — 신형 엔드포인트 우선, 구형 서버면 기존 `search` 로 폴백.
 *
 * ⚠️ 자체 AbortController 를 쓰지 않는다 — signal 을 직접 넘기면 `fetchWithTimeout` 의
 * 타임아웃·네트워크 오류 재시도가 통째로 비활성화된다(호출부 signal 이 우선하므로).
 * 회사 VPN 터널이 순간 끊겼을 때 재시도로 흡수되는 것이 이 목록 폴링에 특히 중요하다.
 */
export async function searchJql(
  baseUrl: string,
  headers: Record<string, string>,
  jql: string,
  // 주간 활동(activity.ts)은 이력을 함께 받으려고 expand·개수를 조정한다
  opts: { maxResults?: number; expand?: string } = {},
): Promise<SearchOutcome> {
  const params = new URLSearchParams({
    jql,
    maxResults: String(opts.maxResults ?? 50),
    fields: FIELDS,
  });
  if (opts.expand) params.set('expand', opts.expand);
  const query = params.toString();
  try {
    let res = await fetch(
      `${baseUrl}/rest/api/3/search/jql?${query}`,
      { headers },
      JIRA_TIMEOUT_MS
    );
    if (res.status === 404) {
      res = await fetch(`${baseUrl}/rest/api/3/search?${query}`, { headers }, JIRA_TIMEOUT_MS);
    }
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        issues: [],
        error: 'Jira 인증 실패 — 이메일과 API 토큰을 확인하세요.',
      };
    }
    if (!res.ok) {
      return { ok: false, issues: [], error: `Jira 응답 오류 (HTTP ${res.status})` };
    }
    const data = (await res.json()) as { issues?: RawIssue[] };
    return { ok: true, issues: data.issues ?? [] };
  } catch (err) {
    const message = (err as Error).message;
    return {
      ok: false,
      issues: [],
      // 타임아웃 메시지는 fetchWithTimeout 이 이미 사람이 읽을 문장으로 바꿔 던진다
      error: message.includes('시간 초과')
        ? `Jira 응답이 없습니다 — ${message}`
        : `Jira 에 연결할 수 없습니다 — ${message}`,
    };
  }
}

/** 내게 할당된 미해결 이슈 + 직접 추가한 티켓 — 실제 REST 호출 */
async function fetchMyIssuesRemote(): Promise<JiraListResult> {
  const auth = jiraAuth();
  if (!auth) {
    return {
      ok: false,
      configured: false,
      error: '환경설정 → 연동에서 Jira 주소·이메일·API 토큰을 입력하세요.',
    };
  }

  const { url: baseUrl, headers } = auth;
  const addedKeys = listAddedTickets().map((t) => t.key);

  // ⚠️ 추가 티켓을 기존 JQL 에 `OR key IN (…)` 로 얹지 않는다 — 삭제됐거나 권한이 빠진
  // 키가 하나라도 섞이면 Jira 가 400 으로 **쿼리 전체를 거절**해 내 담당 목록까지 사라진다.
  // 따로 부르면 추가분만 실패하고 본 목록은 살아남는다(실패는 addedError 로 알린다).
  const [mine, extra] = await Promise.all([
    searchJql(baseUrl, headers, JQL),
    addedKeys.length > 0
      ? searchJql(baseUrl, headers, `key IN (${addedKeys.join(',')}) ORDER BY updated DESC`)
      : Promise.resolve<SearchOutcome>({ ok: true, issues: [] }),
  ]);

  if (!mine.ok) return { ok: false, configured: true, error: mine.error };

  // 담당·추가에 모두 있으면 하나로 합치고 핀만 붙인다(핀은 전부 한 그룹에 모인다)
  const byKey = new Map<string, JiraIssue>();
  for (const it of mine.issues) byKey.set(it.key, mapIssue(it, baseUrl, false));
  if (extra.ok) {
    for (const it of extra.issues) {
      const cur = byKey.get(it.key);
      byKey.set(it.key, cur ? { ...cur, pinned: true } : mapIssue(it, baseUrl, true));
    }
  }
  const issues = [...byKey.values()].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt)
  );
  return {
    ok: true,
    configured: true,
    issues,
    addedError: extra.ok ? undefined : extra.error,
  };
}

// ── 직접 추가한 티켓 관리 (store 위임 + 목록 캐시 무효화) ──

/** 추가 전 확인 — 주소·키에서 이슈를 찾아 무엇을 추가하는지 보여준다 */
export async function validateAddedTicket(input: string): Promise<JiraValidateResult> {
  const key = normalizeIssueKey(input);
  if (!key) {
    return { ok: false, error: 'Jira 주소나 티켓 번호(예: BBJ-1234)를 넣어주세요.' };
  }
  const auth = jiraAuth();
  if (!auth) return { ok: false, error: 'Jira 연동이 설정되지 않았습니다.' };
  try {
    const res = await fetch(
      `${auth.url}/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,issuetype,status,reporter`,
      { headers: auth.headers },
      JIRA_TIMEOUT_MS,
    );
    if (res.status === 404) {
      return { ok: false, error: `${key} 를 찾을 수 없습니다 — 키 또는 권한을 확인하세요.` };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: 'Jira 인증 실패 — 이메일과 API 토큰을 확인하세요.' };
    }
    if (!res.ok) return { ok: false, error: `Jira 응답 오류 (HTTP ${res.status})` };
    const data = (await res.json()) as RawIssue & {
      fields: { reporter?: { displayName?: string } };
    };
    return {
      ok: true,
      key,
      summary: data.fields.summary ?? '(제목 없음)',
      issueType: data.fields.issuetype?.name ?? '',
      status: data.fields.status?.name ?? '',
      reporter: data.fields.reporter?.displayName ?? '',
      already: isAdded(key),
    };
  } catch (err) {
    return { ok: false, error: `Jira 에 연결할 수 없습니다 — ${(err as Error).message}` };
  }
}

/** 목록에 추가 — 캐시를 비워 다음 조회가 즉시 반영되게 한다 */
export function addTicketToList(input: string): JiraAddedResult {
  const key = normalizeIssueKey(input);
  if (!key) return { ok: false, error: '티켓 번호를 알아볼 수 없습니다.' };
  const added = addTicket(key);
  invalidateListCache();
  return { ok: true, added };
}

export function removeTicketFromList(key: string): JiraAddedResult {
  const normalized = normalizeIssueKey(key);
  if (!normalized) return { ok: false, error: '티켓 번호를 알아볼 수 없습니다.' };
  const added = removeTicket(normalized);
  invalidateListCache();
  return { ok: true, added };
}

export function listAdded(): JiraAddedTicket[] {
  return listAddedTickets();
}

// ── 이슈 상세 (본문·댓글 — 앱 내 패널 표시용) ──

const DETAIL_FIELDS =
  'summary,status,issuetype,priority,reporter,assignee,created,updated,description,comment';

/** 상세 응답 형태 — renderedFields 는 Jira 가 HTML/표시 문자열로 렌더한 값 */
interface RawDetail {
  key?: string;
  fields: {
    summary?: string;
    status?: { name?: string; statusCategory?: { key?: string } };
    issuetype?: { name?: string };
    priority?: { name?: string };
    reporter?: { displayName?: string };
    assignee?: { displayName?: string };
    created?: string;
    updated?: string;
    comment?: { comments?: { id?: string; author?: { displayName?: string } }[] };
  };
  renderedFields?: {
    description?: string;
    created?: string;
    updated?: string;
    comment?: { comments?: { id?: string; created?: string; body?: string }[] };
  };
}

/**
 * 본문 HTML 속 같은 호스트 이미지(첨부·이모티콘)를 data URI 로 인라인.
 * Jira 첨부는 인증이 필요해 렌더러의 sandbox iframe 에선 직접 못 불러온다 —
 * main 에서 Basic Auth 로 받아 심는다. 실패한 이미지는 원본 src 유지(안 보일 뿐).
 */
async function inlineJiraImages(
  htmls: string[],
  baseUrl: string,
  authHeader: string,
): Promise<string[]> {
  const MAX_IMAGES = 12; // 과도한 본문(대량 스크린샷) 방어
  const MAX_BYTES = 4 * 1024 * 1024;
  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return htmls;
  }

  const srcRe = /<img\b[^>]*?\ssrc=["']([^"']+)["']/gi;
  const srcs = new Set<string>();
  for (const html of htmls) {
    let m: RegExpExecArray | null;
    while ((m = srcRe.exec(html)) !== null) srcs.add(m[1]);
  }
  const targets = [...srcs]
    .filter((src) => {
      if (src.startsWith('data:')) return false;
      try {
        return new URL(src, origin).origin === origin; // 외부 이미지는 그대로 둔다
      } catch {
        return false;
      }
    })
    .slice(0, MAX_IMAGES);
  if (targets.length === 0) return htmls;

  const inlined = new Map<string, string>();
  await Promise.all(
    targets.map(async (src) => {
      try {
        const res = await fetch(new URL(src, origin).toString(), {
          headers: { Authorization: authHeader },
        });
        if (!res.ok) return;
        const type = res.headers.get('content-type') ?? '';
        if (!type.startsWith('image/')) return;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.byteLength > MAX_BYTES) return;
        inlined.set(src, `data:${type};base64,${buf.toString('base64')}`);
      } catch {
        /* 실패한 이미지는 원본 유지 */
      }
    }),
  );
  if (inlined.size === 0) return htmls;

  return htmls.map((html) => {
    for (const [src, data] of inlined) html = html.split(src).join(data);
    return html;
  });
}

/** 이슈 상세 조회 — 본문·댓글을 Jira 가 렌더한 HTML(expand=renderedFields)로 받는다 */
export async function fetchIssueDetail(key: string): Promise<JiraDetailResult> {
  const auth = jiraAuth();
  if (!auth) {
    return {
      ok: false,
      error: '환경설정 → 연동에서 Jira 주소·이메일·API 토큰을 입력하세요.',
    };
  }
  const { url: baseUrl, authorization: authHeader } = auth;
  try {
    const res = await fetch(
      `${baseUrl}/rest/api/3/issue/${encodeURIComponent(key)}?fields=${DETAIL_FIELDS}&expand=renderedFields`,
      { headers: auth.headers },
    );
    if (res.status === 401 || res.status === 403) {
      return { ok: false, error: 'Jira 인증 실패 — 이메일과 API 토큰을 확인하세요.' };
    }
    if (res.status === 404) {
      return { ok: false, error: '이슈를 찾을 수 없습니다 — 키 또는 권한을 확인하세요.' };
    }
    if (!res.ok) {
      return { ok: false, error: `Jira 응답 오류 (HTTP ${res.status})` };
    }
    const data = (await res.json()) as RawDetail;
    const rendered = data.renderedFields ?? {};

    // 댓글: 작성자는 fields, 렌더된 본문·시각은 renderedFields — id 로 짝을 맞춘다 (없으면 순서)
    const metaComments = data.fields.comment?.comments ?? [];
    const renderedComments = rendered.comment?.comments ?? [];
    const comments: JiraComment[] = renderedComments.map((rc, i) => {
      const meta =
        (rc.id && metaComments.find((mc) => mc.id === rc.id)) || metaComments[i];
      return {
        author: meta?.author?.displayName ?? '(알 수 없음)',
        created: rc.created ?? '',
        html: sanitizeHtml(rc.body ?? ''),
      };
    });

    const [descriptionHtml, ...commentHtmls] = await inlineJiraImages(
      [sanitizeHtml(rendered.description ?? ''), ...comments.map((c) => c.html)],
      baseUrl,
      authHeader,
    );

    const catKey = data.fields.status?.statusCategory?.key;
    const issueKey = data.key ?? key;
    return {
      ok: true,
      detail: {
        key: issueKey,
        summary: data.fields.summary ?? '(제목 없음)',
        status: data.fields.status?.name ?? '—',
        statusCategory:
          catKey === 'done' ? 'done' : catKey === 'indeterminate' ? 'indeterminate' : 'new',
        issueType: data.fields.issuetype?.name ?? '',
        priority: data.fields.priority?.name ?? null,
        reporter: data.fields.reporter?.displayName ?? null,
        assignee: data.fields.assignee?.displayName ?? null,
        created: rendered.created ?? data.fields.created ?? '',
        updated: rendered.updated ?? data.fields.updated ?? '',
        descriptionHtml,
        comments: comments.map((c, i) => ({ ...c, html: commentHtmls[i] })),
        url: `${baseUrl}/browse/${issueKey}`,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: `Jira 에 연결할 수 없습니다 — ${(err as Error).message}`,
    };
  }
}

/** 이슈별 전환 API 요청 준비 (설정 없으면 null) */
function transitionRequest(key: string) {
  const auth = jiraAuth();
  if (!auth) return null;
  return {
    url: `${auth.url}/rest/api/3/issue/${encodeURIComponent(key)}/transitions`,
    headers: { ...auth.headers, 'Content-Type': 'application/json' },
  };
}

/** 이 이슈에서 지금 실행 가능한 상태 전환 목록 (프로젝트·워크플로우별로 다름) */
export async function getTransitions(key: string): Promise<JiraTransitionsResult> {
  const req = transitionRequest(key);
  if (!req) return { ok: false, error: 'Jira 연동이 설정되지 않았습니다.' };
  try {
    const res = await fetch(req.url, { headers: req.headers });
    if (!res.ok) {
      return { ok: false, error: `전환 목록 조회 실패 (HTTP ${res.status})` };
    }
    const data = (await res.json()) as {
      transitions?: { id: string; name?: string; to?: { name?: string } }[];
    };
    const transitions: JiraTransition[] = (data.transitions ?? []).map((t) => ({
      id: t.id,
      // 사용자에게 의미 있는 건 목적지 상태 이름 (없으면 전환 이름)
      name: t.to?.name ?? t.name ?? t.id,
    }));
    return { ok: true, transitions };
  } catch (err) {
    return {
      ok: false,
      error: `Jira 에 연결할 수 없습니다 — ${(err as Error).message}`,
    };
  }
}

/**
 * 이슈를 '해결됨' 계열 상태로 전환 — 가능한 전환 중 해결/완료 이름을 자동 선택.
 * (PR 머지 직후 원클릭 해결 처리용 — 워크플로우별 상태 차이는 이름 휴리스틱으로 흡수)
 */
export async function resolveIssue(key: string): Promise<JiraActionResult> {
  const list = await getTransitions(key);
  if (!list.ok || !list.transitions) {
    return { ok: false, error: list.error ?? '전환 목록을 불러오지 못했습니다.' };
  }
  const target = list.transitions.find((t) =>
    /해결|완료|resolve|done/i.test(t.name),
  );
  if (!target) {
    const names = list.transitions.map((t) => t.name).join(', ');
    return {
      ok: false,
      error: `해결 전환을 찾을 수 없습니다 (가능: ${names || '없음'})`,
    };
  }
  return transitionIssue(key, target.id);
}

/** 상태 전환 실행 */
export async function transitionIssue(
  key: string,
  transitionId: string,
): Promise<JiraActionResult> {
  const req = transitionRequest(key);
  if (!req) return { ok: false, error: 'Jira 연동이 설정되지 않았습니다.' };
  try {
    const res = await fetch(req.url, {
      method: 'POST',
      headers: req.headers,
      body: JSON.stringify({ transition: { id: transitionId } }),
    });
    if (!res.ok) {
      return { ok: false, error: `전환 실패 (HTTP ${res.status})` };
    }
    invalidateListCache(); // 상태가 바뀌었으니 캐시된 목록은 낡았다
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: `Jira 에 연결할 수 없습니다 — ${(err as Error).message}`,
    };
  }
}
