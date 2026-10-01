// 잠자기 사이클 판독 — `pmset -g log` 텍스트에서 "잠든 시각 ~ 깬 시각" 구간의 깨어남 횟수·배터리·
// 발열 비상 여부를 집계하고 폭주인지 판정한다. 순수 함수만 두어 wakeLog.test.ts 가 검증한다.
//
// 배경(2026-09-16): 덮개를 닫고 퇴근했는데 맥이 Wi-Fi/BT 칩 사유(`wifibt centauri-beta`)로 57분 동안
// 248번 다크웨이크했다(잠이 평균 10초 단위로 쪼개져 SoC 가 식을 틈이 없었고 배터리 80→62%). 가방 안이라
// 방열이 안 되어 'Thermal Emergency Sleep' 까지 갔다(강제 종료). 같은 폭주가 그 전날들에도 매일 있었지만(98회·112회) 눈에 띄지 않았다 —
// 그래서 완전 복귀 때 직전 사이클을 집계해 폭주면 알린다.

/** 이보다 짧은 잠자기는 집계하지 않는다 — 잠깐 덮은 것까지 14MB 로그를 읽을 이유가 없다 */
export const MIN_REPORT_CYCLE_MS = 10 * 60_000;
/** 폭주 판정 — 다크웨이크가 이 횟수 이상이면서 시간당 빈도도 아래를 넘을 때 */
export const WAKE_STORM_MIN_COUNT = 20;
export const WAKE_STORM_MIN_PER_HOUR = 15;

export type SleepCycleSummary = {
  sinceMs: number;
  untilMs: number;
  durationMs: number;
  /** 다크웨이크(화면 안 켜고 잠깐 깸) 횟수 — 폭주의 척도 */
  darkWakes: number;
  /** 화면까지 켠 완전 깨어남 횟수 — 사용자가 마지막에 깨운 1회가 보통 포함된다 */
  fullWakes: number;
  /** 구간의 첫 잠자기가 덮개 닫힘('Clamshell Sleep')이었나 */
  lidClosed: boolean;
  /** 'Thermal Emergency Sleep' 이 한 번이라도 있었나 — 발열로 OS 가 강제로 잠재운 것 */
  thermal: boolean;
  /** 구간 중 전원 어댑터('Using AC')가 잡혔나 — 그러면 배터리 소모는 의미가 없다 */
  charging: boolean;
  batteryStart: number | null;
  batteryEnd: number | null;
  /** 다크웨이크 사유별 횟수 — 토스트 힌트가 **실제로 깨운 것**을 가리키게 한다 */
  causes: Record<WakeCause, number>;
};

/**
 * 다크웨이크 사유 분류 — `due to …` 뒤 문구로 가른다.
 * - `centauri-beta` = 블루투스 쪽(HID 재연결 루프, 2026-09-20 확정)
 * - `centauri-alpha` / `E_RX_IP_PACKET` / `E_PFN_NET_FOUND` = Wi-Fi 쪽(수신 패킷·아는 네트워크 발견)
 * - `rtc/Maintenance` = OS 정기 유지관리(시간당 1회 정도, 정상)
 *
 * ⚠️ 2026-10-01 실측: 블루투스 자동 끄기가 **정상 동작했는데도**(bluetoothd `peripheral manager isn't
 * powered on`) 550회 폭주했다 — 전부 `centauri-alpha E_RX_IP_PACKET`(깨운 패킷은 ARP 응답)였다.
 * 집에서 아는 Wi-Fi 에 다크웨이크 중 자동 접속한 뒤, 깰 때마다 로컬 Java 서버들이 DB(1521·3306·6379)
 * 연결을 시도하고 그 응답이 다시 깨우는 루프가 1시간 이어졌다. 사유를 안 보던 힌트는 이걸 블루투스
 * 조건 탓으로 안내했다.
 */
export type WakeCause = 'bluetooth' | 'wifi' | 'maintenance' | 'other';

export function classifyWakeCause(rest: string): WakeCause {
  if (rest.includes('centauri-beta')) return 'bluetooth';
  if (/centauri-alpha|E_RX_IP_PACKET|E_PFN_NET_FOUND/.test(rest)) return 'wifi';
  if (rest.includes('rtc/Maintenance')) return 'maintenance';
  return 'other';
}

export type WakeStormVerdict =
  | { storm: false }
  | { storm: true; reason: 'thermal' | 'count' };

// `2026-09-16 18:34:35 +0900 DarkWake            	DarkWake from Deep Idle …` — 날짜·시각·시간대·종류·나머지
const LINE_RE = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{4}) (\S+)\s+(.*)$/;
const CHARGE_RE = /Charge:\s*(\d+)%/;

/** pmset 로그 머리의 시각을 epoch ms 로 — 시간대 `+0900` 은 ISO 의 `+09:00` 으로 바꿔야 파싱된다 */
export function parsePmsetTime(date: string, time: string, tz: string): number {
  return Date.parse(`${date}T${time}${tz.slice(0, 3)}:${tz.slice(3)}`);
}

/**
 * [sinceMs, untilMs] 구간의 잠자기 사이클 집계. 구간 밖 줄과 머리 형식이 아닌 줄(집계 요약 등)은 건너뛴다.
 * `Sleep/Wakes since boot` 요약 줄의 'Dark Wake Count' 는 쓰지 않는다 — 잠든 시각 기준으로 자를 수 없다.
 */
