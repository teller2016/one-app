export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 지정 시간 안에 끝나지 않으면 거부 — Electron 의 loadURL 등 무한 대기 방지 */
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
