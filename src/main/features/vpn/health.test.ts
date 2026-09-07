// VPN 터널 생존 판정 규칙 테스트 — health.ts 의 순수 함수만 다룬다 (프로브는 실제 네트워크라 제외).
import { describe, expect, it } from 'vitest';
import {
  DEAD_AFTER_FAILURES,
  MIN_AUTO_RECONNECT_GAP_MS,
  inReconnectCooldown,
  interfaceFingerprint,
  isDetoured,
  isTunnelInterface,
  judgeProbe,
  parseHardwarePorts,
  parseRouteInterface,
  reconnectDecision,
} from './health';

const ipv4 = (address: string, internal = false) =>
  ({ address, family: 'IPv4', internal }) as unknown as import('node:os').NetworkInterfaceInfo;
const ipv6 = (address: string) =>
  ({ address, family: 'IPv6', internal: false }) as unknown as import('node:os').NetworkInterfaceInfo;

describe('interfaceFingerprint', () => {
  it('utun·loopback·IPv6 를 빼고 물리 IPv4 만 정렬해 담는다', () => {
    const fp = interfaceFingerprint({
      lo0: [ipv4('127.0.0.1', true)],
      en7: [ipv4('116.121.158.169'), ipv6('fe80::1')],
      en0: [ipv4('192.168.25.28')],
      utun6: [ipv4('10.8.0.78')], // VPN 터널
      utun3: [ipv4('100.101.1.2')], // Tailscale 도 utun
    });
    expect(fp).toBe('en0=192.168.25.28,en7=116.121.158.169');
  });

  it('유선을 꽂아 인터페이스가 늘면 지문이 바뀐다 (와이파이→유선 전환 감지의 근거)', () => {
    const wifiOnly = interfaceFingerprint({ en0: [ipv4('192.168.25.28')] });
    const both = interfaceFingerprint({
      en0: [ipv4('192.168.25.28')],
      en7: [ipv4('116.121.158.169')],
    });
    expect(both).not.toBe(wifiOnly);
  });

  it('터널만 남았으면 빈 문자열 — 물리 네트워크 없음', () => {
    expect(interfaceFingerprint({ utun6: [ipv4('10.8.0.78')], lo0: [ipv4('127.0.0.1', true)] })).toBe('');
  });
});

describe('parseRouteInterface', () => {
  const sample = (iface: string) =>
    `   route to: 221.151.188.2\ndestination: 221.151.188.2\n    gateway: 116.121.158.1\n  interface: ${iface}\n      flags: <UP,GATEWAY,HOST,DONE,STATIC>\n`;

  it('macOS route get 출력에서 interface 를 읽는다', () => {
    expect(parseRouteInterface(sample('en7'))).toBe('en7');
  });

  it('서버 경로가 터널을 가리키면 루프 — isTunnelInterface 로 판별된다', () => {
    const iface = parseRouteInterface(sample('utun6'));
    expect(iface).toBe('utun6');
    expect(isTunnelInterface(iface!)).toBe(true);
    expect(isTunnelInterface('en7')).toBe(false);
  });

  it('출력이 이상하면 null', () => {
    expect(parseRouteInterface('route: writing to routing socket: not in table')).toBeNull();
  });
});

describe('isDetoured', () => {
  it('유선을 꽂아 기본이 en7 인데 서버 경로가 와이파이 en0 에 남았으면 우회 (2026-09-07 실측 상황)', () => {
    expect(isDetoured({ serverIface: 'en0', defaultIface: 'en7' })).toBe(true);
  });

  it('같은 인터페이스면 정상', () => {
    expect(isDetoured({ serverIface: 'en7', defaultIface: 'en7' })).toBe(false);
  });

  it('루프(서버 경로가 utun)는 우회가 아니라 사망 — 여기서 판정하지 않는다', () => {
    expect(isDetoured({ serverIface: 'utun6', defaultIface: 'en0' })).toBe(false);
  });

  it('둘 중 하나를 못 읽었으면 판단 보류', () => {
    expect(isDetoured({ serverIface: null, defaultIface: 'en7' })).toBe(false);
    expect(isDetoured({ serverIface: 'en0', defaultIface: null })).toBe(false);
  });
});

