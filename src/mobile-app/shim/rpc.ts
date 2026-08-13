// 폰 앱 셸의 전송층 — main 의 `/rpc` 와 WS 로 붙어 IPC 호출·이벤트를 중계한다.
// 재접속 전략은 터미널 MO 페이지(`src/mobile/mobile.ts`)에서 검증된 것을 그대로 쓴다:
// 1→2→4→5초 백오프 · stale 소켓 가드 · visibilitychange 즉시 재연결.
import type { MoClientMsg, MoServerMsg } from '../../shared/mo-protocol';

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
};

let ws: WebSocket | null = null;
let reconnectDelay = 1000;
let nextId = 1;

const pending = new Map<number, Pending>();
/** 채널별 리스너 — 재접속 시 이 목록으로 구독을 다시 건다 */
const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
/** 연결 전에 호출된 call 은 큐에 담아 두고 연결 직후 흘려보낸다 */
const queue: MoClientMsg[] = [];

const statusListeners = new Set<(connected: boolean) => void>();
let connected = false;

function setConnected(next: boolean) {
  if (connected === next) return;
  connected = next;
  for (const cb of statusListeners) cb(next);
}

/** 연결 상태 구독 (셸의 상태 점 표시용) */
export function onRpcStatus(cb: (connected: boolean) => void): () => void {
  statusListeners.add(cb);
  cb(connected);
  return () => statusListeners.delete(cb);
}

function post(msg: MoClientMsg) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  else queue.push(msg);
}

/** IPC invoke 대행 — ⚠️ 타임아웃을 두지 않는다(근태 조회처럼 수십 초짜리 채널이 있다) */
export function call(channel: string, args: unknown[]): Promise<unknown> {
  const id = nextId++;
  return new Promise<unknown>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    post({ type: 'call', id, channel, args });
  });
}

/** main → 폰 push 구독. 해제 함수를 반환한다(preload 와 같은 규약) */
export function on(channel: string, cb: (...args: unknown[]) => void): () => void {
  let set = listeners.get(channel);
  if (!set) {
    set = new Set();
    listeners.set(channel, set);
    post({ type: 'subscribe', channel });
  }
  set.add(cb);
  return () => {
    set?.delete(cb);
    if (set && set.size === 0) {
      listeners.delete(channel);
      post({ type: 'unsubscribe', channel });
    }
  };
}

function handle(msg: MoServerMsg) {
  if (msg.type === 'result') {
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.ok === true) p.resolve(msg.result);
    else p.reject(new Error(msg.error));
    return;
  }
  for (const cb of listeners.get(msg.channel) ?? []) cb(...msg.args);
}

// 재연결 예약 핸들 — visibilitychange 재연결과 onclose 백오프가 경합해 소켓이
// 이중 생성되면, 먼저 열린 쪽은 `ws !== sock` 가드에 걸려 영영 닫히지 않는
// 유령 소켓이 된다(2026-08-07 성능 감사). connect 진입 시 예약을 지우고,
// 이미 소켓이 있으면(연결 중 포함) 새로 만들지 않는다.
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function connect() {
  if (ws) return;
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  // 스킴은 페이지를 따라간다 — https 페이지에서 ws:// 는 브라우저가 mixed content 로 막는다
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const sock = new WebSocket(`${scheme}://${location.host}/rpc`);
  ws = sock;
  sock.onopen = () => {
    reconnectDelay = 1000;
    setConnected(true);
    // 재접속이면 구독을 다시 걸어야 한다 (서버는 소켓 단위로 구독을 기억한다)
    for (const channel of listeners.keys()) {
      sock.send(JSON.stringify({ type: 'subscribe', channel } satisfies MoClientMsg));
    }
    while (queue.length) sock.send(JSON.stringify(queue.shift()));
  };
  sock.onmessage = (e) => {
    try {
      handle(JSON.parse(String(e.data)) as MoServerMsg);
    } catch {
      // 형식이 안 맞는 프레임은 무시
    }
  };
  sock.onclose = () => {
    if (ws !== sock) return; // 이미 교체된 낡은 소켓
    ws = null;
    setConnected(false);
    // 답을 못 받은 호출은 실패로 정리 — UI 가 재조회하도록(폴링 훅이 이미 그 구조)
    for (const [, p] of pending) p.reject(new Error('연결이 끊겼습니다'));
    pending.clear();
    // ⚠️ 아직 못 보낸 프레임도 함께 버린다 — 남기면 재연결 때 흘러나가 서버에서 뒤늦게
    // 실행되는데, 호출자는 이미 위에서 실패로 처리했다. `/rpc` 에는 부수효과 채널
    // (changes:push·attendance:stamp·deploy:trigger)이 있어 사용자가 실패를 보고 다시
    // 누르면 이중 실행이 된다. 구독은 onopen 이 `listeners` 로 다시 걸므로 잃지 않는다.
    queue.length = 0;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 5000);
  };
  sock.onerror = () => sock.close();
}

export function startRpc(): void {
  connect();
  // 폰 잠금·앱 전환으로 소켓이 죽은 뒤 복귀하면 즉시 재연결
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !ws) {
      reconnectDelay = 1000;
      connect();
    }
  });
}
