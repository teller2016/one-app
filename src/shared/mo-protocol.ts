// MO(폰) 앱 셸 ↔ main RPC 프로토콜 — `rpc.ts`(main) 와 `mobile-app/shim.ts`(브라우저) 공용.
// 폰 셸은 preload 가 없어 `window.oneApp` 이 없다. 그래서 이 WS 로 IPC 채널을 그대로 중계하고,
// 셸이 같은 모양의 `window.oneApp` 을 만들어 기능 화면(`features/*`)을 무수정으로 재사용한다.

/** 클라이언트(폰) → main */
export type MoClientMsg =
  /** IPC invoke 대행 — id 로 응답을 상관관계 매칭한다 */
  | { type: 'call'; id: number; channel: string; args: unknown[] }
  /** 이벤트 구독 시작/해제 (channel 단위, 소켓별로 관리) */
  | { type: 'subscribe'; channel: string }
  | { type: 'unsubscribe'; channel: string };

/** main → 클라이언트(폰) */
export type MoServerMsg =
  /** call 응답 — ⚠️ 타임아웃 없음(근태 조회 수십 초, 분석 수 분짜리 채널이 있다) */
  | { type: 'result'; id: number; ok: true; result: unknown }
  | { type: 'result'; id: number; ok: false; error: string }
  /** 구독 중인 채널의 push (main 의 broadcast 를 그대로 전달) */
  | { type: 'event'; channel: string; args: unknown[] };