export function summarizeSleepCycle(
  logText: string,
  sinceMs: number,
  untilMs: number,
): SleepCycleSummary {
  const summary: SleepCycleSummary = {
    sinceMs,
    untilMs,
    durationMs: Math.max(0, untilMs - sinceMs),
    darkWakes: 0,
    fullWakes: 0,
    lidClosed: false,
    thermal: false,
    charging: false,
    batteryStart: null,
    batteryEnd: null,
    causes: { bluetooth: 0, wifi: 0, maintenance: 0, other: 0 },
  };
  let sawSleep = false;
  for (const line of logText.split('\n')) {
    const m = LINE_RE.exec(line);
    if (!m) continue;
    const at = parsePmsetTime(m[1], m[2], m[3]);
    if (Number.isNaN(at) || at < sinceMs || at > untilMs) continue;
    const kind = m[4];
    const rest = m[5];

    if (kind === 'DarkWake' && rest.startsWith('DarkWake from')) {
      summary.darkWakes++;
      summary.causes[classifyWakeCause(rest)]++;
    }
    else if (kind === 'Wake' && rest.startsWith('Wake from')) summary.fullWakes++;
    else if (kind === 'Sleep' && !sawSleep && rest.startsWith('Entering Sleep state')) {
      sawSleep = true;
      summary.lidClosed = rest.includes("'Clamshell Sleep'");
    }
    if (rest.includes('Thermal Emergency')) summary.thermal = true;
    if (/Using AC\b/.test(rest)) summary.charging = true;

    const charge = CHARGE_RE.exec(rest);
    if (charge) {
      const pct = Number(charge[1]);
      if (summary.batteryStart === null) summary.batteryStart = pct;
      summary.batteryEnd = pct;
    }
  }
  return summary;
}

/** 폭주인가 — 발열 비상은 횟수와 무관하게 알리고, 그 외엔 횟수·시간당 빈도 둘 다 넘어야 한다 */
export function judgeWakeStorm(s: SleepCycleSummary): WakeStormVerdict {
  if (s.thermal) return { storm: true, reason: 'thermal' };
  if (s.darkWakes < WAKE_STORM_MIN_COUNT) return { storm: false };
  const hours = Math.max(s.durationMs / 3_600_000, 1 / 60); // 1분 미만은 1분으로 — 0 나눗셈 방지
  if (s.darkWakes / hours < WAKE_STORM_MIN_PER_HOUR) return { storm: false };
  return { storm: true, reason: 'count' };
}

/** "57분" · "3시간 12분" · "2일 1시간" — 토스트·로그용 길이 표기 */
export function formatDuration(ms: number): string {
  const totalMin = Math.round(ms / 60_000);
  if (totalMin < 60) return `${Math.max(totalMin, 1)}분`;
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return hours > 0 ? `${days}일 ${hours}시간` : `${days}일`;
  return mins > 0 ? `${hours}시간 ${mins}분` : `${hours}시간`;
}

/** 가장 많이 깨운 사유 — 동률이면 앞(블루투스 → Wi-Fi → …) 순 */
export function dominantWakeCause(s: SleepCycleSummary): WakeCause {
  const order: WakeCause[] = ['bluetooth', 'wifi', 'maintenance', 'other'];
  return order.reduce((best, c) => (s.causes[c] > s.causes[best] ? c : best), order[0]);
}

/**
 * 폭주 토스트 문구 — 제목은 덮개 닫힘 여부로, 본문은 횟수·배터리·발열, 끝에 다음 조치 한 줄.
 *
 * ⚠️ **힌트로 `pmset tcpkeepalive` 를 가리키지 말 것.** 2026-09-20 에 진짜 원인이 **블루투스 HID
 * 재연결 루프**로 확정됐고 그 설정은 이미 적용돼 있다. 자동 끄기를 켠 뒤 다크웨이크가 시간당
 * 20.7회 → 1.2회로 떨어진 것이 확인됐다(09-23). 그래서 힌트는 **그 토글을 켰는지**로 갈린다 —
 * 껐으면 켜라고 하고, 켰는데도 폭주했다면 조건(외부 모니터·전원)에 걸려 안 꺼진 것이다.
 * 단, **Wi-Fi 가 주로 깨웠다면 블루투스 얘기를 하지 않는다**(2026-10-01, `WakeCause` 주석 참고).
 */
export function formatWakeStormToast(
  s: SleepCycleSummary,
  bluetoothOffEnabled = false,
): { title: string; message: string } {
  const title = s.lidClosed
    ? '덮개를 닫은 동안 맥이 계속 깨어났습니다'
    : '잠자기 중 맥이 계속 깨어났습니다';
  const parts = [`${formatDuration(s.durationMs)} 동안 ${s.darkWakes}번 깨어남`];
  if (!s.charging && s.batteryStart !== null && s.batteryEnd !== null && s.batteryStart !== s.batteryEnd) {
    parts.push(`배터리 ${s.batteryStart}%→${s.batteryEnd}%`);
  }
  if (s.thermal) parts.push('발열 비상 잠자기 발생');
  const hint =
    dominantWakeCause(s) === 'wifi'
      ? 'Wi-Fi 수신 패킷이 주로 깨웠습니다 — 덮개를 닫기 전에 로컬 서버(DB 연결 등)를 꺼 두세요.'
      : bluetoothOffEnabled
        ? '외부 모니터나 전원이 연결돼 있으면 블루투스를 끄지 않습니다 — 연결을 확인하세요.'
        : "환경설정 → 전원에서 '잠잘 때 블루투스 끄기'를 켜 보세요.";
  return { title, message: `${parts.join(' · ')}. ${hint}` };
}
