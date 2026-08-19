// 터미널 상태 판정 규칙 테스트 — status.ts 의 순수 함수만 다룬다.
//
// 여기 있는 케이스는 대부분 **실제로 신고됐던 버그**다. 규칙을 손볼 때 이 파일이
// 깨지면, 예전에 고쳤던 증상이 되살아난 것이다 (각 테스트에 어떤 증상인지 적어 뒀다).
import { describe, expect, it } from 'vitest';
import {
  BEL_SILENCE_MS,
  MIN_TURN_BYTES,
  NOTIFY_INPUT_GAP_MS,
  NOTIFY_RECHECK_PAD_MS,
  WAIT_SILENCE_MS,
  decideSilence,
  decideWaitingNotify,
  type NotifyGateInput,
  type SilenceInput,
} from './status';

const NOW = 1_000_000; // 고정 기준 시각 — Date.now() 를 쓰지 않으므로 테스트가 흔들리지 않는다

/** busy 에이전트 세션의 기본형 — 각 테스트는 필요한 필드만 덮어쓴다 */
const busy = (over: Partial<SilenceInput> = {}): SilenceInput => ({
  status: 'busy',
  agentId: 'claude',
  bellAt: 0,
  lastInputAt: NOW - 60_000,
  lastOutputAt: NOW - 60_000,
  bytesSinceInput: 1000,
  ...over,
});

describe('decideSilence — 침묵 판정', () => {
  it('busy 가 아니면 판정하지 않는다', () => {
    for (const status of ['idle', 'waiting'] as const) {
      expect(decideSilence(busy({ status }), NOW)).toBeNull();
    }
  });

  it('침묵이 2.5초에 못 미치면 아직 판정하지 않는다', () => {
    const s = busy({ lastOutputAt: NOW - (WAIT_SILENCE_MS - 1) });
    expect(decideSilence(s, NOW)).toBeNull();
  });

  it('2.5초 침묵 + 턴 산출물이 있으면 waiting', () => {
    const s = busy({ lastOutputAt: NOW - WAIT_SILENCE_MS });
    expect(decideSilence(s, NOW)).toEqual({ next: 'waiting', why: 'silence' });
  });

  it('순수 셸(shell)은 아무리 조용해도 waiting 이 아니라 idle', () => {
    // 증상: ls 한 번 쳤을 뿐인데 사이드바에 입력대기 뱃지가 뜬다
    const s = busy({ agentId: 'shell', lastOutputAt: NOW - 10_000 });
    expect(decideSilence(s, NOW)).toEqual({ next: 'idle', why: 'silence' });
  });

  it('출력이 키 에코 수준(50B 미만)이면 idle — 턴 산출물로 안 친다', () => {
    const s = busy({
      lastOutputAt: NOW - 10_000,
      bytesSinceInput: MIN_TURN_BYTES - 1,
    });
    expect(decideSilence(s, NOW)).toEqual({ next: 'idle', why: 'silence' });
  });

  it('임계와 같은 바이트(50B)는 턴 산출물로 친다 — 경계 포함', () => {
    // ⚠️ 임계를 크게 잡았다가 claude 래퍼의 계정 선택 프롬프트(145B)를 놓친 적이 있다
    const s = busy({
      lastOutputAt: NOW - 10_000,
      bytesSinceInput: MIN_TURN_BYTES,
    });
    expect(decideSilence(s, NOW)).toEqual({ next: 'waiting', why: 'silence' });
  });

  describe('BEL(에이전트의 주의 요청)', () => {
    it('300ms 침묵만으로 조기 판정하고, 바이트 임계를 면제한다', () => {
      const s = busy({
        lastInputAt: NOW - 60_000,
        bellAt: NOW - 1_000, // 입력보다 최근 = 살아 있는 BEL
        lastOutputAt: NOW - BEL_SILENCE_MS,
        bytesSinceInput: 0, // 출력이 없어도 BEL 이면 waiting
      });
      expect(decideSilence(s, NOW)).toEqual({ next: 'waiting', why: 'bel' });
    });

    it('입력보다 오래된 BEL 은 무시한다 — 소비된 BEL 이 계속 면제를 발급하면 안 된다', () => {
      // 증상: 끝난 세션이 busy↔waiting 을 쉼 없이 왕복하며 알림을 반복해서 두드림
      const s = busy({
        bellAt: NOW - 60_000,
        lastInputAt: NOW - 30_000,
        lastOutputAt: NOW - BEL_SILENCE_MS, // BEL 기준이었다면 이미 판정됐을 침묵
        bytesSinceInput: 0,
      });
      expect(decideSilence(s, NOW)).toBeNull(); // 2.5초 기준이므로 아직 이르다
    });
  });

  it('침묵은 출력·입력 중 더 최근 것을 기준으로 잰다', () => {
    // 출력은 오래됐지만 방금 타이핑했다면 아직 조용해진 게 아니다
    const s = busy({
      lastOutputAt: NOW - 60_000,
      lastInputAt: NOW - 100,
    });
    expect(decideSilence(s, NOW)).toBeNull();
  });
});

