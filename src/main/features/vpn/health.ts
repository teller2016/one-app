// VPN 터널 생존 판정 — 순수 규칙(vitest 대상) + 프로브(route get · HTTP HEAD).
//
// 배경(2026-09-07 실측): OpenVPN 은 인터페이스 전환(와이파이→유선)을 감지하지 못한다.
// 연결 시점의 기본 인터페이스로 고정한 서버 우회 경로(`<서버IP>/32 → 그때의 게이트웨이`)가
// 전환 뒤 사라지면 서버 주소가 full-tunnel 경로(`0/1`·`128.0/1` → utun)에 삼켜져
// **터널이 터널 자신을 타는 루프**가 되고, `proto tcp` 소켓은 조용히 멈춘다. 유일한 사망
// 감지인 ping-restart 는 서버가 3600초로 push 해 최대 1시간 "연결됨"이 유지된다.
// 그래서 앱이 직접 확인한다. electron 의존 없음 — 규칙은 health.test.ts 가 검증한다.
import { execFile } from 'node:child_process';
import net from 'node:net';
import type os from 'node:os';
import { fetchWithTimeout } from '../../lib/http';

/** 물리 인터페이스 지문 폴링 주기 — os.networkInterfaces() 비교라 비용은 무시 수준 */
export const IFACE_POLL_MS = 5_000;
/** 인터페이스가 바뀐 뒤 점검까지 기다리는 시간 — DHCP·경로 재구성이 끝날 여유 */
export const IFACE_SETTLE_MS = 3_000;
/** 주기 프로브 간격 (인터페이스 변화 없이 죽는 블랙홀용 폴백) */
export const PROBE_INTERVAL_MS = 30_000;
/** 1회 실패 뒤 재확인까지의 간격 */
export const PROBE_RETRY_MS = 5_000;
export const PROBE_TIMEOUT_MS = 5_000;
/** 연속 이 횟수만큼 응답이 없으면 사망 판정 (루프 확정은 즉시) */
export const DEAD_AFTER_FAILURES = 2;
/** 터널 통과 여부만 보는 프로브 대상 — 어떤 응답이든 오면 살아 있는 것 (정상 204·0.2초) */
export const PROBE_URL = 'https://www.gstatic.com/generate_204';
/** 재연결 전 VPN 서버 TCP 도달 확인 한도 */
export const REACH_TIMEOUT_MS = 3_000;
/** 자동 재연결(사망 복구·경로 옮기기) 사이의 최소 간격 — 접촉 불량·불안정 와이파이로 SIGHUP 이 연달아 나가는 것을 막는다 */
export const MIN_AUTO_RECONNECT_GAP_MS = 60_000;

/** STATE CONNECTED 라인에서 얻는 원격 서버 (IP·포트) */
export type VpnServer = { ip: string; port: number };

/** loop = 서버 경로가 utun 을 가리킴(루프 확정) · unreachable = 터널 통과 응답 없음 */
export type ProbeResult = 'ok' | 'loop' | 'unreachable';
export type Verdict = 'alive' | 'suspect' | 'dead';

/** 터널(utun) 인터페이스인가 — Tailscale 도 utun 이라 지문에서 함께 빠진다 */
export const isTunnelInterface = (iface: string) => /^utun\d+$/.test(iface);

/**
 * 물리 인터페이스 지문 — utun·loopback 을 뺀 IPv4 주소 목록. 바뀌면 네트워크가 전환된 것.
 * IPv6 는 임시 주소 회전으로 잡음이 커서 보지 않는다. 빈 문자열이면 물리 네트워크가 없다.
 */
export function interfaceFingerprint(ifaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>): string {
  const parts: string[] = [];
  for (const [name, infos] of Object.entries(ifaces)) {
    if (!infos || isTunnelInterface(name)) continue;
    for (const info of infos) {
      if (info.internal || info.family !== 'IPv4') continue;
      parts.push(`${name}=${info.address}`);
    }
  }
  return parts.sort().join(',');
}

/** `route -n get <host>` 출력의 `interface:` 값 */
export function parseRouteInterface(output: string): string | null {
  const m = /^\s*interface:\s*(\S+)/m.exec(output);
  return m ? m[1] : null;
}

/** 서버 우회 경로가 타는 인터페이스 · 물리 기본 인터페이스 (`route get default` 는 VPN 이 켜져 있어도 물리 쪽을 준다 — 실측) */
export type RouteView = { serverIface: string | null; defaultIface: string | null };

/**
 * 터널이 기본 인터페이스가 아닌 다른 물리 인터페이스를 타고 있는가 — 유선을 꽂아 기본이 en7 로
 * 바뀌었는데 서버 경로는 재연결 시점의 와이파이(en0)에 남은 경우. 살아 있지만 느린 길이라 옮긴다.
 */
export function isDetoured({ serverIface, defaultIface }: RouteView): boolean {
  if (!serverIface || !defaultIface) return false;
  if (isTunnelInterface(serverIface) || isTunnelInterface(defaultIface)) return false;
  return serverIface !== defaultIface;
}

