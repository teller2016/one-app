// OpenVPN 실행·제어 — CLI를 root 데몬으로 띄우고 management 인터페이스(TCP)로 제어한다.
//
// 흐름: osascript 관리자 인증으로 openvpn --daemon 실행
//   → 127.0.0.1:<랜덤포트> management 소켓 접속 (비밀번호 파일로 보호)
//   → hold release → PASSWORD 질의에 계정/OTP 응답 → STATE 이벤트로 상태 추적
// 연결 해제는 management 로 "signal SIGTERM" 전송.
// 앱을 종료해도 VPN(root 데몬)은 유지되며, 재시작 시 세션 파일로 재접속한다.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import type { VpnStatus } from '../../../shared/types';
import { sleep } from '../../lib/util';
import {
  findOpenvpnBinary,
  logPath,
  mgmtPwPath,
  pidPath,
  sessionPath,
} from './config';
import { getVpnCredentials } from './store';
import { generateTotp, totpRemainingSeconds } from './totp';

type StatusListener = (status: VpnStatus) => void;

let socket: net.Socket | null = null;
let status: VpnStatus = { state: 'disconnected' };
const listeners = new Set<StatusListener>();

let authAttempts = 0; // 이번 연결에서 PASSWORD 질의에 응답한 횟수
let manualOtpOnce: string | null = null; // 수동 입력 OTP (1회용)
let lastSentCode: string | null = null; // 직전에 보낸 TOTP (재시도 시 재사용 방지)
let intentionalExit = false; // 사용자가 해제를 눌러 종료 중인지
let lastDropReason: string | null = null; // RECONNECTING 상태의 실패 사유 (에러 메시지용)

// openvpn 실패 사유 코드 → 한국어 메시지
const DROP_REASONS: Record<string, string> = {
  'connection-failed': 'VPN 서버에 연결할 수 없습니다. 네트워크를 확인하세요.',
  'auth-failure': '인증에 실패했습니다. 계정 이름과 OTP를 확인하세요.',
  'tls-error': 'TLS 협상에 실패했습니다.',
};

// STATE 코드 → 한국어 진행 단계
const STATE_LABELS: Record<string, string> = {
  CONNECTING: '서버 접속 중',
  WAIT: '서버 응답 대기 중',
  AUTH: '인증 중',
  GET_CONFIG: '설정 수신 중',
  ASSIGN_IP: 'IP 할당 중',
  ADD_ROUTES: '라우팅 설정 중',
  RECONNECTING: '재연결 중',
  TCP_CONNECT: '서버 접속 중',
  RESOLVE: '주소 확인 중',
};

export function getVpnStatus(): VpnStatus {
  return status;
}

export function onVpnStatus(listener: StatusListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setStatus(next: VpnStatus) {
  status = next;
  for (const l of listeners) l(next);
}

function send(cmd: string) {
  socket?.write(cmd + '\n');
}

/** management 인자용 이스케이프 — 큰따옴표 문자열 안에서 \ 와 " 처리 */
const mgmtEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** 셸 인자용 single-quote 감싸기 */
const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

// ── management 라인 처리 ─────────────────────────────

function wireSocket(s: net.Socket) {
  let buffer = '';
  s.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    let idx: number;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).replace(/\r$/, '');
      buffer = buffer.slice(idx + 1);
      if (line) void handleLine(line);
    }
  });
  s.on('error', () => {
    /* close 에서 일괄 처리 */
  });
  s.on('close', () => {
    if (socket !== s) return;
    socket = null;
    // 소켓이 닫히면 openvpn 데몬이 종료된 것.
    // 연결 시도 중 죽었으면 마지막 실패 사유를 에러로 보여준다 (에러 상태는 유지)
    if (intentionalExit || status.state === 'disconnected') {
      setStatus({ state: 'disconnected' });
    } else if (status.state !== 'error') {
      if (status.state === 'connecting' && lastDropReason) {
        setStatus({
          state: 'error',
          error:
            DROP_REASONS[lastDropReason] ??
            `연결 실패 (${lastDropReason}) — 로그: ${logPath()}`,
        });
      } else {
        setStatus({ state: 'disconnected' });
      }
    }
    intentionalExit = false;
  });
}

async function handleLine(line: string) {
  if (line.startsWith('>HOLD:')) {
    send('hold release');
    return;
  }
  if (line.startsWith('>PASSWORD:')) {
    await handlePasswordEvent(line);
    return;
  }
  if (line.startsWith('>STATE:')) {
    parseStateLine(line.slice('>STATE:'.length));
    return;
  }
  // "state" 명령 응답 (재접속 시 현재 상태 조회)
  if (/^\d+,[A-Z_]+/.test(line)) {
    parseStateLine(line);
  }
}