/** 알림 게이트 기본형 — 조용히 오래 지난 뒤 끝난 턴(= 알려야 하는 상황) */
const gate = (over: Partial<NotifyGateInput> = {}): NotifyGateInput => ({
  notifiedSinceInput: false,
  suppressNotifyUntil: 0,
  lastInputAt: NOW - 60_000,
  lastInputSubmit: true,
  ...over,
});

describe('decideWaitingNotify — 알림 게이트', () => {
  it('오래전 입력의 턴이 끝나면 알린다', () => {
    expect(decideWaitingNotify(gate(), NOW)).toEqual({ action: 'fire' });
  });

  it('이번 턴에 이미 알렸으면 아무것도 하지 않는다', () => {
    // 증상: attach/resize 의 redraw 가 busy→waiting 을 다시 만들 때마다 소리가 중복
    expect(decideWaitingNotify(gate({ notifiedSinceInput: true }), NOW)).toEqual({
      action: 'skip',
      why: 'already-notified',
    });
  });

  it('생성·복원 grace 안이면 조용히 기회만 소진하고 남은 시간을 보고한다', () => {
    const d = decideWaitingNotify(
      gate({ suppressNotifyUntil: NOW + 3_000 }),
      NOW,
    );
    expect(d).toEqual({
      action: 'consume',
      why: 'create-grace',
      graceLeftMs: 3_000,
    });
  });

  it('입력 직후(5초 내)라도 제출로 시작한 턴이면 기회를 남기고 재판정한다', () => {
    // 증상: 5초 안에 끝나는 짧은 턴이 영영 무음 (2026-08-14 "대기인데 소리 안 남")
    const gapMs = 1_200;
    const d = decideWaitingNotify(
      gate({ lastInputAt: NOW - gapMs, lastInputSubmit: true }),
      NOW,
    );
    expect(d).toEqual({
      action: 'recheck',
      delayMs: NOTIFY_INPUT_GAP_MS - gapMs + NOTIFY_RECHECK_PAD_MS,
    });
  });

  it('제출 없이 타이핑만 멈춘 경우는 소진한다 — 프롬프트 앞의 사용자에게 소음', () => {
    const d = decideWaitingNotify(
      gate({ lastInputAt: NOW - 1_200, lastInputSubmit: false }),
      NOW,
    );
    expect(d).toEqual({ action: 'consume', why: 'no-submit' });
  });

  it('입력 간격이 정확히 5초면 바로 알린다 — 경계 포함', () => {
    const d = decideWaitingNotify(
      gate({ lastInputAt: NOW - NOTIFY_INPUT_GAP_MS }),
      NOW,
    );
    expect(d).toEqual({ action: 'fire' });
  });

  it('grace 판정이 already-notified 보다 뒤에 온다 — 순서가 바뀌면 로그 원인이 뒤집힌다', () => {
    const d = decideWaitingNotify(
      gate({ notifiedSinceInput: true, suppressNotifyUntil: NOW + 3_000 }),
      NOW,
    );
    expect(d).toEqual({ action: 'skip', why: 'already-notified' });
  });

  it('회귀: 제출로 grace 가 풀린(0) 세션은 grace 에 삼켜지지 않는다', () => {
    // 2026-08-19 신고 "특정 작업영역만 완료 토스트가 안 뜬다" — 복원 grace 가 끝나기
    // 직전에 waiting 이 온 세션이 통째로 삼켜졌다. noteInput 이 제출을 보면
    // suppressNotifyUntil 을 0 으로 푸는 것이 수정이고, 그때 이 판정이 나와야 한다.
    const d = decideWaitingNotify(gate({ suppressNotifyUntil: 0 }), NOW);
    expect(d).toEqual({ action: 'fire' });
  });
});
