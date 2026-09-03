// Gitea REST 공용 클라이언트 — 인증 헤더 조립과 실패 문구를 한곳에 모은다.
// 예전엔 `features/deploy/gitea.ts`(배포 미리보기)와 `features/prs/gitea.ts`(PR 목록·생성·머지)가
// 같은 헤더와 **글자까지 똑같은 에러 문구**를 각자 들고 있었다(문구 하나가 17번 반복).
//
// ⚠️ 호출은 `fetchWithTimeout` 경유 — 전역 fetch 는 타임아웃이 없어 소켓 hang 시 IPC 가 안 풀린다.
import { fetchWithTimeout, readJson } from './http';

/** 토큰이 있을 때만 인증 헤더 — 공개 저장소는 토큰 없이도 읽힌다 */
export const giteaAuthHeaders = (
  token: string | null,
): Record<string, string> =>
  token ? { Authorization: `token ${token}` } : {};

const CONNECT_FAIL =
  'Gitea 에 연결할 수 없습니다 — 주소·네트워크(VPN)를 확인하세요.';
const AUTH_FAIL = 'Gitea 인증 실패 — 환경설정의 Gitea 토큰을 확인하세요.';

export type GiteaFetchOpts = {
  init?: RequestInit;
  /** 기타 오류 문구의 주체 — "브랜치 목록" → `브랜치 목록 조회 실패 (HTTP 500)` */
  label?: string;
  /** 기본 문구를 덮어쓸 때 */
  errors?: {
    auth?: string; // 401·403
    notFound?: string; // 404
    /** 그 밖의 상태코드 개별 지정 (예: 409 — 이미 같은 PR 이 있음) */
    byStatus?: Record<number, string>;
  };
  /**
   * true 면 오류 상태(4xx·5xx)에서도 던지지 않고 Response 를 그대로 준다.
   * 실패를 조용히 넘기는 보강용 조회(승인 수·기본 브랜치 등)가 쓴다 — 연결 실패는 여전히 던진다.
   */
  raw?: boolean;
  timeoutMs?: number;
};

/**
 * Gitea REST 호출 — 연결 실패·인증 실패·404·기타 오류를 공통 문구의 Error 로 바꿔 던진다.
 * 응답 본문 파싱은 호출부 담당(`giteaJson` 을 쓰면 그것까지 처리한다).
 */
export async function giteaFetch(
  url: string,
  token: string | null,
  opts: GiteaFetchOpts = {},
): Promise<Response> {
  const { init = {}, label, errors = {}, raw = false, timeoutMs } = opts;

  let res: Response;
  try {
    res = await fetchWithTimeout(
      url,
      { ...init, headers: { ...giteaAuthHeaders(token), ...init.headers } },
      timeoutMs,
    );
  } catch {
    // 타임아웃 래퍼의 문구보다 "어느 서버인지" 가 중요해 Gitea 문구로 덮는다
    throw new Error(CONNECT_FAIL);
  }

  if (raw || res.ok) return res;

  const byStatus = errors.byStatus?.[res.status];
  if (byStatus) throw new Error(byStatus);
  if (res.status === 401 || res.status === 403)
    throw new Error(errors.auth ?? AUTH_FAIL);
  if (res.status === 404 && errors.notFound) throw new Error(errors.notFound);
  throw new Error(
    label
      ? `${label} 실패 (HTTP ${res.status})`
      : `Gitea 응답 오류 (HTTP ${res.status})`,
  );
}

/** `giteaFetch` + JSON 파싱 — 배열 응답이 아닌 값이 와도 호출부 타입을 지킨다 */
export async function giteaJson<T>(
  url: string,
  token: string | null,
  opts: GiteaFetchOpts = {},
): Promise<T> {
  const res = await giteaFetch(url, token, opts);
  // 주소가 잘못돼 HTML 이 200 으로 오는 경우까지 사람이 읽을 문구로 (main/lib/http.ts 머리말)
  return readJson<T>(res, 'Gitea');
}
