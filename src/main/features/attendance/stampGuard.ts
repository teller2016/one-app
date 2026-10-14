// 출퇴근 이중 찍기 방지 — 찍기 직전에 다시 읽은 근태로 "이미 찍혔는가"를 판정한다.
//
// 화면은 다음 행동(`nextAction`)으로 버튼을 막지만, 그 값은 최대 90초 캐시라 낡을 수 있고
// 폰(MO)·리마인더 알럿 경로는 main 에 바로 들어온다. 그룹웨어 confirm 은 자동 수락되므로
// main 이 막지 않으면 이미 찍힌 시각이 덮어써진다.
import type { AttendanceInfo } from '../../../shared/types';

/**
 * 이미 찍힌 시각 — 다시 찍으면 안 되면 그 시각(HH:MM), 찍어도 되면 null.
 * - 출근: 위젯 날짜가 오늘일 때만 본다(자정 직후엔 위젯이 전날 기록을 보여줄 수 있다)
 * - 퇴근: 날짜를 보지 않는다 — `info.date` 는 출근 기준이라 자정 넘긴 야근의 퇴근도 같은 날로 묶인다
 */
export function alreadyStampedTime(
  action: 'come' | 'leave',
  info: Pick<AttendanceInfo, 'comeTime' | 'leaveTime' | 'date'>,
  widgetToday: string,
): string | null {
  if (action === 'come') return info.date === widgetToday ? info.comeTime : null;
  return info.leaveTime;
}

/** 이미 찍혀 있어 찍지 않았다 — 호출부는 실패가 아니라 '이미 처리됨'으로 다룬다 */
export class AttendanceAlreadyStampedError extends Error {
  constructor(
    readonly action: 'come' | 'leave',
    readonly time: string,
    /** 찍기 직전에 읽은 근태 — 위젯을 실제 상태로 맞출 때 쓴다 */
    readonly info: AttendanceInfo,
  ) {
    super(`이미 ${time} 에 ${action === 'come' ? '출근' : '퇴근'}이 찍혀 있습니다.`);
    this.name = 'AttendanceAlreadyStampedError';
  }
}
