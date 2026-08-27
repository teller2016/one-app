// 마이크로 헬퍼 — 여러 기능 모듈이 각자 정의하던 것을 단일화
export const sleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));

/**
 * 로컬 기준 날짜 키 (예: "2026-7-23") — 근태 리마인더의 하루 단위 상태 초기화 판정용.
 *
 * ⚠️ **0패딩이 없는 레거시 형식이다. 새 코드에서 쓰지 말고 `shared/date` 의 `dayKey`·`todayKey`
 * ("2026-07-23")를 쓸 것.** 여기만 형식이 다른 이유는 `userData/reminder-state.json` 에 이미
 * 이 형식으로 저장돼 있어서다 — 형식을 바꾸면 저장된 "오늘 처리함" 기억이 무효가 돼
 * 그날 리마인더가 한 번 더 뜬다.
 */
export const localDateKey = (d: Date) =>
  `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

/**
 * 셸 인자 안전 인용 — 작은따옴표로 감싸고 내부 작은따옴표만 탈출시킨다.
 * 개행·따옴표·백틱이 들어간 문자열(티켓 본문에서 만든 프롬프트 등)을 명령에 끼워 넣는
 * 유일한 경로다. ⚠️ 셸 명령 문자열 조립은 항상 main 에서 이 함수를 거칠 것.
 */
export const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * 동시 실행 수를 제한한 map — 결과 순서는 입력 순서를 따른다.
 * 첨부·이미지처럼 하나가 수 MB~수십 MB 인 요청을 Promise.all 로 한꺼번에 띄우면
 * 메모리 피크가 (개수 × 크기) 로 튀고 V8 고수위가 RSS 에 남는다 — 2~3개씩 흘린다.
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return out;
}

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
