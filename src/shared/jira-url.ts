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