function parseStateLine(payload: string) {
  const parts = payload.split(',');
  const state = parts[1];
  if (!state) return;
  if (state === 'CONNECTED') {
    if (parts[2] === 'SUCCESS') {
      manualOtpOnce = null; // 연결 성공 — 1회용 OTP 소모
      setStatus({
        state: 'connected',
        vpnIp: parts[3] || undefined,
        since: Number(parts[0]) * 1000 || Date.now(),
      });
    } else {
      setStatus({ state: 'error', error: `연결 실패 (${parts[2]})` });
    }
    return;
  }
  if (state === 'EXITING') return; // 곧 소켓 close 로 이어짐
  if (state === 'RECONNECTING') lastDropReason = parts[2] || lastDropReason;
  setStatus({ state: 'connecting', detail: STATE_LABELS[state] ?? state });
}

async function handlePasswordEvent(line: string) {
  if (line.includes('Verification Failed')) {
    // auth-retry interact 로 재질의가 오므로, 2회째 실패면 포기
    if (authAttempts >= 2 || manualOtpOnce) {
      failConnection('VPN 인증에 실패했습니다. 계정 이름과 OTP(시크릿 키)를 확인하세요.');
    } else {
      setStatus({ state: 'connecting', detail: '인증 실패 — 새 OTP로 재시도' });
    }
    return;
  }
  if (!line.includes("Need 'Auth'")) return;

  const cred = getVpnCredentials();
  if (!cred?.username) {
    failConnection('VPN 계정 이름이 설정되지 않았습니다.');
    return;
  }
  authAttempts += 1;
  let password: string;
  if (manualOtpOnce) {
    password = manualOtpOnce;
  } else if (cred.totpSecret) {
    password = await freshTotpCode(cred.totpSecret, authAttempts > 1);
  } else {
    failConnection('OTP 시크릿 키가 없습니다. 위젯 설정에서 저장하거나 OTP를 직접 입력하세요.');
    return;
  }
  send(`username "Auth" "${mgmtEscape(cred.username)}"`);
  send(`password "Auth" "${mgmtEscape(password)}"`);
  setStatus({ state: 'connecting', detail: '인증 중' });
}

/**
 * 지금 유효한 TOTP 코드 생성.
 * 만료 직전이면 다음 창까지 대기하고, 재시도면 직전 코드와 다른 코드가 나올 때까지 기다린다.
 */
async function freshTotpCode(secret: string, forceNew: boolean): Promise<string> {
  if (totpRemainingSeconds() <= 3) {
    await sleep((totpRemainingSeconds() + 1) * 1000);
  }
  let code = generateTotp(secret);
  if (forceNew) {
    while (code === lastSentCode) {
      await sleep(1000);
      code = generateTotp(secret);
    }
  }
  lastSentCode = code;
  return code;
}

function failConnection(message: string) {
  setStatus({ state: 'error', error: message });
  send('signal SIGTERM');
}

// ── 소켓 접속 ─────────────────────────────

/** management TCP 소켓에 1회 접속 시도. 성공 시 인증(비밀번호 1줄) 후 전역 socket 으로 등록 */
function connectSocketOnce(port: number, mgmtPw: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = net.createConnection({ host: '127.0.0.1', port });
    s.once('connect', () => {
      socket = s;
      wireSocket(s);
      s.write(mgmtPw + '\n'); // 첫 줄은 management 비밀번호
      resolve();
    });
    s.once('error', (err) => {
      if (socket !== s) reject(err);
    });
  });
}

async function attachManagement(port: number, mgmtPw: string, timeoutMs: number) {
  const start = Date.now();
  for (;;) {
    try {
      await connectSocketOnce(port, mgmtPw);
      send('state on'); // 실시간 상태 알림 켜기
      send('hold release');
      return;
    } catch {
      if (Date.now() - start > timeoutMs) {
        throw new Error(
          `OpenVPN 관리 인터페이스에 연결하지 못했습니다. 로그를 확인하세요: ${logPath()}`,
        );
      }
      await sleep(300);
    }
  }
}

// ── 실행 ─────────────────────────────

/** 사용 가능한 로컬 포트 하나 확보 */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
    server.once('error', reject);
  });
}

/** osascript 관리자 인증으로 openvpn 을 root 데몬으로 실행 */
function launchAsRoot(bin: string, ovpnPath: string, port: number): Promise<void> {
  const cmd = [
    shellQuote(bin),
    '--config', shellQuote(ovpnPath),
    '--cd', shellQuote(path.dirname(ovpnPath)), // ca 등 상대 경로 파일 기준
    '--daemon', 'one-app-vpn',
    '--management', '127.0.0.1', String(port), shellQuote(mgmtPwPath()),
    '--management-hold',
    '--management-query-passwords',
    '--auth-retry', 'interact',
    '--connect-timeout', '15',
    '--connect-retry-max', '2',
    '--log', shellQuote(logPath()),
    '--writepid', shellQuote(pidPath()),
  ].join(' ');
  // AppleScript 문자열 이스케이프 (\ 와 ")
  const escaped = cmd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const script =
    `do shell script "${escaped}" with administrator privileges ` +
    `with prompt "One App이 VPN 연결(OpenVPN 실행)을 위해 관리자 권한이 필요합니다."`;
  return new Promise((resolve, reject) => {
    const child = spawn('osascript', ['-e', script]);
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += String(d)));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve();
      if (/-128|User cancell?ed|취소/i.test(stderr)) {
        reject(new Error('관리자 인증이 취소되었습니다.'));
      } else {
        reject(new Error(`OpenVPN 실행 실패: ${stderr.trim() || `exit ${code}`}`));
      }
    });
  });
}

