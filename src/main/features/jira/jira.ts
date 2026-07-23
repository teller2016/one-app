// Jira Cloud 내 이슈 조회·상태 전환 — 환경설정의 주소·이메일·API 토큰(Basic Auth)으로 REST v3 호출
import type {
  JiraActionResult,
  JiraIssue,
  JiraListResult,
  JiraTransition,
  JiraTransitionsResult,
} from '../../../shared/types';
import { getJiraApiConfig } from '../settings/store';
// 전역 fetch 를 타임아웃 래퍼로 대체 — 소켓 hang 시 무한 대기 방지
// (검색은 자체 10초 AbortController 를 쓰며, 호출부 signal 이 우선한다)
import { fetchWithTimeout as fetch } from '../../lib/http';

/** Jira REST 응답의 이슈 형태 (필요 필드만) */
interface RawIssue {
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
}

// resolution 만 보면 워크플로우 빈틈에 빠진다:
//  - 다시열림: 닫힐 때 채워진 resolution 이 재오픈 시 안 지워져 'Unresolved' 검색에서 누락
//  - 해결됨: resolution 을 안 채우는 전환이라 Unresolved 로 잡힘 (하단 접힘 그룹에서 처리)
// → 상태 카테고리(완료 아님) 조건을 OR 로 병행해 둘 다 커버한다.
const JQL =
  'assignee = currentUser() AND (resolution = Unresolved OR statusCategory != Done) ORDER BY updated DESC';
const FIELDS = 'summary,status,issuetype,project,parent,priority,updated';

/** 내게 할당된 미해결 이슈 목록 (최신 갱신 순, 최대 50개) */
export async function fetchMyIssues(): Promise<JiraListResult> {
  const cfg = getJiraApiConfig();
  if (!cfg) {
    return {
      ok: false,
      configured: false,
      error: '환경설정 → 연동에서 Jira 주소·이메일·API 토큰을 입력하세요.',
    };
  }

  const auth = Buffer.from(`${cfg.email}:${cfg.token}`).toString('base64');
  const headers = { Authorization: `Basic ${auth}`, Accept: 'application/json' };
  const query = `jql=${encodeURIComponent(JQL)}&maxResults=50&fields=${FIELDS}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    // 신형 검색 엔드포인트 우선, 구형 서버면 기존 search 로 폴백
    let res = await fetch(`${cfg.url}/rest/api/3/search/jql?${query}`, {
      headers,
      signal: controller.signal,
    });
    if (res.status === 404) {
      res = await fetch(`${cfg.url}/rest/api/3/search?${query}`, {
        headers,
        signal: controller.signal,
      });
    }
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        configured: true,
        error: 'Jira 인증 실패 — 이메일과 API 토큰을 확인하세요.',
      };
    }
    if (!res.ok) {
      return {
        ok: false,
        configured: true,
        error: `Jira 응답 오류 (HTTP ${res.status})`,
      };
    }

    const data = (await res.json()) as { issues?: RawIssue[] };
    const issues: JiraIssue[] = (data.issues ?? []).map((it) => {
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
        url: `${cfg.url}/browse/${it.key}`,
      };
    });
    return { ok: true, configured: true, issues };
  } catch (err) {
    const aborted = (err as Error).name === 'AbortError';
    return {
      ok: false,
      configured: true,
      error: aborted
        ? 'Jira 응답이 없습니다 — 네트워크를 확인하세요.'
        : `Jira 에 연결할 수 없습니다 — ${(err as Error).message}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 이슈별 전환 API 요청 준비 (설정 없으면 null) */
function transitionRequest(key: string) {
  const cfg = getJiraApiConfig();
  if (!cfg) return null;
  const auth = Buffer.from(`${cfg.email}:${cfg.token}`).toString('base64');
  return {
    url: `${cfg.url}/rest/api/3/issue/${encodeURIComponent(key)}/transitions`,
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
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
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: `Jira 에 연결할 수 없습니다 — ${(err as Error).message}`,
    };
  }
}
