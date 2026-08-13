// Jira 주간 활동 — "그 기간에 내가 작업한 티켓"을 기간 조건으로 모아 관여도까지 판정한다.
//
// Jira 에는 '내가 작업했다'를 직접 주는 필드가 없어서 세 갈래로 나눠 묻고 병합한다.
// ⚠️ 하나의 JQL 로 OR 합치지 않는다 — 인스턴스가 한 조건(예: WAS … DURING)을 거절하면
// 400 으로 **쿼리 전체가 죽어** 목록이 통째로 사라진다. 따로 부르면 실패한 갈래만
// 경고로 알리고 나머지는 그대로 보여줄 수 있다(직접 추가 티켓에서 겪은 것과 같은 함정).
import type {
  JiraActivityEvent,
  JiraActivityIssue,
  JiraActivityResult,
  JiraActivitySource,
  JiraEngagement,
} from '../../../shared/types';
import { isDoneStatus } from '../../../shared/types';
import { fetchWithTimeout as fetch } from '../../lib/http';
import {
  jiraAuth,
  mapIssue,
  searchJql,
  type RawChangelog,
  type RawHistory,
  type RawIssue,
} from './jira';

const TIMEOUT_MS = 15_000;
/** 갈래별 조회 상한 — 한 주에 이보다 많이 손댔다면 이미 목록으로 볼 양이 아니다 */
const MAX_RESULTS = 100;
/** 이력을 조회할 티켓 상한 — 초과분은 검색 갈래로 관여도를 추정한다(historyMissing) */
const HISTORY_LIMIT = 40;
/** 이력 개별 조회 동시 실행 수 (Jira rate limit 배려) */
const HISTORY_CONCURRENCY = 4;
/** 이력 한 페이지 크기 — 이 API 는 오래된 순이라 total 을 보고 마지막 페이지를 받는다 */
const HISTORY_PAGE = 100;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 주 단위 캐시 — 주 이동(◀▶)으로 왕복할 때 매번 4~40 요청을 다시 내지 않는다.
const CACHE_MAX = 8;
const TTL_CURRENT_MS = 60_000; // 진행 중인 주 — 방금 바꾼 상태가 곧 반영되게
const TTL_PAST_MS = 10 * 60_000; // 이미 끝난 주 — 거의 변하지 않는다
const cache = new Map<string, { at: number; result: JiraActivityResult }>();
const inFlight = new Map<string, Promise<JiraActivityResult>>();

// ── 날짜 다루기 ──

/** 기간의 로컬 타임존 경계(ms) — changelog 시각을 걸러낼 때 쓴다 */
function localBounds(start: string, end: string): { from: number; to: number } {
  const [ys, ms, ds] = start.split('-').map(Number);
  const [ye, me, de] = end.split('-').map(Number);
  return {
    from: new Date(ys, ms - 1, ds, 0, 0, 0, 0).getTime(),
    to: new Date(ye, me - 1, de, 23, 59, 59, 999).getTime(),
  };
}

// ── 내 계정 식별 (이력의 작성자가 나인지 판정하려면 필요) ──

type Myself = {
  accountId?: string;
  emailAddress?: string;
  displayName?: string;
  name?: string;
  key?: string;
};

const MYSELF_TTL_MS = 30 * 60_000;
let myselfCache: { at: number; me: Myself } | null = null;

/** 내 계정 정보 — 이력 작성자 대조용. 실패하면 null(그때는 이력 판정을 건너뛴다) */
async function fetchMyself(
  baseUrl: string,
  headers: Record<string, string>,
): Promise<Myself | null> {
  if (myselfCache && Date.now() - myselfCache.at < MYSELF_TTL_MS) {
    return myselfCache.me;
  }
  try {
    const res = await fetch(`${baseUrl}/rest/api/3/myself`, { headers }, TIMEOUT_MS);
    if (!res.ok) return null;
    const me = (await res.json()) as Myself;
    myselfCache = { at: Date.now(), me };
    return me;
  } catch {
    return null;
  }
}

