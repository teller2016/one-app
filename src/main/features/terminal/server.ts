// MO(모바일) 접속 서버 — node:http 정적 서빙 + ws 터미널 브리지.
// 네트워크 도달·암호화는 Tailscale 이 담당하고, 앱 차원에선 토큰으로 인증한다
// (쿼리스트링 1회 → HttpOnly 쿠키 승격). 데스크톱과 모바일은 같은 PTY 세션을 공유한다.
import { WebSocketServer } from 'ws';
import type WebSocket from 'ws';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type {
  TermClientMsg,
  TermServerMsg,
} from '../../../shared/terminal-protocol';
import type { TerminalServerStatus } from '../../../shared/types';
import { listProjects } from '../projects/store';
import {
  attachSession,
  createSession,
  killSession,
  listSessions,
  onPtyResized,
  onSessionsChanged,
  onTerminalData,
  onTerminalExit,
  resizeSession,
  writeSession,
} from './pty';
import { getOrCreateToken, getPort } from './store';

const COOKIE_NAME = 'oneAppTerm';
// 쿠키 수명 1년 — 만료를 안 주면 세션 쿠키가 되어 브라우저를 닫을 때 사라지고,
// 그러면 폰에서 매번 QR 을 다시 찍어야 한다(홈 화면 아이콘도 인증이 끊긴다).
const COOKIE_MAX_AGE_SEC = 365 * 24 * 60 * 60;
const WS_PATH = '/term'; // 터미널 전용 upgrade 경로 — dev 모드 Vite HMR ws 와 구분
const PING_INTERVAL_MS = 30_000;

let server: http.Server | null = null;
let wss: WebSocketServer | null = null;
let pingTimer: NodeJS.Timeout | null = null;
let offPty: Array<() => void> = []; // pty 구독 해제 목록
let lastError = '';

