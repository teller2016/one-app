// 잠자기 사이클 판독 규칙 테스트 — wakeLog.ts 의 순수 함수만 다룬다 (pmset 실행·토스트는 제외).
// 표본 줄은 2026-09-16 실제 `pmset -g log` 에서 가져왔다.
import { describe, expect, it } from 'vitest';
import {
  WAKE_STORM_MIN_COUNT,
  classifyWakeCause,
  formatDuration,
  formatWakeStormToast,
  judgeWakeStorm,
  parsePmsetTime,
  summarizeSleepCycle,
  type SleepCycleSummary,
} from './wakeLog';

const T = (time: string, day = '2026-09-16') => parsePmsetTime(day, time, '+0900');

const line = (time: string, kind: string, rest: string) =>
  `2026-09-16 ${time} +0900 ${kind.padEnd(20)}\t${rest}`;
const darkWake = (time: string, pct: number) =>
  line(
    time,
    'DarkWake',
    `DarkWake from Deep Idle [CDNP] : due to smc.sysState.Wake(0x70070000) wifibt SMC.OutboxNotEmpty centauri-beta/ Using BATT (Charge:${pct}%) 6 secs`,
  );
const sleep = (time: string, reason: string, pct: number, power = 'Batt') =>
  line(
    time,
    'Sleep',
    `Entering Sleep state due to '${reason}':TCPKeepAlive=active Using ${power} (Charge:${pct}%) 3 secs`,
  );

/** 덮개 닫힘 → 다크웨이크 N회 → 사용자가 깨움, 배터리 start→end */
function storm(n: number, start = 80, end = 62): string {
  const rows = [
    line('18:34:32', 'Notification', 'Display is turned off'),
    sleep('18:34:35', 'Clamshell Sleep', start),
    'Sleep/Wakes since boot at 2026-09-12 15:21:16 +0900 :1049   Dark Wake Count in this sleep cycle:284',
  ];
  for (let i = 0; i < n; i++) {
    const m = String(35 + Math.floor(i / 10)).padStart(2, '0');
    const s = String((i % 10) * 6).padStart(2, '0');
    rows.push(darkWake(`18:${m}:${s}`, start));
    rows.push(sleep(`18:${m}:${String((i % 10) * 6 + 3).padStart(2, '0')}`, 'Maintenance Sleep', start));
  }
  rows.push(
    line(
      '19:31:35',
      'Wake',
      `Wake from Deep Idle [CDNVA] : due to smc.sysState.Wake(0x70070000) lid SMC.OutboxNotEmpty RTP.multi-touch/HID Activity Using BATT (Charge:${end}%) 5 secs`,
    ),
  );
  return rows.join('\n');
}

describe('parsePmsetTime', () => {
  it('+0900 시간대를 ISO 형식으로 바꿔 파싱한다', () => {
    expect(parsePmsetTime('2026-09-16', '18:34:35', '+0900')).toBe(
      Date.parse('2026-09-16T18:34:35+09:00'),
    );
  });
});

describe('summarizeSleepCycle', () => {
  it('구간 안의 다크웨이크·완전 깨어남·배터리 시작/끝·덮개 닫힘을 집계한다', () => {
    const s = summarizeSleepCycle(storm(30), T('18:34:30'), T('19:31:40'));
    expect(s.darkWakes).toBe(30);
    expect(s.fullWakes).toBe(1);
    expect(s.lidClosed).toBe(true);
    expect(s.batteryStart).toBe(80);
    expect(s.batteryEnd).toBe(62);
    expect(s.charging).toBe(false);
    expect(s.thermal).toBe(false);
  });

  it('구간 밖 줄은 세지 않는다 — 어제 폭주가 오늘 사이클에 섞이지 않게', () => {
    // 표본의 다크웨이크는 18:35·18:36·18:37 에 10회씩 — 18:36 부터 자르면 20회만 남는다
    const s = summarizeSleepCycle(storm(30), T('18:36:00'), T('19:31:40'));
    expect(s.darkWakes).toBe(20);
    expect(s.batteryStart).toBe(80); // 구간 첫 줄(18:36:00 다크웨이크)의 값
    expect(s.batteryEnd).toBe(62);
  });

  it('요약 줄(Sleep/Wakes since boot)의 Dark Wake Count 는 쓰지 않는다', () => {
    const text = [
      sleep('18:34:35', 'Clamshell Sleep', 80),
      'Sleep/Wakes since boot at 2026-09-12 15:21:16 +0900 :1049   Dark Wake Count in this sleep cycle:284',
    ].join('\n');
    expect(summarizeSleepCycle(text, T('18:34:30'), T('18:35:00')).darkWakes).toBe(0);
  });

  it('발열 비상 잠자기와 전원 어댑터를 표시한다', () => {
    const text = [
      sleep('18:34:35', 'Maintenance Sleep', 100, 'AC'),
      line(
        '19:31:38',
        'Sleep',
        "Entering Sleep state due to 'Thermal Emergency Sleep':TCPKeepAlive=inactive Using Batt (Charge:63%) 2 secs",
      ),
    ].join('\n');
    const s = summarizeSleepCycle(text, T('18:34:30'), T('19:32:00'));
    expect(s.thermal).toBe(true);
    expect(s.charging).toBe(true);
    expect(s.lidClosed).toBe(false);
  });
});

