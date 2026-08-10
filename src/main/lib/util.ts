// 마이크로 헬퍼 — 여러 기능 모듈이 각자 정의하던 것을 단일화
export const sleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));

/** 로컬 기준 날짜 키 (예: "2026-7-23") — 하루 단위 상태 초기화 판정용 */
export const localDateKey = (d: Date) =>
  `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

/** 지정 시간 안에 끝나지 않으면 거부 — Electron 의 loadURL·executeJavaScript 무한 대기 방지 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} 시간이 초과됐습니다(${ms / 1000}초).`)),
      ms,
    );
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
