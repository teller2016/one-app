// 일정 노션 기록 — [노션용 복사]와 같은 줄 텍스트를 노션에 직접 쓴다.
// 공식 REST API(개인 액세스 토큰 — 루트 페이지에 연결 필요)만 사용한다.
//
// 실제 기록 구조(2026-08-14 사용자 스크린샷 기준): 월만 페이지고,
// 주·일은 ### 토글 헤딩(heading_3 + is_toggleable)이다.
//   투입시간(루트 페이지) > "26년 8월"(페이지) > "8.10 월"(###) > "8/13 목"(###) > 줄 문단들
// ⚠️ 월 페이지 상단이 일정 구역이고 구분선 아래에 사용자 todo 구역이 따로 있다 —
// 새 주 헤딩을 그냥 append 하면 페이지 맨 끝(todo 뒤)에 붙으므로, position(after_block)으로
// 마지막 주 헤딩 뒤(없으면 첫 구분선 앞)에 끼워넣는다.
// 제목 비교는 공백을 무시한다(사용자 표기가 "8.3 월"/"8/13 목" 처럼 들쭉날쭉해서).
import { fetchWithTimeout as fetch } from '../../lib/http';
import { getNotionConfig } from '../settings/store';
import { resolveBaseDate } from './scheduleUtils';
import type {
  ScheduleNotionRecordPayload,
  ScheduleNotionRecordResult,
} from '../../../shared/types';

const API = 'https://api.notion.com/v1';
// 최신 버전(2026-03-11, 공식 versioning 문서 기준) — 데이터베이스(데이터 소스) 쪽 변경이라
// 여기서 쓰는 페이지·블록 엔드포인트는 영향이 없다.
const NOTION_VERSION = '2026-03-11';

const DAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

/**
 * 대상 날짜 → 단계별 제목. 예: 2026-08-13(목) →
 * { month: '26년 8월', week: '8.10 월', day: '8/13 목' } (띄어쓰기는 사용자 표기 관례)
 * 월·주는 그 주 월요일 기준 — 월말에 걸친 주(예: 8/31월~9/4금)도
 * 월요일이 속한 달("26년 8월" > "8.31 월") 아래에 기록된다.
 */
export function notionTitles(date: Date): {
  month: string;
  week: string;
  day: string;
} {
  const monday = new Date(date);
  monday.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return {
    month: `${monday.getFullYear() % 100}년 ${monday.getMonth() + 1}월`,
    week: `${monday.getMonth() + 1}.${monday.getDate()} 월`,
    day: `${date.getMonth() + 1}/${date.getDate()} ${DAY_KO[date.getDay()]}`,
  };
}

/** 노션 페이지 URL → API 용 페이지 ID (경로 끝의 32자리 hex → UUID 형식) */
export function pageIdFromUrl(url: string): string | null {
  let candidate = url.trim();
  try {
    // 쿼리(?p=…)에도 32자리 hex 가 올 수 있어 경로만 본다
    candidate = new URL(candidate).pathname;
  } catch {
    // URL 이 아니면 ID 를 그대로 붙여넣은 것으로 간주
  }
  const m = candidate.match(/([0-9a-f]{32})\/?$/i);
  if (!m) return null;
  const h = m[1].toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

type NotionRichText = { plain_text?: string; text?: { content?: string } };
type NotionHeading = { rich_text: NotionRichText[]; is_toggleable?: boolean };

type NotionBlock = {
  id: string;
  type: string;
  child_page?: { title: string };
  toggle?: { rich_text: NotionRichText[] };
  heading_1?: NotionHeading;
  heading_2?: NotionHeading;
  heading_3?: NotionHeading;
};

type NotionList = {
  results: NotionBlock[];
  has_more: boolean;
  next_cursor: string | null;
};

async function api<T>(
  token: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
  });
  let body: (T & { message?: string }) | null = null;
  try {
    body = (await res.json()) as T & { message?: string };
  } catch {
    body = null; // 본문 없는 응답(빈 body 등)은 상태 코드로만 판정
  }
  if (!res.ok) {
    // 404 는 대부분 페이지에 토큰 연결(Connections)이 안 된 경우 — 조치를 안내한다
    const hint =
      res.status === 404
        ? ' — 노션에서 루트 페이지에 토큰을 연결했는지 확인하세요'
        : '';
    throw new Error(`노션 API 오류(${res.status}): ${body?.message ?? ''}${hint}`);
  }
  return body as T;
}

