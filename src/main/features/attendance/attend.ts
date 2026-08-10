// 출퇴근 — 숨긴 자동화 창으로 근태 위젯을 읽거나 출/퇴근을 찍는다. 창이 뜨지 않는다.
// 로그인은 하지 않고 **공용 그룹웨어 세션의 쿠키를 주입**해 메인 화면으로 직행한다
// (features/groupware/session.ts — 매번 로그인하던 방식보다 약 3배 빠르다).
//
// ⚠️ puppeteer 대신 Electron BrowserWindow(`lib/browser.ts`)를 쓴다 — 시스템 Chrome
// 의존을 없애고 브라우저 기동 비용도 줄인다(2026-08 전환).
// confirm 자동 수락은 browser.ts 의 DIALOG_OVERRIDE 가 담당한다(출퇴근 저장 시 confirm 이 뜬다).
import { ATTENDANCE_CONFIG } from './config';
import type { AttendanceInfo } from '../../../shared/types';
import { sleep, localDateKey } from '../../lib/util';
import { gotoWithSessionInWindow, isLoginUrl } from '../groupware/session';
import {
  AUTOMATION_PARTITION,
  closePage,
  evalInPage,
  goto,
  openPage,
  waitInPage,
  type Page,
} from '../../lib/browser';

export type AttendanceAction = 'status' | 'come' | 'leave';

// 동시 실행 방지 (headless 브라우저 중복 기동 막기)
let running = false;

// 오늘 확인된 근태 — 위젯·리마인더·트레이 등 어떤 경로든 조회에 성공하면 갱신된다.
// 리마인더가 조회에 실패했을 때(VPN 블립·동시 실행 충돌) 이 값으로 이미 찍었는지 판단해
// 오알림을 막는다.
let knownToday: { date: string; comeTime: string | null; leaveTime: string | null } | null =
  null;

/** 오늘 확인된 근태 (없거나 날짜가 지났으면 null) */
export function getKnownAttendanceToday(): {
  comeTime: string | null;
  leaveTime: string | null;
} | null {
  if (!knownToday) return null;
  return knownToday.date === localDateKey(new Date())
    ? { comeTime: knownToday.comeTime, leaveTime: knownToday.leaveTime }
    : null;
}

/** 메인 페이지 재방문 (찍은 뒤 결과 확인용) — 세션은 이미 창에 있다 */
async function gotoMain(page: Page) {
  await goto(page, ATTENDANCE_CONFIG.mainUrl);
  // 로그인 페이지로 튕겼으면 세션이 만료된 것
  if (isLoginUrl(page.wc.getURL())) {
    throw new Error('그룹웨어 세션이 만료되었습니다 — 다시 시도해 주세요.');
  }
}

/**
 * 근태 위젯 텍스트를 읽는다.
 * 위젯 텍스트는 페이지 스크립트가 로드 후 채우므로 "출근" 라벨이 뜰 때까지 기다린다.
 * ⚠️ 그룹웨어가 리다이렉트를 여러 번 해서 그 사이 스크립트 실행이 실패할 수 있는데,
 *    `waitInPage` 가 실패를 삼키고 계속 폴링하므로 별도 재시도 루프가 필요 없다.
 */
async function readInfo(page: Page): Promise<AttendanceInfo> {
  const { selectors: sel } = ATTENDANCE_CONFIG;
  await waitInPage(
    page,
    (tabIn: string) => /출근/.test(document.querySelector(tabIn)?.textContent ?? ''),
    [sel.tabIn],
    { timeout: 20000, label: '근태 위젯' },
  );

  // 읽는 순간 리다이렉트가 겹칠 수 있어 몇 번 다시 시도한다
  let texts: { t1: string; t2: string } | null = null;
  for (let attempt = 0; attempt < 4 && !texts; attempt++) {
    texts = await evalInPage(
      page,
      (tabIn: string, tabOut: string) => ({
        t1: document.querySelector(tabIn)?.textContent ?? '',
        t2: document.querySelector(tabOut)?.textContent ?? '',
      }),
      [sel.tabIn, sel.tabOut],
    ).catch((): null => null);
    if (!texts) await sleep(1000);
  }
  if (!texts) throw new Error('근태 위젯을 읽지 못했습니다.');

  // "출근 2026.07.02 09:37:23" → 날짜·시각(HH:MM) 추출
  const parse = (s: string) => {
    const m = s.match(/(\d{4}\.\d{2}\.\d{2})\s+(\d{2}:\d{2})/);
    return m ? { date: m[1], time: m[2] } : null;
  };
  const come = parse(texts.t1);
  const leave = parse(texts.t2);
  return {
    comeTime: come?.time ?? null,
    leaveTime: leave?.time ?? null,
    date: come?.date ?? leave?.date ?? '',
    checkedAt: Date.now(),
  };
}

/**
 * 근태 조회/기록 실행.
 * - 'status': 현재 출퇴근 시각만 조회
 * - 'come' | 'leave': 그룹웨어의 fnAttendCheck 를 호출해 실제로 찍은 뒤 재조회
 */
export async function runAttendance(
  action: AttendanceAction,
): Promise<AttendanceInfo> {
  if (running) throw new Error('이미 근태 처리가 진행 중입니다.');
  running = true;
  const page = await openPage(false, {
    partition: AUTOMATION_PARTITION.attendance,
    title: '근태 조회',
  });
  try {
    // 공용 세션 쿠키 주입 → 로그인 화면 없이 메인 직행 (세션 만료 시 내부에서 재로그인).
    // 근태 위젯은 아래 readInfo 가 직접 기다린다(포털은 상시 폴링이라 idle 을 기다리면 느리다)
    await gotoWithSessionInWindow(page, ATTENDANCE_CONFIG.mainUrl);

    if (action !== 'status') {
      // 위젯 로드 확인 후 그룹웨어 자체 함수 호출 (사이트와 동일한 저장 흐름)
      await readInfo(page);
      const flag = ATTENDANCE_CONFIG.flags[action];
      const called = await evalInPage(
        page,
        (f: number) => {
          const w = window as unknown as { fnAttendCheck?: (n: number) => void };
          if (typeof w.fnAttendCheck !== 'function') return false;
          w.fnAttendCheck(f);
          return true;
        },
        [flag],
      );
      if (!called) {
        throw new Error(
          '출퇴근 함수(fnAttendCheck)를 찾을 수 없습니다 — 그룹웨어 화면이 바뀌었을 수 있습니다.',
        );
      }
      // 저장 처리 대기 후 새로 고침해 결과 확인
      await sleep(2500);
      await gotoMain(page);
    }

    const info = await readInfo(page);
    // 조회 성공 → 오늘 확인된 근태로 기록 (리마인더 폴백 판단에 사용)
    knownToday = {
      date: localDateKey(new Date()),
      comeTime: info.comeTime,
      leaveTime: info.leaveTime,
    };
    return info;
  } finally {
    running = false;
    closePage(page);
  }
}