/** status 가 connected 가 될 때까지 대기. error/disconnected 로 끝나면 reject */
function waitForConnected(timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      failConnection('연결 시간이 초과되었습니다.');
      reject(new Error('연결 시간이 초과되었습니다.'));
    }, timeoutMs);
    const off = onVpnStatus((st) => {
      if (st.state === 'connected') {
        cleanup();
        resolve();
      } else if (st.state === 'error') {
        cleanup();
        reject(new Error(st.error ?? '연결에 실패했습니다.'));
      } else if (st.state === 'disconnected') {
        cleanup();
        reject(new Error('OpenVPN 이 예기치 않게 종료되었습니다.'));
      }
    });
    const cleanup = () => {
      clearTimeout(timer);
      off();
    };
  });
}

/** VPN 연결 시작. manualOtp 가 있으면 저장된 시크릿 대신 그 코드를 사용 */
export async function connectVpn(ovpnPath: string, manualOtp?: string): Promise<void> {
  if (status.state === 'connected' || status.state === 'connecting') {
    throw new Error('이미 연결 중이거나 연결되어 있습니다.');
  }
  // 앱 재시작 등으로 데몬이 살아있으면 재실행하지 않고 재접속
  if (await tryReattachVpn()) {
    if (getVpnStatus().state === 'connected') return;
  }
  const bin = findOpenvpnBinary();
  if (!bin) {
    throw new Error('openvpn CLI가 없습니다. 터미널에서 `brew install openvpn` 실행 후 다시 시도하세요.');
  }
  if (!ovpnPath || !fs.existsSync(ovpnPath)) {
    throw new Error('.ovpn 설정 파일을 찾을 수 없습니다. 위젯 설정에서 파일을 선택하세요.');
  }

  authAttempts = 0;
  lastSentCode = null;
  lastDropReason = null;
  manualOtpOnce = manualOtp?.trim() || null;
  intentionalExit = false;

  const port = await findFreePort();
  const mgmtPw = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(mgmtPwPath(), mgmtPw + '\n', { mode: 0o600 });
  fs.writeFileSync(sessionPath(), JSON.stringify({ port }), { mode: 0o600 });

  setStatus({ state: 'connecting', detail: '관리자 인증 대기 중' });
  try {
    await launchAsRoot(bin, ovpnPath, port);
    setStatus({ state: 'connecting', detail: 'OpenVPN 시작 중' });
    await attachManagement(port, mgmtPw, 12_000);
    await waitForConnected(60_000);
  } catch (err) {
    if (getVpnStatus().state !== 'error') {
      setStatus({ state: 'error', error: (err as Error).message });
    }
    throw err;
  }
}

/** 연결 해제 — management 로 SIGTERM 을 보내고 종료를 기다린다 */
export async function disconnectVpn(): Promise<void> {
  if (!socket) {
    setStatus({ state: 'disconnected' });
    return;
  }
  intentionalExit = true;
  send('signal SIGTERM');
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      socket?.destroy();
      resolve();
    }, 5000);
    const off = onVpnStatus((st) => {
      if (st.state === 'disconnected') {
        clearTimeout(timer);
        off();
        resolve();
      }
    });
  });
}

/**
 * 이전 세션의 openvpn 데몬에 재접속 시도 (앱 재시작 후 상태 복원).
 * 데몬이 없으면 false.
 */
export async function tryReattachVpn(): Promise<boolean> {
  if (socket) return true;
  let port: number;
  let mgmtPw: string;
  try {
    port = (JSON.parse(fs.readFileSync(sessionPath(), 'utf8')) as { port: number }).port;
    mgmtPw = fs.readFileSync(mgmtPwPath(), 'utf8').trim();
    if (!port || !mgmtPw) return false;
  } catch {
    return false;
  }
  try {
    await connectSocketOnce(port, mgmtPw);
  } catch {
    return false;
  }
  send('state on');
  send('state'); // 현재 상태 1회 조회 — 응답 라인은 handleLine 에서 파싱
  // 상태 응답이 도착할 시간을 잠깐 준다
  await sleep(500);
  return true;
}
