// 외부 HTML(메일 본문·Jira 이슈 등)을 앱 내 sandbox iframe 으로 렌더하기 전 정화
/** 위험 태그·인라인 스크립트·이벤트 핸들러 제거 (sandbox iframe 과 함께 이중 방어) */
export function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<(object|embed|applet|link|meta|base|form)\b[^>]*>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, '')
    .replace(/javascript:/gi, '');
}