/**
 * 이력 작성자가 나인지.
 * ⚠️ 식별자는 인스턴스마다 다르다 — Cloud 는 `accountId`, Server/DC 는 `name`/`key`.
 * 양쪽에 accountId 가 있으면 그것만 믿고, 없을 때만 이메일·계정명·표시명으로 내려간다
 * (표시명은 동명이인 위험이 있어 마지막 수단).
 */
function isMine(author: RawHistory['author'], me: Myself): boolean {
  if (!author) return false;
  if (me.accountId && author.accountId) return author.accountId === me.accountId;
  if (me.emailAddress && author.emailAddress) {
    return author.emailAddress.toLowerCase() === me.emailAddress.toLowerCase();
  }
  if (me.name && author.name) return author.name === me.name;
  if (me.key && author.key) return author.key === me.key;
  return Boolean(me.displayName) && author.displayName === me.displayName;
}

// ── 이력 → 내 변경 목록 ──

/** 변경 필드 표시명 — Jira 는 로케일에 따라 영문 필드명을 주므로 한국어로 바꿔 보여준다 */
const FIELD_LABEL: Record<string, string> = {
  status: '상태',
  assignee: '담당자',
  resolution: '해결',
  priority: '우선순위',
  summary: '제목',
  description: '설명',
  labels: '라벨',
  duedate: '완료일',
  timeestimate: '예상 시간',
  timespent: '작업 시간',
  attachment: '첨부',
  issuetype: '유형',
  parent: '상위 항목',
  sprint: '스프린트',
  link: '연결',
  worklogid: '작업 기록',
  fixversions: '수정 버전',
  components: '컴포넌트',
};

/** 판정용 내부 표현 — 외부 타입(JiraActivityEvent)에는 fieldId 를 싣지 않는다 */
type MyChange = {
  at: string;
  fieldId: string; // 소문자 정규화 (status·assignee …)
  label: string;
  from: string | null;
  to: string | null;
};

