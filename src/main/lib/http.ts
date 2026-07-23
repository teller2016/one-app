// 메인 프로세스 공용 fetch — 기본 타임아웃 강제 래퍼.
// 사내망 API(젠킨스·Gitea·그룹웨어 등)는 VPN 끊김 등으로 소켓이 응답 없이
// 매달릴 수 있는데 Node fetch 는 기본 타임아웃이 없어 IPC 프로미스가 영영
// resolve 되지 않는다(렌더러 스피너 무한 대기). 모든 REST 호출은 이 래퍼를 쓴다.

export const HTTP_TIMEOUT_MS = 15_000;

/**
 * 전역 fetch 와 같은 시그니처 + 기본 타임아웃.
 * 호출부가 직접 signal 을 넘기면 그 signal 이 우선한다.
 */
export async function fetchWithTimeout(
  input: string | URL | Request,
  init: RequestInit = {},
  timeoutMs = HTTP_TIMEOUT_MS,
): Promise<Response> {
  try {
    return await fetch(input, {
      signal: AbortSignal.timeout(timeoutMs),
      ...init,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new Error(
        `요청 시간 초과(${Math.round(timeoutMs / 1000)}초) — 네트워크(VPN)를 확인하세요.`,
      );
    }
    throw err;
  }
}
