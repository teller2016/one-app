// 데스크톱 IPC 와 MO(폰) 브리지가 **같은 핸들러를 공유**하게 하는 등록 헬퍼.
//
// 왜 필요한가: `ipcMain` 에는 등록된 handle 을 main 코드에서 직접 호출하는 공개 API 가 없다
// (handle/on/removeHandler 뿐). 그래서 등록 시점에 함수를 레지스트리에 붙잡아 두고,
// WS 브리지(`features/terminal/rpc.ts`)가 그 함수를 그대로 호출한다 — 로직 중복이 없다.
//
// ⚠️ 핸들러 시그니처에서 `IpcMainInvokeEvent` 를 **의도적으로 제거**했다. MO 요청에는 event 가
// 없으므로, `event.sender` 에 의존하는 핸들러(진행 상황을 호출자에게만 되돌려주는 종류)를
// 실수로 폰에 열 수 없게 타입으로 막는 것이다. 그런 채널은 기존 `ipcMain.handle` 을 그대로 쓰거나
// push 를 `broadcast()` 로 바꿔야 한다.
import { ipcMain } from 'electron';

type SharedHandler = (...args: never[]) => unknown;

export type SharedOptions = {
  /**
   * 폰에서 부르면 감사 기록(`mo-audit.log`)을 남기고 PC 에 알릴 **쓰기 동작의 이름**(예: '배포 실행').
   * 조회 채널에는 달지 않는다 — 폴링이 기록을 덮는다.
   */
  audit?: string;
};

const shared = new Map<string, { fn: SharedHandler; audit?: string }>();

/**
 * 데스크톱 IPC(`ipcMain.handle`)로 등록하면서 **MO 브리지에도 노출**한다.
 * 폰에 열 채널은 이 함수로 등록하는 것 자체가 화이트리스트 선언이다.
 * 상태를 바꾸는 채널(찍기·push·배포·머지 등)은 `{ audit }` 로 이름을 단다.
 */
export function handleShared<A extends unknown[], R>(
  channel: string,
  fn: (...args: A) => R,
  options: SharedOptions = {}
): void {
  ipcMain.handle(channel, (_e, ...args) => fn(...(args as A)));
  shared.set(channel, { fn: fn as unknown as SharedHandler, audit: options.audit });
}

/** MO 에 열려 있는 채널인가 */
export function isSharedChannel(channel: string): boolean {
  return shared.has(channel);
}

/** 감사 대상 쓰기 채널이면 그 동작 이름 */
export function sharedAuditLabel(channel: string): string | undefined {
  return shared.get(channel)?.audit;
}

/** MO 브리지가 채널을 호출한다 — 열려 있지 않으면 throw (브리지가 에러로 응답) */
export async function callShared(
  channel: string,
  args: unknown[]
): Promise<unknown> {
  const entry = shared.get(channel);
  if (!entry) throw new Error(`폰에서 쓸 수 없는 기능입니다 (${channel})`);
  return await (entry.fn as (...a: unknown[]) => unknown)(...args);
}
