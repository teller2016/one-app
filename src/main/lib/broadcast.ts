// 모든 렌더러 창에 이벤트 push — 상태 변화 브로드캐스트 공통 헬퍼.
// MO(폰) 클라이언트는 BrowserWindow 가 아니라 WS 소켓이라 창 전송으로는 닿지 않는다.
// 그래서 여기 한 곳에 fan-out 훅을 두고 `features/terminal/rpc.ts` 가 구독한다 —
// 새 push 채널도 broadcast 를 쓰면 폰에 자동으로 전달된다.
import { BrowserWindow } from 'electron';

type BroadcastListener = (channel: string, args: unknown[]) => void;

const listeners = new Set<BroadcastListener>();

/** broadcast 되는 모든 이벤트 구독 (MO 브리지용). 해제 함수를 반환한다. */
export function onBroadcast(cb: BroadcastListener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function broadcast(channel: string, ...args: unknown[]): void {
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send(channel, ...args);
  }
  for (const cb of listeners) cb(channel, args);
}
