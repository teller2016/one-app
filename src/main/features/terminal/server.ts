// MO(모바일) 접속 서버 — node:http 정적 서빙 + ws 터미널 브리지.
// 네트워크 도달·암호화는 Tailscale 이 담당하고, 앱 차원에선 토큰으로 인증한다
// (쿼리스트링 1회 → HttpOnly 쿠키 승격). 데스크톱과 모바일은 같은 PTY 세션을 공유한다.
import { WebSocketServer } from 'ws';
import type WebSocket from 'ws';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import type {
  TermClientMsg,
  TermServerMsg,
  TermWorkspaceNode,
} from '../../../shared/terminal-protocol';
import type { TerminalServerStatus } from '../../../shared/types';
import { listProjects } from '../projects/store';
import { listWorktrees } from '../workspaces/git';
import { listPresets, listWorkspaces } from '../workspaces/store';
import { listAgents } from './agents';
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
import { attachRpcSocket, startRpcBridge, stopRpcBridge } from './rpc';
import { getOrCreateToken, getPort } from './store';
import { ensureTls } from './tls';

const COOKIE_NAME = 'oneAppTerm';
// 쿠키 수명 1년 — 만료를 안 주면 세션 쿠키가 되어 브라우저를 닫을 때 사라지고,
// 그러면 폰에서 매번 QR 을 다시 찍어야 한다(홈 화면 아이콘도 인증이 끊긴다).
const COOKIE_MAX_AGE_SEC = 365 * 24 * 60 * 60;
const WS_PATH = '/term'; // 터미널 전용 upgrade 경로 — dev 모드 Vite HMR ws 와 구분
const RPC_PATH = '/rpc'; // 폰 앱 셸의 IPC 중계 (rpc.ts)
const TERMINAL_PREFIX = '/terminal'; // 터미널 페이지 (`/` 는 폰 앱 셸이 쓴다)
const PING_INTERVAL_MS = 30_000;

let server: http.Server | https.Server | null = null;
// HTTPS 로 떴을 때의 도메인 — 인증서가 그 이름으로만 유효하므로 접속 URL 도 이 이름을 쓴다
let tlsDomain: string | null = null;
let wss: WebSocketServer | null = null;
let rpcWss: WebSocketServer | null = null; // stopServer 에서 함께 닫는다 (누수 방지)
let pingTimer: NodeJS.Timeout | null = null;
let certTimer: NodeJS.Timeout | null = null;
let offPty: Array<() => void> = []; // pty 구독 해제 목록
let lastError = '';

// 소켓별 상태 — attach 된 세션에만 출력을 전달한다
// kind — /term(터미널 페이지)과 /rpc(폰 앱 셸)를 한 맵에서 ping 으로 함께 관리하되,
// 터미널 전용 방송(세션 목록 등)이 앱 셸 소켓으로 새지 않게 구분한다(2026-08-07 감사).
const socketState = new Map<
  WebSocket,
  { attachedId: string | null; alive: boolean; kind: 'term' | 'rpc' }
>();

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
// 앱 셸(`/`)과 터미널(`/terminal/`)이 각자 manifest·아이콘을 가진다(홈 화면 아이콘 각각).
const PUBLIC_FILES = new Set(['manifest.webmanifest', 'icon-192.png', 'icon-512.png']);
const isPublicPath = (pathname: string) =>
  PUBLIC_FILES.has(path.basename(pathname));

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

/**
 * 정적 서빙 — 엔트리 두 개(앱 셸 `/`, 터미널 `/terminal/`)를 경로로 분기한다.
 * @param viteName 렌더러 빌드 폴더명 (`MOBILE_APP_WINDOW_VITE_NAME` 등)
 * @param stripPrefix URL 접두어 제거 (`/terminal`) — ⚠️ normalize 전에 벗겨야 탈출 방어가 유효
 */
