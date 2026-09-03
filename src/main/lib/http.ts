// 메인 프로세스 공용 fetch — 기본 타임아웃 강제 + 네트워크 오류 재시도 래퍼.
// 사내망 API(젠킨스·Gitea·그룹웨어 등)는 VPN 끊김 등으로 소켓이 응답 없이
// 매달릴 수 있는데 Node fetch 는 기본 타임아웃이 없어 IPC 프로미스가 영영
// resolve 되지 않는다(렌더러 스피너 무한 대기). 모든 REST 호출은 이 래퍼를 쓴다.

export const HTTP_TIMEOUT_MS = 15_000;

/** 네트워크 오류 재시도 — 회사 VPN 터널이 순간적으로 끊길 때의 1회성 실패를 흡수한다 */
const RETRY_DELAY_MS = 400;
const MAX_ATTEMPTS = 2; // 최초 1회 + 재시도 1회

/**
 * 재시도해도 되는 실패인가.
 *
 * ⚠️ **서버가 응답을 준 경우(4xx·5xx)는 여기 오지 않는다** — fetch 는 그것을 정상 반환으로
 * 취급하므로 재시도 대상이 아니다. 여기 걸리는 것은 연결 자체가 성립하지 않은 경우뿐이다.
 *
 * ⚠️ 호출부가 직접 넘긴 signal 의 취소(`AbortError`)는 **재시도하지 않는다** — 사용자가
 * 그만두라고 한 요청이다. 우리가 건 타임아웃(`AbortSignal.timeout` → `TimeoutError`)만 재시도.
 */
function isRetriable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'TimeoutError') return true;
  if (err.name === 'AbortError') return false;
  // undici 는 실제 원인을 cause 에 담는다 (ECONNRESET·ECONNREFUSED·ENOTFOUND·EPIPE …)
  const cause = (err as { cause?: { code?: unknown } }).cause;
  const code = cause?.code ?? (err as { code?: unknown }).code;
  return (
    typeof code === 'string' &&
    /^(ECONN|EPIPE|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|EAI_AGAIN|UND_ERR)/.test(
      code
    )
  );
}

/** 재시도가 안전한 메서드인가 — 멱등하지 않은 요청(빌드 트리거·PR 머지 등)은 절대 반복하지 않는다 */
const isIdempotent = (init: RequestInit) => {
  const method = (init.method ?? 'GET').toUpperCase();
  return method === 'GET' || method === 'HEAD';
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 전역 fetch 와 같은 시그니처 + 기본 타임아웃 + 네트워크 오류 1회 재시도.
 * 호출부가 직접 signal 을 넘기면 그 signal 이 우선한다(그 경우 타임아웃은 호출부 책임).
 *
 * 재시도를 넣은 이유 — 회사 VPN 서버가 `ping-restart 3600` 을 push 해서 터널이 죽어도
 * 최대 1시간 동안 "연결됨" 상태가 유지된다(2026-08-10 로그 실측). 그 사이 첫 요청은
 * 실패하지만 곧 복구되는 경우가 많아, 한 번 더 시도하면 사용자가 끊김을 체감하지 않는다.
 */
export async function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit = {},
  timeoutMs = HTTP_TIMEOUT_MS,
): Promise<Response> {
  const attempts = isIdempotent(init) ? MAX_ATTEMPTS : 1;
  let lastErr: unknown;

  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fetch(input, {
        signal: AbortSignal.timeout(timeoutMs),
        ...init,
      });
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1 || !isRetriable(err)) break;
      await wait(RETRY_DELAY_MS);
    }
  }

  if (lastErr instanceof Error && lastErr.name === 'TimeoutError') {
    throw new Error(
      `요청 시간 초과(${Math.round(timeoutMs / 1000)}초) — 네트워크(VPN)를 확인하세요.`,
    );
  }
  throw lastErr;
}

/**
 * JSON 응답 파싱 — **JSON 이 아닌 응답을 사람이 읽을 오류로 바꾼다.**
 *
 * ⚠️ 2026-09-03 실측: 환경설정의 Jira 주소에 티켓 경로가 붙어 있으면 Atlassian 이 REST 경로를
 * SPA 로 받아 **HTML 을 HTTP 200** 으로 돌려준다. 그때 `res.json()` 이 던지는 V8 메시지
 * (`Unexpected token '<', "<div id="j"… is not valid JSON`)가 그대로 배너에 노출돼 원인을
 * 짐작할 수 없었다(One App Lite 2.0.0 제보). 상태코드가 200 이라 `res.ok` 검사로는 못 걸린다.
 */
export async function readJson<T>(res: Response, label: string): Promise<T> {
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
  if (!/\bjson\b/i.test(type)) {
    throw new Error(
      `${label} 가 JSON 대신 ${type || '알 수 없는 형식'} 을 돌려줬습니다 (HTTP ${res.status}) — ` +
        `환경설정의 ${label} 주소가 사이트 주소인지 확인하세요(티켓·보드 주소를 붙여넣으면 안 됩니다).`,
    );
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new Error(`${label} 응답을 해석할 수 없습니다 (HTTP ${res.status}) — 잠시 후 다시 시도하세요.`);
  }
}
