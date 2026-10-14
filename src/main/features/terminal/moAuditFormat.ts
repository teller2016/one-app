// 폰(MO) 감사 기록의 순수 판정·문구 — moAudit.ts 가 쓰고 moAuditFormat.test.ts 가 고정한다.

const ARG_MAX = 60;
const OBJECT_ARG_MAX = 80;

function clip(s: string, max: number): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max)}…` : one;
}

/**
 * 호출 인자 요약 — 무엇을 했는지 알아볼 만큼만(문자·숫자·불은 60자, 객체는 JSON 80자).
 * 감사 대상 채널은 비밀값을 인자로 받지 않는다(토큰·비밀번호는 main 이 저장소에서 꺼낸다).
 */
export function summarizeArgs(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string' || typeof a === 'number' || typeof a === 'boolean')
        return clip(String(a), ARG_MAX);
      if (a && typeof a === 'object') {
        try {
          return clip(JSON.stringify(a), OBJECT_ARG_MAX);
        } catch {
          return '';
        }
      }
      return '';
    })
    .filter(Boolean)
    .join(' · ');
}

/** 핸들러 결과의 실패 문구 — 이 앱의 IPC 는 실패를 `{ ok: false, error }` 로 돌려준다. 성공이면 null */
export function failureOf(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as { ok?: unknown; error?: unknown };
  if (r.ok !== false) return null;
  return typeof r.error === 'string' && r.error ? r.error : '실패';
}

/** 감사 기록 한 줄 */
export function formatAuditLine(
  at: Date,
  label: string,
  channel: string,
  args: unknown[],
  error: string | null,
): string {
  const summary = summarizeArgs(args);
  return (
    `[${at.toISOString()}] ${error ? 'FAIL' : 'OK'} ${label} (${channel})` +
    (summary ? ` ${summary}` : '') +
    (error ? ` — ${clip(error, 200)}` : '') +
    '\n'
  );
}
