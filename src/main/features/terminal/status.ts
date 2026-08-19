// 터미널 세션 상태 판정 규칙 — **순수 함수만** 둔다 (부수효과·타이머·전역 상태 없음).
//
// pty.ts 에서 뽑아낸 이유: 이 규칙은 실측으로 다듬어 온 휴리스틱이라 조건 하나만
// 어긋나도 "알림이 안 온다 / 끝난 세션이 계속 울린다" 로 이어지는데, 예전에는
// setInterval 과 Session 맵에 묶여 있어 **호출 자체가 불가능**했다. 판정만 떼어
// 두면 케이스를 테스트로 고정할 수 있다 (status.test.ts).
//
// ⚠️ 여기에는 로그·상태 변경을 넣지 말 것 — 무엇을 할지만 결정해서 돌려주고,
//    실제 적용(setStatus·notifiedSinceInput·타이머)은 pty.ts 가 한다.
import type { TerminalSessionStatus } from '../../../shared/types';

// ── 상태 휴리스틱 상수 — "스피너=busy 유지, 완전 침묵=waiting" 방식.
// claude 스피너는 ~1Hz 로 계속 그리므로 완전 침묵 = 턴 종료로 안전하다.
// (대기 화면이 주기 출력을 하는 것으로 실측되면 "2초 윈도 출력 < 80B" 판정으로 전환할 것)
export const WAIT_SILENCE_MS = 2500; // busy → waiting/idle 판정 침묵 시간
export const BEL_SILENCE_MS = 300; // bare BEL(에이전트의 주의 요청) 후에는 짧은 침묵으로 조기 판정
// 입력 후 이 이상 출력해야 "턴 산출물" — 마지막 키 에코 수준(수 바이트)만 거른다.
// ⚠️ 크게 잡으면(600) claude 래퍼의 계정 선택 프롬프트(145B) 같은 작은 입력 대기를 놓친다(2026-08 실측).
// 타이핑 멈춤 오탐은 바이트가 아니라 NOTIFY_INPUT_GAP_MS(알림 게이트)가 막는다.
export const MIN_TURN_BYTES = 50;
// 최근 입력 직후의 waiting 전이는 상태(뱃지)만 바꾸고 소리·알럿은 생략 —
// 타이핑을 잠깐 멈춘 사용자는 이미 프롬프트 앞에 있다(불러올 필요가 없다)
export const NOTIFY_INPUT_GAP_MS = 5000;
// 재판정 타이머에 얹는 여유 — 게이트가 풀리는 순간 정확히 깨우면 경계에서 다시 걸린다
export const NOTIFY_RECHECK_PAD_MS = 100;

// ── 1) 침묵 판정 — busy 세션이 조용해졌을 때 waiting 인가 idle 인가 ──────────────

/** 침묵 판정에 필요한 세션 필드만 (pty.ts 의 Session 이 이 형태를 만족한다) */
export type SilenceInput = {
  status: TerminalSessionStatus;
  /** 'shell' 은 waiting 자격이 없다 — ls 한 번에 뱃지가 뜨면 안 된다 */
  agentId: string | undefined;
  /** 마지막 bare BEL 수신 시각 (0 = 없음) */
  bellAt: number;
  lastInputAt: number;
  lastOutputAt: number;
  /** 입력 이후 누적 출력 — "실제 턴 산출물" 판정 */
  bytesSinceInput: number;
};

export type SilenceDecision = {
  next: Extract<TerminalSessionStatus, 'waiting' | 'idle'>;
  why: 'bel' | 'silence';
};

/**
 * busy 세션의 침묵을 보고 다음 상태를 정한다. `null` 이면 아직 판정 시점이 아니다.
 *
 * ⚠️ 판정이 나면(= null 이 아니면) 호출부는 **BEL 을 소비**해야 한다(`bellAt = 0`).
 * 예전엔 BEL 이 다음 입력까지 남아 있어서, 완료 때 울린 BEL 하나가 이후의 모든
 * 출력에 '300ms 침묵 + 바이트 임계 면제'를 계속 발급했다 — 끝난 세션이
 * busy↔waiting 을 쉼 없이 왕복하며 알림 게이트를 반복해서 두드린 원인.
 */
