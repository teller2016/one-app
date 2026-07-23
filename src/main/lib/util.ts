// 마이크로 헬퍼 — 여러 기능 모듈이 각자 정의하던 것을 단일화
export const sleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));

/** 로컬 기준 날짜 키 (예: "2026-7-23") — 하루 단위 상태 초기화 판정용 */
export const localDateKey = (d: Date) =>
  `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
