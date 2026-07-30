// 출퇴근 — headless 브라우저로 근태 위젯을 읽거나 출/퇴근을 찍는다. 창이 뜨지 않는다.
// 로그인은 하지 않고 **공용 그룹웨어 세션의 쿠키를 주입**해 메인 화면으로 직행한다
// (features/groupware/session.ts — 매번 로그인하던 방식보다 약 3배 빠르다).
import puppeteer, { type Dialog, type Page } from 'puppeteer';
import { ATTENDANCE_CONFIG } from './config';
import type { AttendanceInfo } from '../../../shared/types';
import { sleep, localDateKey } from '../../lib/util';
import { gotoWithSession, isLoginUrl } from '../groupware/session';

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

/** 페이지 이동 중 컨텍스트 파괴 오류인지 (그룹웨어가 리다이렉트를 여러 번 함) */
const isContextDestroyed = (err: unknown) =>
  /Execution context was destroyed|Cannot find context|Target closed|detached/i.test(
    (err as Error)?.message ?? '',
  );

/** 메인 페이지 재방문 (찍은 뒤 결과 확인용) — 세션은 이미 브라우저에 있다 */
async function gotoMain(page: Page) {
  await page
    .goto(ATTENDANCE_CONFIG.mainUrl, {
      waitUntil: 'networkidle2',
      timeout: 30000,
    })
    .catch((err: Error) => {
      // idle 타임아웃은 무시하고 진행 (포털에 상시 폴링 요청이 있을 수 있음)
      if (!/timeout/i.test(err.message)) throw err;
    });

  // 로그인 페이지로 튕겼으면 세션이 만료된 것
  if (isLoginUrl(page.url())) {
    throw new Error('그룹웨어 세션이 만료되었습니다 — 다시 시도해 주세요.');
  }
}

/** 근태 위젯 텍스트를 읽는다 — 이동 중 컨텍스트 파괴 시 재시도 */
async function readInfo(page: Page): Promise<AttendanceInfo> {
  const { selectors: sel } = ATTENDANCE_CONFIG;
  let lastErr: unknown = new Error('근태 위젯을 읽지 못했습니다.');

  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      // 위젯 텍스트는 페이지 스크립트가 로드 후 채우므로 "출근" 라벨이 뜰 때까지 대기
      await page.waitForFunction(
        (tabIn: string) => {
          const t = document.querySelector(tabIn)?.textContent ?? '';
          return /출근/.test(t);
        },
        { timeout: 20000 },
        sel.tabIn,
      );
      const texts = await page.evaluate(
        (tabIn: string, tabOut: string) => ({
          t1: document.querySelector(tabIn)?.textContent ?? '',
          t2: document.querySelector(tabOut)?.textContent ?? '',
        }),
        sel.tabIn,
        sel.tabOut,
      );

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
    } catch (err) {
      lastErr = err;
      // 리다이렉트 때문에 컨텍스트가 파괴된 경우만 잠시 후 재시도
      if (isContextDestroyed(err)) {
        await sleep(1500);
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
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
  // 시스템에 설치된 Google Chrome 사용 (배포판에서 Chromium 동봉 없이 동작)
  const browser = await puppeteer.launch({
    headless: 'new' as const,
    channel: 'chrome',
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    // confirm/alert 자동 수락 (출퇴근 저장 시 confirm 이 뜬다)
    page.on('dialog', (d: Dialog): void => {
      d.accept().catch((): void => {
        // 이미 닫힌 다이얼로그면 무시
      });
    });

    // 공용 세션 쿠키 주입 → 로그인 화면 없이 메인 직행 (세션 만료 시 내부에서 재로그인).
    // 근태 위젯은 아래 readInfo 가 직접 기다리므로 idle 대기는 생략한다(포털 폴링 때문에 느림)
    await gotoWithSession(page, ATTENDANCE_CONFIG.mainUrl, 'domcontentloaded');

    if (action !== 'status') {
      // 위젯 로드 확인 후 그룹웨어 자체 함수 호출 (사이트와 동일한 저장 흐름)
      await readInfo(page);
      const flag = ATTENDANCE_CONFIG.flags[action];
      await page.evaluate((f: number): void => {
        const w = window as unknown as {
          fnAttendCheck?: (n: number) => void;
        };
        if (typeof w.fnAttendCheck !== 'function') {
          throw new Error(
            '출퇴근 함수(fnAttendCheck)를 찾을 수 없습니다 — 그룹웨어 화면이 바뀌었을 수 있습니다.',
          );
        }
        w.fnAttendCheck(f);
      }, flag);
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
    try {
      await browser.close();
    } catch {
      // 이미 닫혔으면 무시
    }
  }
}
