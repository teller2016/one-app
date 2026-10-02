// 회사 VPN(full-tunnel)을 켠 채로 MO(Tailscale) 접속을 살리는 우회 경로 — openvpn `--route … net_gateway` 인자.
//
// 왜 끊기나(2026-10-02 실측): Tailscale 앱은 다른 VPN 에 휘말리지 않으려고 자기 소켓을 **물리 기본
// 인터페이스**(유선 en7 등)에 묶는다. 그런데 서버가 push 한 `0/1`·`128.0/1 → utun` 이 더 구체적이라
// 커널이 "그 인터페이스 소속" 경로를 찾지 못하고 즉시 ENETUNREACH 를 준다 — 기본 인터페이스에는
// 스코프된 default 경로가 없다(`route -n get -ifscope en7 <DERP IP>` = not in table). Tailscale 로그엔
// `dial tcp4 172.237.28.183:443: connect: network is unreachable` 로 남는다.
// 회사 방화벽이 막는 것이 아니다 — 같은 IP 를 묶지 않은 curl 로 부르면 VPN 을 타고 200 이 온다.
//
// 대응: Tailscale 이 꼭 닿아야 하는 서버(컨트롤 플레인 + DERP 릴레이)에만 물리 게이트웨이 경로를 준다.
// 그 인터페이스 소속의 더 구체적인 경로가 생겨 묶인 소켓도 길을 찾는다. 나머지(사내·Claude·DNS)는 그대로
// VPN 을 타 출발지가 회사 IP 로 남는다. `net_gateway` 는 연결 때마다 그때의 기본 게이트웨이로 풀리고,
// 해제·SIGHUP 재연결 때 openvpn 이 지웠다 다시 붙인다(와이파이↔유선 전환도 따라간다).
// ⚠️ DNS 대역은 넣지 말 것 — 2026-08-09 에 168.126.63.0/24 까지 빼자 Claude 가 끊겼다. Tailscale 은 DNS
//    없이도 컨트롤이 준 IP(DialPlan)와 DERP 의 bootstrap DNS 로 붙는다.
// ⚠️ 폰과의 직결(P2P)은 여전히 안 된다(폰 주소는 매번 달라 경로로 뺄 수 없다) — DERP 경유로만 붙는다.
import { execFile } from 'node:child_process';
import { findTailscale } from '../../lib/tailscale';

/** Tailscale 컨트롤 플레인 — Tailscale Inc. 소유 /24(whois). 로그인·네트워크 맵·DialPlan 이 모두 여기다 */
const CONTROL_PLANE = { net: '192.200.0.0', mask: '255.255.255.0' };

const IPV4_RE = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;

type DerpMap = { Regions?: Record<string, { Nodes?: { IPv4?: unknown }[] } | null> };

/**
 * `tailscale debug derp-map` JSON 에서 DERP 서버 IPv4 를 뽑는다 (중복 제거·정렬).
 * IPv4 가 비었거나(DNS 로 찾는 노드) `none`(IPv4 끔)인 노드는 경로로 뺄 수 없어 버린다.
 * ⚠️ 이 값은 root 로 도는 openvpn 명령줄에 들어간다 — 형식이 IPv4 가 아니면 무조건 버린다.
 */
export function derpIPv4s(derpMap: unknown): string[] {
  const regions = (derpMap as DerpMap | null)?.Regions;
  if (!regions || typeof regions !== 'object') return [];
  const ips = new Set<string>();
  for (const region of Object.values(regions)) {
    for (const node of region?.Nodes ?? []) {
      if (typeof node?.IPv4 === 'string' && IPV4_RE.test(node.IPv4)) ips.add(node.IPv4);
    }
  }
  return [...ips].sort();
}

/** openvpn 인자 — 컨트롤 플레인 /24 + DERP 서버 /32 를 `net_gateway`(물리 기본 게이트웨이)로 */
export function bypassRouteArgs(derpIps: string[]): string[] {
  const route = (net: string, mask: string) => ['--route', net, mask, 'net_gateway'];
  return [
    ...route(CONTROL_PLANE.net, CONTROL_PLANE.mask),
    ...derpIps.flatMap((ip) => route(ip, '255.255.255.255')),
  ];
}

/**
 * 이 맥의 Tailscale 이 쓰는 DERP 목록으로 우회 인자를 만든다. Tailscale 이 없거나 지도를 못 읽으면 빈 배열
 * (DERP 없이 컨트롤만 닿으면 폰에는 맥이 온라인으로 보이는데 접속은 안 돼 더 헷갈린다).
 * DERP 지도는 Tailscale 이 디스크에 들고 있는 것이라 이미 VPN 이 켜져 컨트롤에 못 닿는 상태에서도 나온다.
 */
export async function tailscaleBypassArgs(): Promise<string[]> {
  const bin = findTailscale();
  if (!bin) return [];
  const stdout = await new Promise<string | null>((resolve) => {
    execFile(bin, ['debug', 'derp-map'], { timeout: 5_000, maxBuffer: 4 * 1024 * 1024 }, (err, out) =>
      resolve(err ? null : String(out)),
    );
  });
  if (!stdout) return [];
  let ips: string[];
  try {
    ips = derpIPv4s(JSON.parse(stdout));
  } catch {
    return [];
  }
  return ips.length ? bypassRouteArgs(ips) : [];
}
