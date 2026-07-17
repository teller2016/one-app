// Jira Cloud 내 이슈 조회 — 환경설정의 주소·이메일·API 토큰(Basic Auth)으로 REST v3 호출
import type { JiraIssue, JiraListResult } from '../../../shared/types';
import { getJiraApiConfig } from '../settings/store';

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
    parent?: { key?: string };
    priority?: { name?: string };
    updated?: string;
  };
}

const JQL =
  'assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC';
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