/** 이력 묶음에서 **기간 안의 내 변경만** 시간순으로 뽑아낸다 */
function myChanges(
  histories: RawHistory[],
  me: Myself,
  bounds: { from: number; to: number },
): MyChange[] {
  const out: MyChange[] = [];
  for (const h of histories) {
    if (!h.created || !isMine(h.author, me)) continue;
    const ts = new Date(h.created).getTime();
    if (!Number.isFinite(ts) || ts < bounds.from || ts > bounds.to) continue;
    for (const item of h.items ?? []) {
      const raw = (item.fieldId ?? item.field ?? '').toString();
      const fieldId = raw.toLowerCase().replace(/\s+/g, '');
      out.push({
        at: h.created,
        fieldId,
        label: FIELD_LABEL[fieldId] ?? item.field ?? raw,
        from: item.fromString ?? null,
        to: item.toString ?? null,
      });
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * 관여도 판정.
 *
 * ⚠️ **이력을 받았으면 이력만 믿는다**(`changes !== null`) — 검색 갈래로 보정하지 않는다.
 * 예전에 "status 갈래에서 왔으니 전환은 했을 것"이라고 폴백했더니, 경계에 걸쳐 새어 들어온
 * 티켓(다음 주 월요일에 내가 닫은 것)이 지난주 목록에서 '해결'로 찍혔다(2026-08-13 실측).
 * 이력이 없을 때만 검색 갈래로 추정한다.
 */
function classify(
  changes: MyChange[] | null,
  sources: JiraActivitySource[],
  currentDone: boolean,
): JiraEngagement {
  if (changes) {
    const statusChanges = changes.filter((c) => c.fieldId === 'status');
    const resolvedNow =
      statusChanges.some((c) => c.to !== null && isDoneStatus(c.to)) ||
      // resolution 이 채워지는 전환은 상태 이름이 안 바뀌는 워크플로우도 있다
      changes.some((c) => c.fieldId === 'resolution' && Boolean(c.to));
    if (resolvedNow) return 'resolved';
    return statusChanges.length > 0 ? 'progressed' : 'touched';
  }
  // 이력 없음 — 상태를 바꿨다는 사실만 확실하니 현재 상태로 완료 여부를 추정한다
  if (sources.includes('status')) return currentDone ? 'resolved' : 'progressed';
  return 'touched';
}

// ── 조회 ──

type Branch = { source: JiraActivitySource; label: string; jql: string };

/**
 * 세 갈래 JQL.
 *
 * ⚠️ 날짜는 쿼리 문자열에 그대로 들어간다 — 호출부가 `DATE_RE` 로 검증한 값만 넘긴다.
 * ⚠️ **시각(`00:00`·`23:59`)을 반드시 붙인다** — 날짜만 주면 Jira 가 `DURING` 의 끝 경계를
 * 그 날 **끝까지**로 해석해 다음 주 월요일 활동이 지난주 결과로 새어 들어온다
 * (2026-08-13 실측: 월요일에 닫은 티켓이 지난주 목록에 '해결'로 찍혔다).
 */
function branches(start: string, end: string): Branch[] {
  const from = `${start} 00:00`;
  const to = `${end} 23:59`;
  const order = 'ORDER BY updated DESC';
  return [
    {
      source: 'assignee',
      label: '담당 이력',
      // 그 기간에 내 담당이었고, 그 기간에 실제로 움직인 티켓
      jql:
        `assignee WAS currentUser() DURING ("${from}", "${to}")` +
        ` AND updated >= "${from}" AND updated <= "${to}" ${order}`,
    },
    {
      source: 'status',
      label: '상태 변경',
      jql: `status CHANGED BY currentUser() DURING ("${from}", "${to}") ${order}`,
    },
    {
      source: 'worklog',
      label: '작업 시간',
      // worklogDate 는 날짜 단위 필드라 시각을 붙이지 않고 종료일 포함 비교를 쓴다
      jql:
        `worklogAuthor = currentUser()` +
        ` AND worklogDate >= "${start}" AND worklogDate <= "${end}" ${order}`,
    },
  ];
}

/** 이력 묶음에 기간 안 항목이 하나라도 있는지 (페이지를 더 받을지 판단) */
function coversRange(
  histories: RawHistory[],
  bounds: { from: number; to: number },
): boolean {
  return histories.some((h) => {
    const ts = h.created ? new Date(h.created).getTime() : NaN;
    return Number.isFinite(ts) && ts >= bounds.from && ts <= bounds.to;
  });
}

/**
 * 한 이슈의 이력 — 개별 조회(검색 응답에 이력이 없거나 잘렸을 때).
 *
 * ⚠️ **정렬 방향을 가정하지 않는다** — 검색 `expand=changelog` 는 최신순으로 오는데
 * 이 엔드포인트는 오래된 순이다(2026-08-13 실측). 첫 페이지에 기간이 안 걸리면
 * 반대쪽(마지막) 페이지도 받아 합친다 — 어느 정렬이든 최대 2요청으로 커버된다.
 */
async function fetchHistories(
  baseUrl: string,
  headers: Record<string, string>,
  key: string,
  bounds: { from: number; to: number },
): Promise<RawHistory[] | null> {
  const page = async (startAt: number): Promise<RawChangelog | null> => {
    try {
      const res = await fetch(
        `${baseUrl}/rest/api/3/issue/${encodeURIComponent(key)}/changelog` +
          `?maxResults=${HISTORY_PAGE}&startAt=${startAt}`,
        { headers },
        TIMEOUT_MS,
      );
      if (!res.ok) return null; // 404 = 이 엔드포인트가 없는 구형 서버
      return (await res.json()) as RawChangelog;
    } catch {
      return null;
    }
  };

  const first = await page(0);
  if (!first) return null;
  const histories = first.histories ?? [];
  const total = first.total ?? histories.length;
  if (total <= HISTORY_PAGE || coversRange(histories, bounds)) return histories;
  const last = await page(total - HISTORY_PAGE);
  return last?.histories ? [...histories, ...last.histories] : histories;
}

/** 동시 실행 수를 제한한 map (Jira 를 한꺼번에 두드리지 않기 위해) */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return out;
}

/** 검색 응답에 실려 온 이력이 통째로 다 왔는지 (잘렸으면 개별 조회로 보강한다) */
function embeddedComplete(log: RawChangelog | undefined): boolean {
  if (!log) return false;
  const total = log.total ?? log.histories?.length ?? 0;
  return (log.histories?.length ?? 0) >= total;
}

/** 기간 안 내 활동 조회 — TTL 캐시 + 동시 요청 공유 */
export async function fetchMyActivity(
  start: string,
  end: string,
  force = false,
): Promise<JiraActivityResult> {
  const auth = jiraAuth();
  if (!auth) {
    return {
      ok: false,
      configured: false,
      error: '환경설정 → 연동에서 Jira 주소·이메일·API 토큰을 입력하세요.',
    };
  }
  // ⚠️ 이 값들은 JQL 문자열에 그대로 들어간다 — 형식을 통과하지 못하면 부르지 않는다.
  //    (`jira:activity` 는 handleShared 라 폰에서도 호출된다)
  if (!DATE_RE.test(start) || !DATE_RE.test(end) || start > end) {
    return { ok: false, configured: true, error: '조회 기간이 올바르지 않습니다.' };
  }

  const cacheKey = `${start}~${end}`;
  const ttl = end >= todayKey() ? TTL_CURRENT_MS : TTL_PAST_MS;
  if (!force) {
    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < ttl) return hit.result;
    const pending = inFlight.get(cacheKey);
    if (pending) return pending;
  }

  const run = collect(auth.url, auth.headers, start, end)
    .then((result) => {
      if (result.ok) {
        cache.set(cacheKey, { at: Date.now(), result });
        // 오래된 주부터 버린다 (Map 은 삽입 순서를 지킨다)
        while (cache.size > CACHE_MAX) {
          const oldest = cache.keys().next().value;
          if (oldest === undefined) break;
          cache.delete(oldest);
        }
      }
      return result;
    })
    .finally(() => {
      inFlight.delete(cacheKey);
    });
  inFlight.set(cacheKey, run);
  return run;
}

/** 오늘 날짜 키 (로컬) — 진행 중인 주인지 판정해 TTL 을 고른다 */
function todayKey(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 실제 조회 — 3갈래 병렬 → 병합 → 이력 보강 → 관여도 판정 */
async function collect(
  baseUrl: string,
  headers: Record<string, string>,
  start: string,
  end: string,
): Promise<JiraActivityResult> {
  const list = branches(start, end);
  // 이력을 함께 달라고 요청해 둔다 — 실려 오면 티켓별 추가 조회가 사라진다.
  // (인스턴스가 무시해도 그냥 없는 채로 오므로 손해는 없다)
  const [outcomes, me] = await Promise.all([
    Promise.all(
      list.map((b) =>
        searchJql(baseUrl, headers, b.jql, {
          maxResults: MAX_RESULTS,
          expand: 'changelog',
        }),
      ),
    ),
    fetchMyself(baseUrl, headers),
  ]);

  const warnings: string[] = [];
  const raw = new Map<string, RawIssue>();
  const sources = new Map<string, JiraActivitySource[]>();
  let anyOk = false;

  outcomes.forEach((res, i) => {
    const b = list[i];
    if (!res.ok) {
      warnings.push(`${b.label} 조회 실패 — ${res.error ?? '알 수 없는 오류'}`);
      return;
    }
    anyOk = true;
    for (const it of res.issues) {
      // 이력이 실려 온 응답을 우선 보관 (갈래마다 expand 결과가 다를 수 있다)
      const cur = raw.get(it.key);
      if (!cur || (!embeddedComplete(cur.changelog) && embeddedComplete(it.changelog))) {
        raw.set(it.key, it);
      }
      const arr = sources.get(it.key) ?? [];
      if (!arr.includes(b.source)) arr.push(b.source);
      sources.set(it.key, arr);
    }
  });

  if (!anyOk) {
    return {
      ok: false,
      configured: true,
      range: { start, end },
      error: warnings[0] ?? 'Jira 에서 활동 내역을 불러오지 못했습니다.',
    };
  }

  const bounds = localBounds(start, end);
  const items = [...raw.values()];

  // 이력을 아직 못 가진 티켓만 개별 조회 — 최신 갱신순으로 상한을 자른다
  const needFetch = items
    .filter((it) => !embeddedComplete(it.changelog))
    .sort((a, b) => (b.fields.updated ?? '').localeCompare(a.fields.updated ?? ''));
  const targets = needFetch.slice(0, HISTORY_LIMIT);
  const skipped = needFetch.length - targets.length;
  if (skipped > 0) {
    warnings.push(
      `티켓이 많아 ${skipped}건은 상세 이력을 건너뛰었습니다 — 관여도가 추정값입니다.`,
    );
  }

  console.log(
    `[jira:activity] ${start}~${end} — 티켓 ${items.length}건` +
      ` (검색에 이력 실림 ${items.length - needFetch.length}건, 개별 조회 ${targets.length}건)` +
      (warnings.length > 0 ? ` · 경고 ${warnings.length}건` : ''),
  );
  const fetched = new Map<string, RawHistory[] | null>();
  if (me && targets.length > 0) {
    const results = await mapLimit(targets, HISTORY_CONCURRENCY, (it) =>
      fetchHistories(baseUrl, headers, it.key, bounds),
    );
    targets.forEach((it, i) => fetched.set(it.key, results[i]));
  }

  const issues: JiraActivityIssue[] = items.map((it) => {
    const base = mapIssue(it, baseUrl, false);
    const src = sources.get(it.key) ?? [];
    const histories = embeddedComplete(it.changelog)
      ? (it.changelog?.histories ?? [])
      : (fetched.get(it.key) ?? null);
    // 계정을 못 알아냈거나 이력 조회가 실패하면 이력 없이 추정 판정으로 간다
    const changes = me && histories ? myChanges(histories, me, bounds) : null;
    const events: JiraActivityEvent[] = (changes ?? []).map((c) => ({
      at: c.at,
      field: c.label,
      from: c.from,
      to: c.to,
    }));
    return {
      ...base,
      sources: src,
      engagement: classify(changes, src, isDoneStatus(base.status, base.statusCategory)),
      events,
      ...(changes ? {} : { historyMissing: true }),
    };
  });

  if (!me) {
    warnings.push('내 계정 정보를 확인하지 못해 상세 이력을 생략했습니다.');
  }

  // 경계에 걸쳐 새어 들어온 티켓을 뺀다 — 이력을 받았는데 그 기간에 내 변경이 하나도 없고
  // 들어온 근거가 '상태 변경' 갈래뿐이면, 그 전환은 이 주 밖에서 일어난 것이다.
  // (담당 이력·작업 시간은 changelog 에 남지 않는 활동이라 이력이 비어도 그대로 둔다)
  const cleaned = issues.filter(
    (it) =>
      it.historyMissing ||
      it.events.length > 0 ||
      it.sources.some((s) => s !== 'status'),
  );

  // 내 마지막 활동이 최근인 순 — 이력이 없으면 티켓 갱신 시각으로 대신한다
  const lastAt = (it: JiraActivityIssue) =>
    it.events.length > 0 ? it.events[it.events.length - 1].at : it.updatedAt;
  cleaned.sort((a, b) => lastAt(b).localeCompare(lastAt(a)));

  return {
    ok: true,
    configured: true,
    range: { start, end },
    issues: cleaned,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}
