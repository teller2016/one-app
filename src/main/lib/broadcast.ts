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
    // 창 파괴 직후 레이스 방어 — 고빈도 채널(terminal:data)은 pty flush 루프 안에서
    // 호출되므로, 여기서 예외가 새면 남은 창·MO 브리지 전파까지 통째로 끊긴다
    if (w.isDestroyed() || w.webContents.isDestroyed()) continue;
    try {
      w.webContents.send(channel, ...args);
    } catch {
      // destroyed 체크 후에도 남는 종료 타이밍 예외 — 무시
    }
  }
  for (const cb of listeners) {
    try {
      cb(channel, args);
    } catch (err) {
      console.error('[broadcast] 리스너 오류:', err);
    }
  }
}