export function decideSilence(
  s: SilenceInput,
  now: number,
): SilenceDecision | null {
  if (s.status !== 'busy') return null;
  // bare BEL 은 에이전트의 명시적 주의 요청 — 짧은 침묵으로 조기 판정 + 바이트 임계 면제
  const bell = s.bellAt > s.lastInputAt;
  const silence = bell ? BEL_SILENCE_MS : WAIT_SILENCE_MS;
  const lastActivity = Math.max(s.lastOutputAt, s.lastInputAt);
  if (now - lastActivity < silence) return null;
  if (s.agentId !== 'shell' && (bell || s.bytesSinceInput >= MIN_TURN_BYTES)) {
    return { next: 'waiting', why: bell ? 'bel' : 'silence' };
  }
  // 순수 셸(ls 한 번)과 에코 수준 출력은 waiting 자격이 없다 — 뱃지 오탐 차단
  return { next: 'idle', why: 'silence' };
}

// ── 2) 알림 게이트 — waiting 으로 전이했을 때 소리·알럿을 울릴 것인가 ────────────

/** 알림 게이트 판정에 필요한 세션 필드만 */
export type NotifyGateInput = {
  /** 이번 입력(턴)에 대한 waiting 알림 기회를 이미 소진했는지 */
  notifiedSinceInput: boolean;
  /** 이 시각 전의 waiting 전이는 알림 없이 상태만 (생성·복원 grace) */
  suppressNotifyUntil: number;
  lastInputAt: number;
  /** 마지막 입력에 제출(Enter)이 있었는지 */
  lastInputSubmit: boolean;
};

export type NotifyGateDecision =
  /** 지금 알린다 (호출부가 기회도 함께 소진한다) */
  | { action: 'fire' }
  /** 아무것도 하지 않는다 — 이미 이번 턴에 알렸다 */
  | { action: 'skip'; why: 'already-notified' }
  /** 알리지 않고 기회만 소진한다 */
  | { action: 'consume'; why: 'create-grace'; graceLeftMs: number }
  | { action: 'consume'; why: 'no-submit' }
  /** 게이트가 풀리는 시점에 다시 판정한다 (기회는 남겨 둔다) */
  | { action: 'recheck'; delayMs: number };

/**
 * waiting 전이 시 알림을 울릴지 정한다. 상태(뱃지)는 이 판정과 무관하게 이미 바뀐 뒤다.
 *
 * 알림 기회는 **입력(턴)당 1회** — attach/resize 의 SIGWINCH redraw 가 busy→waiting 을
 * 다시 만들어도(입력 없이) 소리가 중복되지 않는다.
 */
export function decideWaitingNotify(
  s: NotifyGateInput,
  now: number,
): NotifyGateDecision {
  if (s.notifiedSinceInput) return { action: 'skip', why: 'already-notified' };
  if (now < s.suppressNotifyUntil) {
    // 생성 grace — 초기 프롬프트는 조용히 기회 소진.
    // ⚠️ 제출(Enter)이 오면 noteInput 이 suppressNotifyUntil 을 0 으로 풀어 준다.
    // 안 풀면 사용자가 시킨 작업의 완료가 통째로 삼켜진다(2026-08-19 수정).
    return {
      action: 'consume',
      why: 'create-grace',
      graceLeftMs: s.suppressNotifyUntil - now,
    };
  }
  const gap = now - s.lastInputAt;
  if (gap >= NOTIFY_INPUT_GAP_MS) return { action: 'fire' };
  // 입력 직후(5초 내) 전이 — 예전엔 여기서도 기회를 소진해 **5초 안에 끝나는 짧은 턴이
  // 영영 무음**이 됐다(2026-08-14 사용자 신고 "대기인데 소리 안 남"). 제출(Enter)로 시작한
  // 턴이면 소진하지 않고 게이트가 풀리는 시점에 재판정한다 — 그때도 waiting 이면 알림.
  // 제출 없이 타이핑만 멈춘 경우는 기존대로 소진(프롬프트 앞의 사용자에게 소음 방지).
  if (!s.lastInputSubmit) return { action: 'consume', why: 'no-submit' };
  return {
    action: 'recheck',
    delayMs: NOTIFY_INPUT_GAP_MS - gap + NOTIFY_RECHECK_PAD_MS,
  };
}
