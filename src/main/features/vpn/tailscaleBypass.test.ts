// Tailscale 우회 경로 테스트 — DERP 지도 파싱과 openvpn 인자 조립만 다룬다 (CLI 실행은 실제 환경이라 제외).
import { describe, expect, it } from 'vitest';
import { bypassRouteArgs, derpIPv4s } from './tailscaleBypass';

describe('derpIPv4s', () => {
  it('모든 지역의 노드 IPv4 를 중복 없이 정렬해 모은다', () => {
    const map = {
      Regions: {
        '7': { Nodes: [{ IPv4: '172.238.6.180' }, { IPv4: '172.237.28.183' }] },
        '3': { Nodes: [{ IPv4: '172.237.66.30' }, { IPv4: '172.238.6.180' }] },
      },
    };
    expect(derpIPv4s(map)).toEqual(['172.237.28.183', '172.237.66.30', '172.238.6.180']);
  });

  it('비었거나 none 이거나 IPv4 형식이 아닌 값은 버린다 (root 명령줄에 들어간다)', () => {
    const map = {
      Regions: {
        '1': {
          Nodes: [
            { IPv4: '' }, // DNS 로 찾는 노드
            { IPv4: 'none' }, // IPv4 끔
            { IPv4: '1.2.3.4; rm -rf /' },
            { IPv4: '256.1.1.1' },
            { IPv4: 42 },
            {},
            { IPv4: '203.0.113.7' },
          ],
        },
        '2': null,
        '3': {},
      },
    };
    expect(derpIPv4s(map)).toEqual(['203.0.113.7']);
  });

  it('지도 모양이 아니면 빈 배열', () => {
    expect(derpIPv4s(null)).toEqual([]);
    expect(derpIPv4s({})).toEqual([]);
    expect(derpIPv4s({ Regions: 'x' })).toEqual([]);
  });
});

describe('bypassRouteArgs', () => {
  it('컨트롤 플레인 /24 를 먼저, DERP 는 /32 로 — 모두 net_gateway', () => {
    expect(bypassRouteArgs(['172.238.6.180'])).toEqual([
      '--route', '192.200.0.0', '255.255.255.0', 'net_gateway',
      '--route', '172.238.6.180', '255.255.255.255', 'net_gateway',
    ]);
  });
});