describe('judgeWakeStorm', () => {
  const base = (over: Partial<SleepCycleSummary>): SleepCycleSummary => ({
    sinceMs: 0,
    untilMs: 3_600_000,
    durationMs: 3_600_000,
    darkWakes: 0,
    fullWakes: 1,
    lidClosed: true,
    thermal: false,
    charging: false,
    batteryStart: 80,
    batteryEnd: 79,
    causes: { bluetooth: 0, wifi: 0, maintenance: 0, other: 0 },
    ...over,
  });

  it('2026-09-16 실측(57분 248회)은 폭주다', () => {
    expect(judgeWakeStorm(base({ durationMs: 57 * 60_000, darkWakes: 248 }))).toEqual({
      storm: true,
      reason: 'count',
    });
  });

  it('정상 잠자기(밤새 몇 번의 유지관리 깨어남)는 폭주가 아니다', () => {
    expect(judgeWakeStorm(base({ durationMs: 10 * 3_600_000, darkWakes: 8 }))).toEqual({
      storm: false,
    });
  });

  it('횟수는 넘어도 밤새 드물게 깬 것(시간당 빈도 미달)은 폭주가 아니다', () => {
    expect(
      judgeWakeStorm(base({ durationMs: 10 * 3_600_000, darkWakes: WAKE_STORM_MIN_COUNT + 5 })),
    ).toEqual({ storm: false });
  });

  it('발열 비상 잠자기는 횟수와 무관하게 알린다', () => {
    expect(judgeWakeStorm(base({ darkWakes: 3, thermal: true }))).toEqual({
      storm: true,
      reason: 'thermal',
    });
  });

  it('아주 짧은 구간에서 0 나눗셈으로 터지지 않는다', () => {
    expect(() => judgeWakeStorm(base({ durationMs: 0, darkWakes: 30 }))).not.toThrow();
  });
});

describe('formatDuration', () => {
  it('분·시간·일 단위로 줄여 쓴다', () => {
    expect(formatDuration(57 * 60_000)).toBe('57분');
    expect(formatDuration(3 * 3_600_000 + 12 * 60_000)).toBe('3시간 12분');
    expect(formatDuration(2 * 3_600_000)).toBe('2시간');
    expect(formatDuration(25 * 3_600_000)).toBe('1일 1시간');
    expect(formatDuration(10_000)).toBe('1분');
  });
});

