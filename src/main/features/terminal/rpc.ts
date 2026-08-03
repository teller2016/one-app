// MO(폰) 앱 셸용 RPC 브리지 — 폰의 `window.oneApp` shim 이 이 WS 로 IPC 채널을 호출한다.
// 핸들러는 데스크톱과 **같은 함수**를 쓴다(`lib/moIpc.ts` 의 handleShared 레지스트리).
// 서버 수명·인증·ping 은 같은 HTTP 서버를 쓰는 `server.ts` 가 관리하고, 여기서는 소켓만 다룬다.
import type WebSocket from 'ws';
import type { MoClientMsg, MoServerMsg } from '../../../shared/mo-protocol';
import { onBroadcast } from '../../lib/broadcast';
import { callShared } from '../../lib/moIpc';

// 소켓별 구독 채널 — 폰이 실제로 구독한 것만 보낸다(불필요한 트래픽·배터리 절약)
const sockets = new Map<WebSocket, Set<string>>();

let offBroadcast: (() => void) | null = null;

const send = (ws: WebSocket, msg: MoServerMsg) => {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
};

async function handleCall(ws: WebSocket, msg: Extract<MoClientMsg, { type: 'call' }>) {
  try {
    const result = await callShared(msg.channel, msg.args);
    send(ws, { type: 'result', id: msg.id, ok: true, result });
  } catch (err) {
    send(ws, { type: 'result', id: msg.id, ok: false, error: (err as Error).message });
  }
}

/** WS 연결 등록 — server.ts 의 upgrade 핸들러가 호출 */
export function attachRpcSocket(ws: WebSocket): void {
  sockets.set(ws, new Set());

  ws.on('message', (raw) => {
    let msg: MoClientMsg;
    try {
      msg = JSON.parse(String(raw)) as MoClientMsg;
    } catch {
      return; // 형식이 안 맞는 프레임은 무시
    }
    const subs = sockets.get(ws);
    if (!subs) return;
    switch (msg.type) {
      case 'call':
        void handleCall(ws, msg);
        break;
      case 'subscribe':
        subs.add(msg.channel);
        break;
      case 'unsubscribe':
        subs.delete(msg.channel);
        break;
    }
  });

  ws.on('close', () => sockets.delete(ws));
}

/**
 * broadcast → **구독한** 폰 소켓으로만 전달 (서버 시작 시 1회).
 * 구독 단위로 걸러야 하는 이유: broadcast 에는 `terminal:data` 같은 고빈도 채널이 섞여 있고,
 * 그건 이미 `/term` 소켓이 따로 받고 있다. 폰이 구독하지 않은 채널은 여기서 버린다.
 */
export function startRpcBridge(): void {
  if (offBroadcast) return;
  offBroadcast = onBroadcast((channel, args) => {
    if (sockets.size === 0) return; // 폰이 안 붙어 있으면 즉시 빠져나온다(고빈도 채널 낭비 방지)
    for (const [ws, subs] of sockets) {
      if (subs.has(channel)) send(ws, { type: 'event', channel, args });
    }
  });
}

/** 서버 중지 시 정리 */
export function stopRpcBridge(): void {
  offBroadcast?.();
  offBroadcast = null;
  for (const ws of sockets.keys()) ws.terminate();
  sockets.clear();
}

/** 죽은 소켓 회수용 — server.ts 의 ping 루프가 함께 관리한다 */
export function rpcSockets(): WebSocket[] {
  return [...sockets.keys()];
}