// 소켓별 상태 — attach 된 세션에만 출력을 전달한다
const socketState = new Map<WebSocket, { attachedId: string | null; alive: boolean }>();

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((cb) => cb());
/** 서버 시작/중지 구독. 해제 함수 반환 */
export function onServerChanged(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// ── 인증 ──

function timingEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

// 홈 화면 추가 시 브라우저는 manifest·아이콘을 쿠키 없이 받아갈 수 있다(스펙상 credentials
// 모드가 다름) — 비밀이 없는 이 파일들만 인증에서 제외한다. 앱 화면(index.html)은 그대로 보호.
const PUBLIC_PATHS = new Set(['/manifest.webmanifest', '/icon-192.png', '/icon-512.png']);

function isAuthed(req: http.IncomingMessage): boolean {
  const token = getOrCreateToken();
  const url = new URL(req.url ?? '/', 'http://local');
  const q = url.searchParams.get('token');
  if (q && timingEqual(q, token)) return true;
  const m = (req.headers.cookie ?? '').match(
    new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`)
  );
  return !!m && timingEqual(decodeURIComponent(m[1]), token);
}

// ── 정적 서빙 (prod: asar 안 mobile_window 빌드 / dev: Vite dev 서버 프록시) ──

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function serveStatic(
  pathname: string,
  res: http.ServerResponse,
  extraHeaders: Record<string, string>
) {
  // Electron main 의 fs 는 asar 투명 접근 — 패키징에서도 그대로 읽힌다
  const rootDir = path.join(__dirname, '../renderer', MOBILE_WINDOW_VITE_NAME);
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.normalize(path.join(rootDir, rel));
  if (!filePath.startsWith(rootDir)) {
    res.writeHead(400);
    res.end();
    return;
  }
  try {
    const buf = fs.readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    });
    res.end(buf);
  } catch {
    res.writeHead(404, extraHeaders);
    res.end('Not Found');
  }
}

function proxyToDevServer(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  extraHeaders: Record<string, string>
) {
  // dev 전용 — Vite 모듈 경로·쿼리를 그대로 넘기되 토큰만 제거 (HMR ws 는 미지원, 무해)
  const url = new URL(req.url ?? '/', 'http://local');
  url.searchParams.delete('token');
  const target = new URL(
    url.pathname + url.search,
    MOBILE_WINDOW_VITE_DEV_SERVER_URL
  );
  http
    .get(target, (up) => {
      res.writeHead(up.statusCode ?? 500, { ...up.headers, ...extraHeaders });
      up.pipe(res);
    })
    .on('error', () => {
      res.writeHead(502, extraHeaders);
      res.end('dev server unreachable');
    });
}

// ── WS 브리지 ──

function send(ws: WebSocket, msg: TermServerMsg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function sendToAttached(id: string, msg: TermServerMsg) {
  for (const [ws, state] of socketState) {
    if (state.attachedId === id) send(ws, msg);
  }
}

function broadcastAll(msg: TermServerMsg) {
  for (const ws of socketState.keys()) send(ws, msg);
}

function handleMessage(ws: WebSocket, msg: TermClientMsg) {
  const state = socketState.get(ws);
  if (!state) return;
  switch (msg.type) {
    case 'list':
      send(ws, { type: 'sessions', sessions: listSessions() });
      break;
    case 'cwds':
      // 새 세션 위치 후보 — 데스크톱과 같은 출처(프로젝트 중앙 레지스트리)
      send(ws, {
        type: 'cwds',
        items: listProjects().map((p) => ({ name: p.name, path: p.localPath })),
      });
      break;
    case 'attach': {
      const res = attachSession(msg.id, msg.cols, msg.rows);
      if (!res.ok) {
        send(ws, { type: 'error', message: res.error ?? 'attach 실패' });
        break;
      }
      // attachedId 는 attach 스냅샷 이후에 설정 — 스냅샷에 포함된 flush 가
      // 이 소켓으로 이중 전달(라이브 data + replay)되는 것을 막는다
      state.attachedId = msg.id;
      send(ws, {
        type: 'attached',
        id: msg.id,
        replay: res.replay ?? '',
        seq: res.seq ?? 0,
        cols: res.cols ?? 0,
        rows: res.rows ?? 0,
      });
      break;
    }
    case 'detach':
      state.attachedId = null;
      break;
    case 'input':
      if (state.attachedId) writeSession(state.attachedId, msg.data);
      break;
    case 'resize':
      if (state.attachedId)
        resizeSession(state.attachedId, msg.cols, msg.rows);
      break;
    case 'create': {
      const info = createSession({ cwd: msg.cwd });
      send(ws, { type: 'created', id: info.id });
      break;
    }
    case 'kill':
      killSession(msg.id);
      break;
  }
}

// ── 서버 수명 ──

export async function startServer(): Promise<TerminalServerStatus> {
  if (server) return getServerStatus();
  lastError = '';

  const srv = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://local');
    if (!PUBLIC_PATHS.has(url.pathname) && !isAuthed(req)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden — One App 터미널 탭의 접속 URL(QR)로 여세요.');
      return;
    }
    const extraHeaders: Record<string, string> = {};
    if (url.searchParams.get('token')) {
      // 첫 진입(토큰 쿼리)을 쿠키로 승격 — 이후엔 토큰 없는 주소(북마크·홈 화면 아이콘)로도 인증
      extraHeaders['Set-Cookie'] =
        `${COOKIE_NAME}=${encodeURIComponent(getOrCreateToken())}; HttpOnly; SameSite=Lax; ` +
        `Path=/; Max-Age=${COOKIE_MAX_AGE_SEC}`;
    }
    if (MOBILE_WINDOW_VITE_DEV_SERVER_URL) {
      proxyToDevServer(req, res, extraHeaders);
    } else {
      serveStatic(url.pathname, res, extraHeaders);
    }
  });

  const wsServer = new WebSocketServer({ noServer: true });
  srv.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://local');
    if (url.pathname !== WS_PATH || !isAuthed(req)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    wsServer.handleUpgrade(req, socket, head, (ws) =>
      wsServer.emit('connection', ws)
    );
  });

  wsServer.on('connection', (ws: WebSocket) => {
    socketState.set(ws, { attachedId: null, alive: true });
    ws.on('pong', () => {
      const st = socketState.get(ws);
      if (st) st.alive = true;
    });
    ws.on('message', (raw) => {
      let msg: TermClientMsg;
      try {
        msg = JSON.parse(String(raw)) as TermClientMsg;
      } catch {
        return;
      }
      handleMessage(ws, msg);
    });
    ws.on('close', () => socketState.delete(ws));
    send(ws, { type: 'sessions', sessions: listSessions() });
    send(ws, {
      type: 'cwds',
      items: listProjects().map((p) => ({ name: p.name, path: p.localPath })),
    });
  });

  // PTY 이벤트 → attach 된 소켓으로 전달 (세션 목록은 전체 브로드캐스트)
  offPty = [
    onTerminalData((id, data, seq) => sendToAttached(id, { type: 'data', id, data, seq })),
    onTerminalExit((id, exitCode) => {
      sendToAttached(id, { type: 'exit', id, exitCode });
      for (const state of socketState.values()) {
        if (state.attachedId === id) state.attachedId = null;
      }
    }),
    onPtyResized((id, cols, rows) => sendToAttached(id, { type: 'resized', id, cols, rows })),
    onSessionsChanged(() => broadcastAll({ type: 'sessions', sessions: listSessions() })),
  ];

  // 죽은 소켓 정리 — 폰 잠금·이동 등으로 소리 없이 끊긴 연결 회수
  pingTimer = setInterval(() => {
    for (const [ws, state] of socketState) {
      if (!state.alive) {
        ws.terminate();
        socketState.delete(ws);
        continue;
      }
      state.alive = false;
      ws.ping();
    }
  }, PING_INTERVAL_MS);

  await new Promise<void>((resolve) => {
    srv.once('error', (err: NodeJS.ErrnoException) => {
      lastError =
        err.code === 'EADDRINUSE'
          ? `포트 ${getPort()} 가 이미 사용 중입니다.`
          : err.message;
      server = null;
      wss = null;
      if (pingTimer) clearInterval(pingTimer);
      offPty.forEach((off) => off());
      offPty = [];
      resolve();
    });
    srv.listen(getPort(), '0.0.0.0', () => resolve());
  });

  if (!lastError) {
    server = srv;
    wss = wsServer;
  }
  emit();
  return getServerStatus();
}

export async function stopServer(): Promise<void> {
  if (!server) return;
  if (pingTimer) clearInterval(pingTimer);
  pingTimer = null;
  offPty.forEach((off) => off());
  offPty = [];
  for (const ws of socketState.keys()) ws.terminate();
  socketState.clear();
  wss?.close();
  wss = null;
  const srv = server;
  server = null;
  await new Promise<void>((resolve) => srv.close(() => resolve()));
  emit();
}

/** 접속 URL 후보 — Tailscale IP(100.64.0.0/10) 우선, 토큰 포함 (QR·복사용) */
function accessUrls(): string[] {
  const token = getOrCreateToken();
  const port = getPort();
  const addrs: { ip: string; ts: boolean }[] = [];
  for (const infos of Object.values(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      const ts = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(info.address);
      addrs.push({ ip: info.address, ts });
    }
  }
  addrs.sort((a, b) => Number(b.ts) - Number(a.ts));
  return addrs.map((a) => `http://${a.ip}:${port}/?token=${token}`);
}

export function getServerStatus(): TerminalServerStatus {
  const running = !!server?.listening;
  return {
    running,
    port: getPort(),
    urls: running ? accessUrls() : [],
    error: lastError || undefined,
  };
}