describe('parseHardwarePorts', () => {
  it('networksetup 출력에서 장치명 → 포트 이름을 만든다', () => {
    const out =
      'Hardware Port: USB 10/100/1000 LAN\nDevice: en7\nEthernet Address: aa:bb\n\n' +
      'Hardware Port: Wi-Fi\nDevice: en0\nEthernet Address: cc:dd\n\nVLAN Configurations\n===\n';
    const map = parseHardwarePorts(out);
    expect(map.get('en7')).toBe('USB 10/100/1000 LAN');
    expect(map.get('en0')).toBe('Wi-Fi');
    expect(map.get('utun6')).toBeUndefined();
  });
});

describe('reconnectDecision', () => {
  it('물리 기본 경로가 없으면(케이블·와이파이 모두 없음) 어떤 사망이든 대기 — 재시도 소진으로 데몬을 잃지 않는다', () => {
    expect(reconnectDecision('loop', { serverIface: 'utun6', defaultIface: null }, null)).toBe('wait');
    expect(reconnectDecision('unreachable', { serverIface: 'en0', defaultIface: null }, true)).toBe('wait');
    expect(reconnectDecision('unreachable', { serverIface: 'en0', defaultIface: 'utun6' }, true)).toBe('wait');
  });

  it('루프는 물리 기본 경로만 있으면 재연결 (서버 경로가 터널이라 도달 검사를 못 쓴다)', () => {
    expect(reconnectDecision('loop', { serverIface: 'utun6', defaultIface: 'en0' }, null)).toBe('reconnect');
  });

  it('응답 없음은 서버까지 TCP 가 닿을 때만 재연결 — 안 닿으면 물리 네트워크 문제라 대기', () => {
    const routes = { serverIface: 'en0', defaultIface: 'en0' };
    expect(reconnectDecision('unreachable', routes, true)).toBe('reconnect');
    expect(reconnectDecision('unreachable', routes, false)).toBe('wait');
  });

  it('도달 확인을 못 했으면(포트 미상) 예전처럼 재연결', () => {
    expect(reconnectDecision('unreachable', { serverIface: 'en0', defaultIface: 'en0' }, null)).toBe('reconnect');
  });
});

describe('judgeProbe', () => {
  it('루프는 실패 누적과 무관하게 즉시 사망', () => {
    expect(judgeProbe('loop', 0)).toEqual({ verdict: 'dead', failures: 0 });
  });

  it('응답 없음은 연속 DEAD_AFTER_FAILURES 회째에 사망 — 그 전엔 의심', () => {
    let failures = 0;
    for (let i = 1; i < DEAD_AFTER_FAILURES; i++) {
      const r = judgeProbe('unreachable', failures);
      expect(r.verdict).toBe('suspect');
      failures = r.failures;
      expect(failures).toBe(i);
    }
    expect(judgeProbe('unreachable', failures)).toEqual({ verdict: 'dead', failures: 0 });
  });

  it('한 번 실패 뒤 응답이 오면 누적이 초기화된다 (순간 끊김은 사망이 아니다)', () => {
    const suspect = judgeProbe('unreachable', 0);
    expect(judgeProbe('ok', suspect.failures)).toEqual({ verdict: 'alive', failures: 0 });
  });
});

describe('inReconnectCooldown', () => {
  const t0 = 1_700_000_000_000; // 임의의 epoch ms
  const gap = MIN_AUTO_RECONNECT_GAP_MS;

  it('아직 자동 재연결을 한 번도 안 했으면(0) 쿨다운이 아니다 — now 가 작아도', () => {
    expect(inReconnectCooldown(0, t0)).toBe(false);
    expect(inReconnectCooldown(0, 1_000)).toBe(false);
  });

  it('간격이 1ms 라도 모자라면 쿨다운', () => {
    expect(inReconnectCooldown(t0, t0 + gap - 1)).toBe(true);
    expect(inReconnectCooldown(t0, t0)).toBe(true);
  });

  it('간격을 정확히 채우면 쿨다운이 풀린다', () => {
    expect(inReconnectCooldown(t0, t0 + gap)).toBe(false);
    expect(inReconnectCooldown(t0, t0 + gap + 1)).toBe(false);
  });

  it('gap 을 직접 주면 그 값을 기준으로 본다', () => {
    expect(inReconnectCooldown(t0, t0 + 999, 1_000)).toBe(true);
    expect(inReconnectCooldown(t0, t0 + 1_000, 1_000)).toBe(false);
  });
});