describe('formatWakeStormToast', () => {
  it('덮개 닫힘 제목 + 횟수·배터리·발열을 한 줄로', () => {
    const s = summarizeSleepCycle(storm(30), T('18:34:30'), T('19:31:40'));
    const t = formatWakeStormToast({ ...s, thermal: true });
    expect(t.title).toContain('덮개');
    expect(t.message).toContain('57분 동안 30번 깨어남');
    expect(t.message).toContain('배터리 80%→62%');
    expect(t.message).toContain('발열 비상');
  });

  it('충전 중이면 배터리 변화를 쓰지 않는다', () => {
    const s = summarizeSleepCycle(storm(30), T('18:34:30'), T('19:31:40'));
    const t = formatWakeStormToast({ ...s, charging: true, lidClosed: false });
    expect(t.title).not.toContain('덮개');
    expect(t.message).not.toContain('배터리');
  });

  // 힌트가 엉뚱한 곳(pmset tcpkeepalive)을 가리키던 것을 고친 뒤로, 두 갈래를 고정해 둔다
  it('블루투스 끄기가 꺼져 있으면 그걸 켜라고 안내한다', () => {
    const s = summarizeSleepCycle(storm(30), T('18:34:30'), T('19:31:40'));
    const t = formatWakeStormToast(s, { bluetoothOff: false });
    expect(t.message).toContain('블루투스 끄기');
    expect(t.message).not.toContain('tcpkeepalive');
  });

  it('이미 켜져 있으면 조건(외부 모니터·전원)을 확인하라고 안내한다', () => {
    const s = summarizeSleepCycle(storm(30), T('18:34:30'), T('19:31:40'));
    const t = formatWakeStormToast(s, { bluetoothOff: true });
    expect(t.message).toContain('외부 모니터');
    expect(t.message).not.toContain('tcpkeepalive');
  });

  // 2026-10-01: 블루투스는 꺼졌는데 Wi-Fi 패킷이 550번 깨웠다 — 블루투스 조건을 탓하면 안 된다
  it('Wi-Fi 패킷이 주로 깨웠으면 블루투스가 아니라 Wi-Fi 를 안내한다', () => {
    const wifi = storm(30).replace(/centauri-beta\//g, 'centauri-alpha E_RX_IP_PACKET ARPT/');
    const s = summarizeSleepCycle(wifi, T('18:34:30'), T('19:31:40'));
    expect(s.causes.wifi).toBe(30);
    const t = formatWakeStormToast(s, { bluetoothOff: true });
    expect(t.message).toContain('Wi-Fi');
    expect(t.message).not.toContain('블루투스');
  });

  // 2026-10-02: Wi-Fi 쪽도 블루투스와 같은 두 갈래 — 토글이 꺼져 있으면 켜라고, 켜져 있으면 조건을 보라고
  it('Wi-Fi 끄기가 꺼져 있으면 그걸 켜라고 안내한다', () => {
    const wifi = storm(30).replace(/centauri-beta\//g, 'centauri-alpha E_RX_IP_PACKET ARPT/');
    const s = summarizeSleepCycle(wifi, T('18:34:30'), T('19:31:40'));
    const t = formatWakeStormToast(s, { bluetoothOff: true, wifiOff: false });
    expect(t.message).toContain('Wi-Fi 끄기');
  });

  it('Wi-Fi 끄기가 켜져 있는데도 폭주했으면 조건(외부 모니터·전원)을 확인하라고 안내한다', () => {
    const wifi = storm(30).replace(/centauri-beta\//g, 'centauri-alpha E_RX_IP_PACKET ARPT/');
    const s = summarizeSleepCycle(wifi, T('18:34:30'), T('19:31:40'));
    const t = formatWakeStormToast(s, { wifiOff: true });
    expect(t.message).toContain('외부 모니터');
    expect(t.message).not.toContain('블루투스');
  });
});

describe('classifyWakeCause', () => {
  it('실측 사유 문구를 갈래별로 나눈다', () => {
    expect(classifyWakeCause('due to smc.sysState.Wake(0x70070000) wifibt SMC.OutboxNotEmpty centauri-beta/')).toBe('bluetooth');
    expect(classifyWakeCause('due to smc.sysState.Wake(0x70070000) wifibt SMC.OutboxNotEmpty centauri-alpha E_RX_IP_PACKET ARPT/')).toBe('wifi');
    expect(classifyWakeCause('due to smc.sysState.Wake(0x70070000) wifibt SMC.OutboxNotEmpty centauri-alpha E_PFN_NET_FOUND ARPT/')).toBe('wifi');
    expect(classifyWakeCause('due to NUB.SPMI0Sw3IRQ nub-spmi0.0x02 rtc/Maintenance')).toBe('maintenance');
    expect(classifyWakeCause('due to AOP.Outbox0_NotEmpty AOP.MBIEndpoint.38 spu_queue_overflow_ep38/')).toBe('other');
  });
});