/** 하위 블록 전체 조회 (100개 단위 페이지네이션) */
async function listChildren(
  token: string,
  blockId: string,
): Promise<NotionBlock[]> {
  const all: NotionBlock[] = [];
  let cursor: string | null = null;
  do {
    const qs = new URLSearchParams({ page_size: '100' });
    if (cursor) qs.set('start_cursor', cursor);
    const res: NotionList = await api<NotionList>(
      token,
      `/blocks/${blockId}/children?${qs}`,
    );
    all.push(...res.results);
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor && all.length < 1000);
  return all;
}

/** 제목 비교용 정규화 — 공백 차이("8.3 월" vs "8.3월")를 무시한다 */
const norm = (s: string) => s.replace(/\s+/g, '');

const richToText = (rich: NotionRichText[] | undefined): string | null =>
  rich ? rich.map((t) => t.plain_text ?? t.text?.content ?? '').join('') : null;

/** 블록의 표시 제목 — 하위 페이지·토글·헤딩(토글 헤딩 포함) 텍스트 (그 외 타입은 null) */
function blockTitle(b: NotionBlock): string | null {
  switch (b.type) {
    case 'child_page':
      return b.child_page?.title ?? null;
    case 'toggle':
      return richToText(b.toggle?.rich_text);
    case 'heading_1':
      return richToText(b.heading_1?.rich_text);
    case 'heading_2':
      return richToText(b.heading_2?.rich_text);
    case 'heading_3':
      return richToText(b.heading_3?.rich_text);
    default:
      return null;
  }
}

/** 목록에서 제목이 일치하는 블록 찾기 — 페이지·토글·헤딩 어느 쪽으로 만들었든 잡는다 */
function findByTitle(blocks: NotionBlock[], title: string): NotionBlock | null {
  const target = norm(title);
  return (
    blocks.find((b) => {
      const t = blockTitle(b);
      return t !== null && norm(t) === target;
    }) ?? null
  );
}

/** 하위 페이지 생성 → 새 페이지 ID (월 단계 전용 — 주·일은 토글 헤딩으로 만든다) */
async function createChildPage(
  token: string,
  parentId: string,
  title: string,
): Promise<string> {
  const res = await api<{ id: string }>(token, '/pages', {
    method: 'POST',
    body: JSON.stringify({
      parent: { page_id: parentId },
      properties: { title: { title: [{ text: { content: title } }] } },
    }),
  });
  return res.id;
}

/**
 * ### 토글 헤딩 생성 → 새 블록 ID (append 응답의 results 에 생성된 블록이 온다).
 * afterBlockId 를 주면 그 블록 바로 뒤에 삽입한다 — 안 주면 부모의 맨 끝.
 */
async function createToggleHeading(
  token: string,
  parentId: string,
  title: string,
  afterBlockId?: string,
): Promise<string> {
  const res = await api<NotionList>(token, `/blocks/${parentId}/children`, {
    method: 'PATCH',
    body: JSON.stringify({
      ...(afterBlockId
        ? { position: { type: 'after_block', after_block: { id: afterBlockId } } }
        : {}),
      children: [
        {
          object: 'block',
          type: 'heading_3',
          heading_3: {
            rich_text: [{ type: 'text', text: { content: title } }],
            is_toggleable: true,
          },
        },
      ],
    }),
  });
  const id = res.results[0]?.id;
  if (!id) throw new Error('노션 토글 헤딩 생성 응답에 블록 ID 가 없습니다');
  return id;
}

