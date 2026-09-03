// 새 버전 확인 결과 — main(`main/update.ts`) · preload · 렌더러가 함께 쓰는 모양.
// 이 앱만의 타입이라 본체 `shared/types.ts` 를 늘리지 않는다(본체엔 이 기능이 없다 — 본체는
// `/build` 로 직접 설치한다).

export type UpdateInfo = {
  /** 조회에 성공했는가 — 네트워크 실패·GitHub 오류면 false (앱 동작은 막지 않는다) */
  ok: boolean;
  /** 지금 실행 중인 버전 (조회 실패해도 항상 채워진다) */
  current: string;
  /** 배포된 최신 버전 — `ok` 일 때만 */
  latest?: string;
  /** 최신이 현재보다 높은가 */
  hasUpdate?: boolean;
  /** 받으러 갈 릴리스 페이지 */
  url: string;
  /** 실패 사유 — 사용자에게 그대로 보여줄 한 줄 */
  error?: string;
};