function serveStatic(
  pathname: string,
  res: http.ServerResponse,
  extraHeaders: Record<string, string>,
  viteName: string,
  stripPrefix = ''
) {
  // Electron main 의 fs 는 asar 투명 접근 — 패키징에서도 그대로 읽힌다
  const rootDir = path.join(__dirname, '../renderer', viteName);
  const raw = stripPrefix ? pathname.slice(stripPrefix.length) : pathname;
  const rel = raw === '' || raw === '/' ? 'index.html' : raw.replace(/^\/+/, '');
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
  extraHeaders: Record<string, string>,
  devServerUrl: string
) {
  // dev 전용 — Vite 모듈 경로·쿼리를 그대로 넘기되 토큰만 제거 (HMR ws 는 미지원, 무해).
  // 각 엔트리의 base 와 경로가 일치하므로 접두어는 벗기지 않고 그대로 전달한다.
  const url = new URL(req.url ?? '/', 'http://local');
  url.searchParams.delete('token');
  const target = new URL(url.pathname + url.search, devServerUrl);
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
  // 터미널 프로토콜 메시지는 /term 소켓에게만 — 앱 셸(/rpc)은 처리 분기가 없어
  // 버리기만 하므로 보내면 셀룰러 데이터·배터리 순손실이다
  for (const [ws, state] of socketState) {
    if (state.kind === 'term') send(ws, msg);
  }
}

