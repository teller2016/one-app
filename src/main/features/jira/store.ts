// 직접 추가한 Jira 티켓 목록 — 담당으로 안 날아왔는데 내가 작업해야 하는 이슈를
// 주소(또는 키)로 끌어와 내 목록에 함께 띄운다. 비밀이 없어 평문 JSON.
//
// **키만 저장한다** — 제목·상태는 매 조회 때 Jira 에서 받으므로 여기 두면 곧 낡는다.
import type { JiraAddedTicket } from '../../../shared/types';
import { readUserJson, writeUserJson } from '../../lib/store';

const FILE = 'jira.json';
/** 보관 상한 — JQL `key IN (…)` 길이 방어 + 추가분이 담당 목록을 덮지 않게 */
const MAX_ADDED = 50;

interface StoredJira {
  added?: JiraAddedTicket[];
}

const read = (): StoredJira => readUserJson<StoredJira>(FILE, {});

/**
 * 입력에서 이슈 키를 뽑는다 — 키 직접 입력·이슈 주소·보드 주소 모두 받는다.
 * ⚠️ 주소 안에서 아무 `단어-숫자` 나 집으면 호스트명(`repo-2.example.com`)을 오인할 수 있어
 * `/browse/…`·`selectedIssue=…` 를 먼저 본다.
 */
export function normalizeIssueKey(input: string): string | null {
  const raw = (input ?? '').trim();
  if (!raw) return null;
  const pick = (s: string): string | null => {
    const m = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/.exec(s.trim());
    return m ? `${m[1].toUpperCase()}-${m[2]}` : null;
  };
  const direct = pick(raw);
  if (direct) return direct; // 키만 입력한 경우

  const browse = /\/browse\/([A-Za-z][A-Za-z0-9]*-\d+)/.exec(raw);
  if (browse) return pick(browse[1]);

  const selected = /[?&](?:selectedIssue|issueKey)=([A-Za-z][A-Za-z0-9]*-\d+)/.exec(raw);
  if (selected) return pick(selected[1]);

  // 마지막 수단 — 쿼리스트링을 걷어낸 경로에서 키 패턴 하나
  const any = /\b([A-Za-z][A-Za-z0-9]*-\d+)\b/.exec(raw.split('?')[0]);
  return any ? pick(any[1]) : null;
}

/** 추가한 티켓 목록 (최근 추가 순) */
export function listAddedTickets(): JiraAddedTicket[] {
  return [...(read().added ?? [])].sort((a, b) => b.addedAt - a.addedAt);
}

export function isAdded(key: string): boolean {
  return (read().added ?? []).some((t) => t.key === key);
}

/** 추가 — 이미 있으면 그대로 둔다(추가 시각을 갱신하지 않는다) */
export function addTicket(key: string): JiraAddedTicket[] {
  const list = read().added ?? [];
  if (!list.some((t) => t.key === key)) {
    // 상한을 넘으면 가장 오래 전에 추가한 것부터 밀어낸다
    const next = [...list, { key, addedAt: Date.now() }]
      .sort((a, b) => b.addedAt - a.addedAt)
      .slice(0, MAX_ADDED);
    writeUserJson(FILE, { ...read(), added: next });
  }
  return listAddedTickets();
}

export function removeTicket(key: string): JiraAddedTicket[] {
  const list = read().added ?? [];
  const next = list.filter((t) => t.key !== key);
  if (next.length !== list.length) writeUserJson(FILE, { ...read(), added: next });
  return listAddedTickets();
}
