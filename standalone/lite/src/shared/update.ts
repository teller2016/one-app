// 새 버전 확인·자동 설치 — main(`main/update*.ts`) · preload · 렌더러가 함께 쓰는 모양.
// 이 앱만의 타입이라 본체 `shared/types.ts` 를 늘리지 않는다(본체엔 이 기능이 없다 — 본체는
// `/build` 로 직접 설치한다).

/** 이 PC 용 배포 산출물 — GitHub 릴리스의 asset 한 개 */
export type UpdateAsset = {
  name: string;
  url: string;
  size: number;
  /** GitHub 가 주는 sha256(hex) — 없을 수도 있다(그러면 크기만 검증) */
  sha256?: string;
};

export type UpdateInfo = {
  /** 조회에 성공했는가 — 네트워크 실패·GitHub 오류면 false (앱 동작은 막지 않는다) */
  ok: boolean;
  /** 지금 실행 중인 버전 (조회 실패해도 항상 채워진다) */
  current: string;
  /** 배포된 최신 버전 — `ok` 일 때만 */
  latest?: string;
  /** 최신이 현재보다 높은가 */
  hasUpdate?: boolean;
  /** 받으러 갈 릴리스 페이지 (자동 설치가 안 될 때의 폴백) */
  url: string;
  /** 실패 사유 — 사용자에게 그대로 보여줄 한 줄 */
  error?: string;
  /** 이 PC 용 산출물 — 없으면 자동 설치 불가 */
  asset?: UpdateAsset;
  /** 앱 안에서 바로 설치할 수 있는가 — 이 PC 용 산출물이 있고, 교체 가능한 위치에서 실행 중 */
  canInstall?: boolean;
  /** `canInstall` 이 false 인 이유 — 사용자에게 그대로 보여준다 */
  installBlocked?: string;
};

export type UpdatePhase = 'download' | 'verify' | 'extract' | 'install';

/** 설치 진행 — `update:progress` 이벤트로 흘러온다 */
export type UpdateProgress = {
  phase: UpdatePhase;
  /** 0~100 — download 단계에서만 (전체 크기를 알 때) */
  percent?: number;
  received?: number;
  total?: number;
};

export type UpdateInstallResult =
  /** 헬퍼가 떴다 — 앱은 곧 종료되고 새 버전으로 다시 시작한다 */
  | { ok: true }
  | {
      ok: false;
      error: string;
      /** 이미 받아 풀어둔 폴더 — 열어주면 사용자가 직접 교체할 수 있다(반자동 폴백) */
      folder?: string;
    };