/** MO 작업 영역 시트용 트리 — 데스크톱 LNB 와 같은 출처(워크스페이스 레지스트리 + git) */
async function buildWorkspaceTree(): Promise<TermWorkspaceNode[]> {
  return Promise.all(
    listWorkspaces().map(async (ws) => {
      let worktrees: TermWorkspaceNode['worktrees'] = [];
      try {
        worktrees = (await listWorktrees(ws.repoPath))
          .filter((wt) => !wt.missing)
          .map((wt) => ({
            path: wt.path,
            // 데스크톱 worktreeName 과 같은 규칙 — 주 워크트리는 'local', 그 외 폴더명
            name: wt.isMain ? 'local' : (wt.path.split('/').filter(Boolean).pop() ?? wt.path),
            branch: wt.branch,
            isMain: wt.isMain,
          }));
      } catch {
        // 저장소가 사라졌거나 git 실패 — 워크스페이스는 남기고 목록만 비운다
      }
      return { id: ws.id, name: ws.name, worktrees };
    })
  );
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
    case 'agents':
      void listAgents().then((items) => send(ws, { type: 'agents', items }));
      break;
    case 'workspaces':
      // 데스크톱 LNB 와 같은 트리 — 워크스페이스마다 git 을 부르므로 **요청 시에만**
      // 만든다(접속 때 미리 밀면 워크스페이스 수만큼 git 이 도는데, 폰이 시트를
      // 열지 않으면 통째로 헛일이다). 사라진 워크트리는 고를 수 없으니 뺀다.
      void buildWorkspaceTree().then((items) =>
        send(ws, { type: 'workspaces', items })
      );
      break;
    case 'presets':
      send(ws, { type: 'presets', items: listPresets() });
      break;
    case 'attach': {
      const attachId = msg.id;
      const { cols, rows } = msg;
      void attachSession(attachId, cols, rows).then((res) => {
        if (!res.ok) {
          send(ws, { type: 'error', message: res.error ?? 'attach 실패' });
          return;
        }
        // attachedId 는 attach 스냅샷 이후에 설정 — 스냅샷에 포함된 flush 가
        // 이 소켓으로 이중 전달(라이브 data + replay)되는 것을 막는다.
        // (attachSession 내부 await 중의 flush 는 스냅샷 seq 에 포함되므로,
        // 스냅샷→여기(마이크로태스크) 사이에 끼어들 flush 는 없다 — 유실 없음)
        state.attachedId = attachId;
        send(ws, {
          type: 'attached',
          id: attachId,
          replay: res.replay ?? '',
          seq: res.seq ?? 0,
          cols: res.cols ?? 0,
          rows: res.rows ?? 0,
        });
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
      const info = createSession({
        cwd: msg.cwd,
        agentId: msg.agentId,
        command: msg.command, // 프리셋 실행 — 있으면 에이전트 기본 명령 대신 이걸 보낸다
        title: msg.title,
        // 클라이언트가 크기를 주면 그대로 — 뒤따라오는 attach 가 리사이즈를 일으키지
        // 않아야 자동 실행 명령이 SIGWINCH 재출력과 겹치지 않는다
        cols: msg.cols,
        rows: msg.rows,
      });
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

  // Tailscale 인증서가 있으면 HTTPS — 그래야 폰에서 설치형 PWA(주소창 없음)가 되고
  // secure context 로 클립보드·wss 가 정상 동작한다. 없으면 기존처럼 HTTP.
  const tls = await ensureTls();
  tlsDomain = tls?.domain ?? null;

  const handler: http.RequestListener = (req, res) => {
    const url = new URL(req.url ?? '/', 'http://local');
    if (!isPublicPath(url.pathname) && !isAuthed(req)) {
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
    // 엔트리 분기 — `/terminal*` 은 터미널 페이지, 그 외는 폰 앱 셸.
    // 각 엔트리의 Vite `base` 와 경로가 같아 asset(`/assets/*` vs `/terminal/assets/*`)이 안 겹친다.
    const isTerminal =
      url.pathname === TERMINAL_PREFIX ||
      url.pathname.startsWith(`${TERMINAL_PREFIX}/`);
    if (isTerminal) {
      if (MOBILE_WINDOW_VITE_DEV_SERVER_URL) {
        proxyToDevServer(req, res, extraHeaders, MOBILE_WINDOW_VITE_DEV_SERVER_URL);
      } else {
        serveStatic(
          url.pathname,
          res,
          extraHeaders,
          MOBILE_WINDOW_VITE_NAME,
          TERMINAL_PREFIX
        );
      }
    } else if (MOBILE_APP_WINDOW_VITE_DEV_SERVER_URL) {
      proxyToDevServer(req, res, extraHeaders, MOBILE_APP_WINDOW_VITE_DEV_SERVER_URL);
    } else {
      serveStatic(url.pathname, res, extraHeaders, MOBILE_APP_WINDOW_VITE_NAME);
    }
  };

  const srv = tls
    ? https.createServer(
        { cert: fs.readFileSync(tls.cert), key: fs.readFileSync(tls.key) },
        handler
      )
    : http.createServer(handler);

  // 인증서 자동 갱신 — Tailscale 인증서는 90일이고 앱은 몇 달 켜져 있을 수 있다.
  // 재시작 없이 교체할 수 있도록 setSecureContext 로 갈아끼운다(하루 1회 확인).
  if (tls) {
    const httpsSrv = srv as https.Server;
    certTimer = setInterval(
      () => {
        void ensureTls().then((next) => {
          if (!next) return;
          try {
            httpsSrv.setSecureContext({
              cert: fs.readFileSync(next.cert),
              key: fs.readFileSync(next.key),
            });
          } catch {
            // 갱신 실패는 다음 확인에서 재시도 (기존 인증서로 계속 동작)
          }
        });
      },
      24 * 60 * 60 * 1000
    );
  }

  const wsServer = new WebSocketServer({ noServer: true });
  const rpcServer = new WebSocketServer({ noServer: true });
  srv.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://local');
    const target =
      url.pathname === WS_PATH ? wsServer : url.pathname === RPC_PATH ? rpcServer : null;
    if (!target || !isAuthed(req)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    target.handleUpgrade(req, socket, head, (ws) => target.emit('connection', ws));
  });

  // 폰 앱 셸의 RPC — 데스크톱과 같은 IPC 핸들러를 호출한다 (rpc.ts)
  startRpcBridge();
  rpcServer.on('connection', (ws: WebSocket) => {
    socketState.set(ws, { attachedId: null, alive: true, kind: 'rpc' }); // ping 루프 공용
    ws.on('pong', () => {
      const st = socketState.get(ws);
      if (st) st.alive = true;
    });
    ws.on('close', () => socketState.delete(ws));
    attachRpcSocket(ws);
  });

  wsServer.on('connection', (ws: WebSocket) => {
    socketState.set(ws, { attachedId: null, alive: true, kind: 'term' });
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
    void listAgents().then((items) => send(ws, { type: 'agents', items }));
    // 프리셋은 파일 한 번 읽기라 미리 보낸다 — 폰이 붙자마자 ⚡ 버튼을 쓸 수 있게.
    // (workspaces 는 git 을 돌리므로 시트를 열 때만 — 위 handleMessage 참고)
    send(ws, { type: 'presets', items: listPresets() });
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
    const onListenError = (err: NodeJS.ErrnoException) => {
      lastError =
        err.code === 'EADDRINUSE'
          ? `포트 ${getPort()} 가 이미 사용 중입니다.`
          : err.message;
      server = null;
      wss = null;
      rpcWss = null;
      if (pingTimer) clearInterval(pingTimer);
      if (certTimer) clearInterval(certTimer);
      offPty.forEach((off) => off());
      offPty = [];
      stopRpcBridge();
      wsServer.close();
      rpcServer.close();
      resolve();
    };
    srv.once('error', onListenError);
    srv.listen(getPort(), '0.0.0.0', () => {
      // listen 성공 후엔 위 정리 핸들러를 떼어낸다 — 남겨두면 런타임 에러 한 번에
      // server=null 이 되면서 실제 소켓은 계속 listen 하는 유령 상태가 된다
      srv.removeListener('error', onListenError);
      srv.on('error', (err) => console.error('[terminal-server]', err));
      resolve();
    });
  });

  if (!lastError) {
    server = srv;
    wss = wsServer;
    rpcWss = rpcServer;
  }
  emit();
  return getServerStatus();
}

export async function stopServer(): Promise<void> {
  if (!server) return;
  if (pingTimer) clearInterval(pingTimer);
  pingTimer = null;
  if (certTimer) clearInterval(certTimer);
  certTimer = null;
  offPty.forEach((off) => off());
  offPty = [];
  stopRpcBridge();
  for (const ws of socketState.keys()) ws.terminate();
  socketState.clear();
  wss?.close();
  wss = null;
  rpcWss?.close();
  rpcWss = null;
  const srv = server;
  server = null;
  await new Promise<void>((resolve) => srv.close(() => resolve()));
  emit();
}

/**
 * 접속 URL 후보 — 토큰 포함 (QR·복사용).
 * HTTPS 로 떴으면 **인증서 도메인(MagicDNS 이름) 하나만** 준다 — IP 로 접속하면 인증서
 * 이름이 안 맞아 경고가 뜨고, 그러면 설치형 PWA 조건도 깨진다.
 * HTTP 폴백일 때는 예전처럼 Tailscale IP(100.64.0.0/10) 우선으로 정렬한다.
 */
function accessUrls(pagePath = '/'): string[] {
  const token = getOrCreateToken();
  const port = getPort();
  if (tlsDomain) {
    return [`https://${tlsDomain}:${port}${pagePath}?token=${token}`];
  }
  const addrs: { ip: string; ts: boolean }[] = [];
  for (const infos of Object.values(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      const ts = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(info.address);
      addrs.push({ ip: info.address, ts });
    }
  }
  addrs.sort((a, b) => Number(b.ts) - Number(a.ts));
  return addrs.map((a) => `http://${a.ip}:${port}${pagePath}?token=${token}`);
}

export function getServerStatus(): TerminalServerStatus {
  const running = !!server?.listening;
  return {
    running,
    port: getPort(),
    urls: running ? accessUrls('/') : [], // 폰 앱 셸 (기본 진입점)
    terminalUrls: running ? accessUrls(`${TERMINAL_PREFIX}/`) : [], // 터미널 페이지
    error: lastError || undefined,
  };
}
