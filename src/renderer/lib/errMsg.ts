// 예외·IPC 실패를 사용자에게 보여줄 한 줄로 바꾸는 공용 헬퍼.
//
// 예전엔 `(err as Error).message` 가 68곳에 흩어져 있었다. 그 단언은 **거짓일 수 있다** —
// 문자열을 throw 하거나 IPC 가 Error 가 아닌 값을 넘기면 `undefined` 가 되어 화면에
// "세션 생성 실패: undefined" 가 뜬다. 여기서 한 번에 막는다.

/** 기본 문구 — 호출부가 상황에 맞는 문장을 주는 편이 낫다 */
const DEFAULT_FALLBACK = '알 수 없는 오류가 발생했습니다.';

/** 무엇이 throw 됐든 사람이 읽을 한 줄로 — 메시지가 비어 있으면 fallback */
export function errMsg(e: unknown, fallback = DEFAULT_FALLBACK): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === 'string' && e.trim()) return e;
  return fallback;
}

/**
 * `{ ok, error? }` 형태 IPC 응답의 실패 문구 — 서버가 문구를 안 줬을 때 fallback.
 * 성공 응답에 쓰면 안 된다(호출부가 `res.ok` 로 먼저 가른다).
 */
export const resultError = (
  res: { error?: string } | null | undefined,
  fallback = DEFAULT_FALLBACK,
): string => res?.error?.trim() || fallback;