/** `networksetup -listallhardwareports` 출력 → 장치명(en7) → 사람이 읽는 이름(USB 10/100/1000 LAN) */
export function parseHardwarePorts(output: string): Map<string, string> {
  const map = new Map<string, string>();
  let port: string | null = null;
  for (const line of output.split('\n')) {
    const p = /^Hardware Port:\s*(.+)$/.exec(line.trim());
    if (p) {
      port = p[1].trim();
      continue;
    }
    const d = /^Device:\s*(\S+)/.exec(line.trim());
    if (d && port) map.set(d[1], port);
  }
  return map;
}

/**
 * 사망 판정 뒤 지금 재연결해도 되는가 — 재연결이 실패하면 `--connect-retry-max 2` 소진으로 데몬이
 * 죽어 나중에 관리자 인증부터 다시 해야 하므로, **성공할 수 있을 때만** SIGHUP 을 보낸다.
 * - 물리 기본 경로가 없으면(케이블·와이파이 모두 없음) 대기
 * - 루프(서버 경로가 터널을 가리킴)는 도달 검사를 할 수 없다 — 물리 기본 경로가 있으면 재연결
 * - 응답 없음은 서버까지 TCP 가 닿을 때만 재연결. 안 닿으면 물리 네트워크 쪽 문제(라우터 재부팅·
 *   캡티브 포털·잠자기 복귀 직후)라 기다린다 — 확인 못 했으면(null) 예전대로 재연결
 */
export function reconnectDecision(
  result: Exclude<ProbeResult, 'ok'>,
  routes: RouteView,
  serverReachable: boolean | null,
): 'reconnect' | 'wait' {
  if (!routes.defaultIface || isTunnelInterface(routes.defaultIface)) return 'wait';
  if (result === 'loop') return 'reconnect';
  return serverReachable === false ? 'wait' : 'reconnect';
}

/**
 * 프로브 결과 누적 판정 — 루프는 즉시 사망, 응답 없음은 연속 DEAD_AFTER_FAILURES 회.
 * 반환 failures 는 다음 호출에 넘길 누적값 (alive·dead 는 0 으로 초기화).
 */
export function judgeProbe(
  result: ProbeResult,
  failures: number,
): { verdict: Verdict; failures: number } {
  if (result === 'ok') return { verdict: 'alive', failures: 0 };
  if (result === 'loop') return { verdict: 'dead', failures: 0 };
  const next = failures + 1;
  return next >= DEAD_AFTER_FAILURES
    ? { verdict: 'dead', failures: 0 }
    : { verdict: 'suspect', failures: next };
}

/** 호스트로 가는 경로의 인터페이스 (`/sbin/route -n get`, 무권한). 실패하면 null */
function routeInterface(host: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('/sbin/route', ['-n', 'get', host], { timeout: 3_000 }, (err, stdout) => {
      resolve(err ? null : parseRouteInterface(String(stdout)));
    });
  });
}

/** 서버 우회 경로와 물리 기본 경로의 인터페이스를 함께 조사한다 (둘 다 무권한 `route get`) */
export async function inspectRoutes(serverIp: string | null): Promise<RouteView> {
  const [serverIface, defaultIface] = await Promise.all([
    serverIp ? routeInterface(serverIp) : Promise.resolve(null),
    routeInterface('default'),
  ]);
  return { serverIface, defaultIface };
}

let hardwarePorts: Map<string, string> | null = null;

/** 인터페이스 장치명을 사람이 읽는 이름으로 (알림 문구용). 실패하면 장치명 그대로 */
export async function interfaceLabel(iface: string): Promise<string> {
  if (!hardwarePorts) {
    hardwarePorts = await new Promise((resolve) => {
      execFile('/usr/sbin/networksetup', ['-listallhardwareports'], { timeout: 3_000 }, (err, stdout) =>
        resolve(err ? new Map() : parseHardwarePorts(String(stdout))),
      );
    });
  }
  return hardwarePorts?.get(iface) ?? iface;
}

/** VPN 서버 포트에 TCP 가 닿는가 — 서버 우회 경로(물리)를 타므로 물리 네트워크 생존 확인이다. 접속만 하고 바로 끊는다 */
export function isServerReachable(server: VpnServer, timeoutMs = REACH_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: server.ip, port: server.port });
    const done = (ok: boolean) => {
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}

/**
 * 터널 생존 프로브 — 서버 경로가 utun 이면 루프(즉시 확정), 아니면 터널을 통과하는
 * HTTP 응답이 오는지 본다. 응답 코드는 무관하다 — 무엇이든 왔으면 터널이 트래픽을 통과시킨 것.
 */
export async function probeTunnel(routes: RouteView): Promise<ProbeResult> {
  if (routes.serverIface && isTunnelInterface(routes.serverIface)) return 'loop';
  try {
    await fetchWithTimeout(PROBE_URL, { method: 'HEAD', cache: 'no-store' }, PROBE_TIMEOUT_MS);
    return 'ok';
  } catch {
    return 'unreachable';
  }
}