/** 줄 텍스트를 문단 블록으로 append (API 제한: 한 번에 100블록) */
async function appendLines(
  token: string,
  parentId: string,
  lines: string[],
): Promise<void> {
  await api(token, `/blocks/${parentId}/children`, {
    method: 'PATCH',
    body: JSON.stringify({
      children: lines.slice(0, 100).map((line) => ({
        object: 'block',
        type: 'paragraph',
        paragraph: { rich_text: [{ type: 'text', text: { content: line } }] },
      })),
    }),
  });
}

/** 정규화 제목이 주차 표기("8.10월")인가 — 새 주 헤딩의 삽입 앵커 탐색용 */
const isWeekTitle = (b: NotionBlock): boolean => {
  const t = blockTitle(b);
  return t !== null && /^\d{1,2}\.\d{1,2}월$/.test(norm(t));
};

/**
 * 새 주 헤딩을 끼워넣을 앵커 블록 ID — 일정 구역(페이지 상단)을 벗어나지 않게 한다.
 * 마지막 주 헤딩 뒤 → 없으면 첫 구분선 바로 앞 블록 뒤 → 그것도 없으면 맨 끝(undefined).
 */
function weekInsertAnchor(monthChildren: NotionBlock[]): string | undefined {
  const lastWeek = monthChildren.filter(isWeekTitle).at(-1);
  if (lastWeek) return lastWeek.id;
  const dividerIdx = monthChildren.findIndex((b) => b.type === 'divider');
  if (dividerIdx > 0) return monthChildren[dividerIdx - 1].id;
  return undefined;
}

/** 일정 텍스트를 대상 날짜의 토글 헤딩(월 페이지 > 주 ### > 일 ###)에 기록한다 */
export async function recordScheduleToNotion(
  payload: ScheduleNotionRecordPayload,
): Promise<ScheduleNotionRecordResult> {
  const cfg = getNotionConfig();
  if (!cfg) return { ok: false, error: 'no_config' };
  const rootId = pageIdFromUrl(cfg.rootUrl);
  if (!rootId) {
    return {
      ok: false,
      error: '노션 페이지 URL 에서 페이지 ID 를 찾지 못했습니다 — 환경설정을 확인하세요',
    };
  }

  const lines = payload.scheduleText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return { ok: false, error: '기록할 내용이 없습니다' };

  try {
    const date = resolveBaseDate(payload.dateOption);
    const titles = notionTitles(date);

    // 월 — 페이지 (없으면 페이지로 생성)
    const rootChildren = await listChildren(cfg.token, rootId);
    const monthFound = findByTitle(rootChildren, titles.month);
    const monthId =
      monthFound?.id ?? (await createChildPage(cfg.token, rootId, titles.month));
    // 링크 앵커의 호스트 페이지 — 월이 페이지가 아니면(변칙 구조) 루트가 호스트다
    const hostId =
      monthFound && monthFound.type !== 'child_page' ? rootId : monthId;

    // 주 — ### 토글 헤딩 (없으면 일정 구역 안에 끼워넣어 생성 — todo 구역 뒤로 밀리지 않게)
    const monthChildren = await listChildren(cfg.token, monthId);
    const weekFound = findByTitle(monthChildren, titles.week);
    const weekId =
      weekFound?.id ??
      (await createToggleHeading(
        cfg.token,
        monthId,
        titles.week,
        weekInsertAnchor(monthChildren),
      ));

    // 일 — ### 토글 헤딩. 이미 내용이 있으면 확인(force) 후에만 이어붙인다 — 중복 기록 방지
    const weekChildren = weekFound ? await listChildren(cfg.token, weekId) : [];
    const dayFound = findByTitle(weekChildren, titles.day);
    if (dayFound && !payload.force) {
      const children = await listChildren(cfg.token, dayFound.id);
      if (children.length > 0) return { ok: false, error: 'has_content' };
    }
    const dayId =
      dayFound?.id ?? (await createToggleHeading(cfg.token, weekId, titles.day));

    await appendLines(cfg.token, dayId, lines);
    return {
      ok: true,
      // 일 토글 헤딩으로 바로 가는 앵커 링크 (페이지URL#블록ID)
      url: `https://www.notion.so/${hostId.replace(/-/g, '')}#${dayId.replace(/-/g, '')}`,
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
