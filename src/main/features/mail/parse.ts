// 메일 응답 파싱 공용 — 목록·본문(`mail.ts`)과 인증코드 추출(`authcode.ts`)이 함께 쓴다.
import { AuthError } from './session';

/** 응답 텍스트가 로그인 페이지(세션 만료)인지 — 그러면 재로그인 유도 */
export function looksLikeLogin(text: string): boolean {
  return /egovLoginUsr|actionLogin|<title>[^<]*로그인/i.test(text);
}

/** JSON 응답 파싱 (text/plain 로 오는 경우 포함). 로그인 페이지면 AuthError */
export async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    if (looksLikeLogin(text)) throw new AuthError('세션이 만료되었습니다.');
    throw new Error('메일 서버 응답을 해석하지 못했습니다.');
  }
}

/** 그룹웨어가 HTML 이스케이프해 내려주는 텍스트 필드 복원 — "&lt;a@b&gt;" → "<a@b>" */
export function decodeEntities(raw: string): string {
  return raw
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) =>
      String.fromCodePoint(parseInt(n, 16)),
    )
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&'); // 이중 이스케이프(&amp;lt;)가 원문으로 남도록 마지막에
}

/** "2026-07-21 10:21:16" → epoch ms (실패 시 0) */
export function parseDate(raw?: string): number {
  if (!raw) return 0;
  const ms = Date.parse(raw.replace(' ', 'T'));
  return Number.isNaN(ms) ? Date.parse(raw) || 0 : ms;
}

/**
 * 메일 본문 HTML → 코드 추출용 평문.
 *
 * ⚠️ 폭 없는 문자(zero-width)를 지운다 — 메일 발송 도구가 스팸 필터를 피하려고 글자 사이에
 * 끼워 넣으면 숫자 뭉치가 쪼개져 코드 정규식이 빗나간다. 태그 제거 → 엔티티 복원 순서도
 * 지켜야 한다(먼저 복원하면 `&lt;script&gt;` 가 태그로 되살아난다).
 */
export function htmlToText(html: string): string {
  const stripped = html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(stripped)
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '') // zero-width space/non-joiner/joiner·word-joiner·BOM
    .replace(/\s+/g, ' ')
    .trim();
}
