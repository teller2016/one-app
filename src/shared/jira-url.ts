// Jira 주소 정리 — 사용자가 붙여넣은 주소에서 **사이트 주소만** 남긴다.
//
// ⚠️ 실측(2026-09-03, Windows 배포판 제보): 베이스 주소에 경로가 붙어 있으면 Atlassian 은
// `…/browse/FEMC-1/rest/api/3/project/search` 를 **SPA 라우팅으로 받아 HTML 을 HTTP 200**
// 으로 돌려준다(본문이 `<div id="jira-frontend">…`). 그래서 티켓 보고가
// `Unexpected token '<', "<div id="j"… is not valid JSON` 으로 죽었고, 오류만 보고는
// 주소 문제라는 것을 알 수 없었다. → 저장·사용 양쪽에서 경로를 떼어 낸다.

/**
 * Jira 앱 경로 — 베이스 주소일 수 없는 것들만 골랐다.
 *
 * `/jira`·`/jira/software` 는 넣지 않는다 — 설치형(Server/DC)은 `https://host/jira` 서브패스에
 * 배포될 수 있어 자르면 오히려 정상 주소가 깨진다. Cloud 의 `/jira/your-work` 류는 아래
 * atlassian 호스트 규칙(origin 강제)이 이미 걷어낸다.
 */
const APP_PATH = /\/(browse|rest|secure|issues|projects|plugins)(\/|$)/i;

/**
 * 티켓·보드 주소를 붙여넣어도 REST 를 부를 수 있는 베이스로 만든다.
 * 형식이 URL 이 아니면 손대지 않는다(스킴 검사는 호출부 책임 — settings 의 normalizeEndpoint).
 */
export function normalizeJiraBase(raw: string): string {
  const url = raw.trim().replace(/\/+$/, '');
  if (!url) return '';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  // Cloud 는 경로 없는 사이트 주소가 유일한 베이스다
  if (/(^|\.)atlassian\.(net|com)$/i.test(parsed.hostname)) return parsed.origin;
  const hit = APP_PATH.exec(parsed.pathname);
  const path = hit ? parsed.pathname.slice(0, hit.index) : parsed.pathname;
  return `${parsed.origin}${path}`.replace(/\/+$/, '');
}

/**
 * Jira 이슈 키 패턴 — 예: BBJ-1234. 전역 플래그라 `matchAll`·`String#match` 용이다
 * (⚠️ `.test()` 는 lastIndex 가 남아 두 번째 호출부터 어긋나니 쓰지 말 것).
 */
export const JIRA_KEY_RE = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/g;

// ── 키 판별 (2026-10-21 공통화 — 세 갈래가 패턴을 각자 들고 있었다) ──
//
// 쓰임새가 달라 정규식을 일부러 둘로 둔다:
//  - **찾기**(`JIRA_KEY_RE` 위) — 산문 속에서 집으므로 오탐을 줄이려고 접두를 2~10자로 묶고 밑줄을 뺀다.
//  - **검사**(아래) — 이미 키라고 건네받은 값이라 Jira 프로젝트 키 규칙 그대로(대문자 시작 +
//    대문자·숫자·밑줄) 받는다. 경로·JQL·REST 에 들어가기 전 형식 검사다.
// 사용자가 붙여넣은 주소·소문자 입력의 정규화는 main `jira/store.ts` 의 `normalizeIssueKey`(용도가 다르다).

/** 값 전체가 이슈 키 하나인지 — IPC 인자처럼 타입을 믿을 수 없는 값도 받는다 */
export const isIssueKey = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Z][A-Z0-9_]*-\d+$/.test(value);

/**
 * 문자열 **앞머리**의 이슈 키 — Jira [작업] 이 세션 제목을 티켓 키로 주므로 세션 ↔ 티켓 매칭에 쓴다
 * (렌더러: Jira 목록의 femc 세션 칩 · main: 세션이 물고 있는 티켓 폴더 정리 보호).
 * 앞뒤 공백·대소문자는 무시한다 — 사용자가 세션 이름을 `ssb-86 …` 로 고쳐도 맞는다.
 */
export const leadingIssueKey = (text: string): string | undefined =>
  /^[A-Z][A-Z0-9_]*-\d+/.exec(text.trim().toUpperCase())?.[0];

/** 이슈 브라우저 주소 — `{base}/browse/{key}` */
export const jiraIssueUrl = (jiraUrl: string, key: string) =>
  `${jiraUrl.replace(/\/+$/, '')}/browse/${key}`;

/**
 * 한 줄 텍스트(PR 제목·브랜치명 등)에서 이슈 키를 **등장 순서대로 중복 없이** 뽑는다.
 * 커밋 메시지처럼 여러 줄 산문은 `JSR-310`·`UTF-8` 같은 오탐이 있어 여기서 훑지 않는다 —
 * 그쪽은 키가 적히는 자리를 기준으로 삼는 deploy 의 `extractIssueKeys` 를 쓴다.
 */
export const issueKeysIn = (text: string): string[] =>
  [...new Set(text.match(JIRA_KEY_RE) ?? [])];
