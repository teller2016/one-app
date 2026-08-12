// 마이크로 헬퍼 — 여러 기능 모듈이 각자 정의하던 것을 단일화
export const sleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));

/** 로컬 기준 날짜 키 (예: "2026-7-23") — 하루 단위 상태 초기화 판정용 */
export const localDateKey = (d: Date) =>
  `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

/**
 * 셸 인자 안전 인용 — 작은따옴표로 감싸고 내부 작은따옴표만 탈출시킨다.
 * 개행·따옴표·백틱이 들어간 문자열(티켓 본문에서 만든 프롬프트 등)을 명령에 끼워 넣는
 * 유일한 경로다. ⚠️ 셸 명령 문자열 조립은 항상 main 에서 이 함수를 거칠 것.
 */
export const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

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
