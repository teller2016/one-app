// 잠자기 사이클 판독 — `pmset -g log` 텍스트에서 "잠든 시각 ~ 깬 시각" 구간의 깨어남 횟수·배터리·
// 발열 비상 여부를 집계하고 폭주인지 판정한다. 순수 함수만 두어 wakeLog.test.ts 가 검증한다.
//
// 배경(2026-09-16): 덮개를 닫고 퇴근했는데 맥이 Wi-Fi/BT 칩 사유(`wifibt centauri-beta`)로 57분 동안
// 248번 다크웨이크해 41분을 켜진 채 있었고, 가방 안이라 방열이 안 되어 'Thermal Emergency Sleep' 까지
// 갔다(강제 종료). 같은 폭주가 그 전날들에도 매일 있었지만(98회·112회) 눈에 띄지 않았다 —
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
};

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
  };
  let sawSleep = false;
  for (const line of logText.split('\n')) {
    const m = LINE_RE.exec(line);
    if (!m) continue;
    const at = parsePmsetTime(m[1], m[2], m[3]);
    if (Number.isNaN(at) || at < sinceMs || at > untilMs) continue;
    const kind = m[4];
    const rest = m[5];

    if (kind === 'DarkWake' && rest.startsWith('DarkWake from')) summary.darkWakes++;
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

/** 폭주 토스트 문구 — 제목은 덮개 닫힘 여부로, 본문은 횟수·배터리·발열 순으로 */
export function formatWakeStormToast(s: SleepCycleSummary): { title: string; message: string } {
  const title = s.lidClosed
    ? '덮개를 닫은 동안 맥이 계속 깨어났습니다'
    : '잠자기 중 맥이 계속 깨어났습니다';
  const parts = [`${formatDuration(s.durationMs)} 동안 ${s.darkWakes}번 깨어남`];
  if (!s.charging && s.batteryStart !== null && s.batteryEnd !== null && s.batteryStart !== s.batteryEnd) {
    parts.push(`배터리 ${s.batteryStart}%→${s.batteryEnd}%`);
  }
  if (s.thermal) parts.push('발열 비상 잠자기 발생');
  return {
    title,
    message: `${parts.join(' · ')}. 잠자기 중 네트워크 유지(pmset tcpkeepalive) 설정을 확인하세요.`,
  };
}
