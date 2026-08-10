// 주간보고 — 숨긴 자동화 창으로 그룹웨어 개인별 주간 화면에서 일정 데이터를 수집한다.
// 엑셀 파일을 내려받지 않고, 엑셀 생성 함수(calendarExcelSave)가 서버로 보내는
// datas(JSON payload)를 form submit 후킹으로 가로채 그대로 사용한다.
//
// ⚠️ puppeteer 대신 Electron BrowserWindow(`lib/browser.ts`)를 쓴다 — 시스템 Chrome 의존 제거
// (2026-08 전환). 후킹이 **in-page** 라서(네트워크 인터셉트가 아니라) 그대로 이식된다.
// XPath 셀렉터(`::-p-xpath`)만 텍스트 검색 함수로 대체했다.
// 로그인은 하지 않고 **공용 세션 쿠키를 주입**한다(2026-08-10 — 메일·근태와 로그인 공유).
import { WEEKLY_CONFIG } from './config';
import type { WeeklyPeriod, WeeklyRawRow } from '../../../shared/types';
import { sleep } from '../../lib/util';
import { GROUPWARE_CONFIG } from '../groupware/config';
import { gotoWithSessionInWindow } from '../groupware/session';
import {
  AUTOMATION_PARTITION,
  closePage,
  evalInPage,
  openPage,
  waitInPage,
  type Page,
} from '../../lib/browser';

type ProgressFn = (step: string) => void;

export type WeeklyCollectData = { rows: WeeklyRawRow[]; period: WeeklyPeriod };

// 동시 실행 방지 (headless 브라우저 중복 기동 막기)
let running = false;

/** 텍스트가 정확히 일치하는 말단 요소를 클릭 (puppeteer XPath 셀렉터 대체) */
async function clickByText(page: Page, text: string): Promise<boolean> {
  return evalInPage(
    page,
    (want: string) => {
      const squash = (s: string | null | undefined) =>
        (s ?? '').replace(/\s+/g, ' ').trim();
      const hit = Array.from(document.querySelectorAll('*')).find(
        (el) =>
          squash(el.textContent) === squash(want) &&
          !Array.from(el.children).some(
            (c) => squash(c.textContent) === squash(want),
          ),
      );
      if (!hit) return false;
      (hit as HTMLElement).click();
      return true;
    },
    [text],
  ).catch((): boolean => false);
}

/** 텍스트가 정확히 일치하는 요소가 나타날 때까지 대기 */
async function waitForText(page: Page, text: string, timeout: number) {
  await waitInPage(
    page,
    (want: string) => {
      const squash = (s: string | null | undefined) =>
        (s ?? '').replace(/\s+/g, ' ').trim();
      return Array.from(document.querySelectorAll('*')).some(
        (el) => squash(el.textContent) === squash(want),
      );
    },
    [text],
    { timeout, label: '메뉴 항목' },
  );
}

/** 대상 주의 시작일. monday=true 면 월요일(월~일 기준), 아니면 일요일(그룹웨어 페이지 기준) */
function weekAnchor(weekOffset: number, monday: boolean): Date {
  const d = new Date();
  const back = monday ? (d.getDay() + 6) % 7 : d.getDay();
  d.setDate(d.getDate() - back + weekOffset * 7);
  return d;
}

const toYmd = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${dd}`;
};

const addDays = (d: Date, n: number): Date => {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
};

// 그룹웨어 페이지가 주간 이동(특히 beforeWeek) 시 이전 주 행을 datas 에 누적한 채 남기므로,
// 캡처 결과를 신뢰하지 않고 대상 구간의 날짜(MM.DD) 집합으로 행을 한정한다.
/** from 부터 days 일 동안의 "MM.DD" 집합 */
const mmddSet = (from: Date, days: number): Set<string> => {
  const s = new Set<string>();
  for (let i = 0; i < days; i++) {
    const d = addDays(from, i);
    s.add(
      `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`,
    );
  }
  return s;
};

/** 행의 day("07.27 (월)") 에서 날짜(MM.DD)만 추출 */
const dayMmdd = (r: WeeklyRawRow) => r.day.slice(0, 5);

const toDashDate = (yyyymmdd: string) =>
  `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;

/**
 * 클릭이 무시되는 경우를 대비한 재시도 클릭 (일정 매크로와 동일 패턴).
 * 페이지 스크립트가 로드되기 전에 클릭하면 핸들러가 없어 조용히 무시되므로,
 * 기대 요소(expectSelector)가 화면에 보일 때까지 클릭을 반복한다.
 */
async function clickUntilTextVisible(
  page: Page,
  clickSelector: string,
  expectText: string,
  retries = 5,
) {
  await waitInPage(
    page,
    (sel: string) => !!document.querySelector(sel),
    [clickSelector],
    { timeout: 30000, label: '메뉴 버튼' },
  );
  for (let i = 0; i < retries; i++) {
    // 좌표 클릭이 아니라 JS 클릭 — 로딩 오버레이에 가로채이지 않는다
    await evalInPage(
      page,
      (sel: string) => {
        (document.querySelector(sel) as HTMLElement | null)?.click();
        return true;
      },
      [clickSelector],
    ).catch((): void => undefined);
    const ok = await waitForText(page, expectText, 3000)
      .then((): boolean => true)
      .catch((): boolean => false);
    if (ok) return;
  }
  throw new Error(
    `메뉴 클릭이 계속 무시됩니다 — 그룹웨어 화면 변경 여부를 확인하세요. (${expectText})`,
  );
}

type FrameState = {
  state: 'none' | 'loading' | 'calendar' | 'personalWeek';
  startDate?: string;
  endDate?: string;
  datasLen?: number; // datasExcel 행 수 (일정 목록 ajax 완료 후 채워짐)
  loadingVisible?: boolean; // 로딩바 표시 중 여부
};

/** 일정 iframe 의 현재 상태 조회 — top 페이지에서 same-origin iframe 내부에 접근 */
async function readFrameState(page: Page): Promise<FrameState> {
  const { selectors: sel } = WEEKLY_CONFIG;
  try {
    return await evalInPage(page, (s: typeof sel) => {
      const f = document.querySelector(s.contentIframe) as HTMLIFrameElement | null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const w = f?.contentWindow as any;
      if (!w) return { state: 'none' } as const;
      try {
        if (
          typeof w.calendarExcelSave === 'function' &&
          typeof w.startDate === 'string' &&
          w.document.querySelector(s.selectWeek)
        ) {
          const bar = w.document.querySelector(s.loadingBar) as HTMLElement | null;
          // 로딩바는 fixed 배치일 수 있어 offsetParent 대신 계산된 스타일로 판정
          const barStyle = bar ? w.getComputedStyle(bar) : null;
          return {
            state: 'personalWeek',
            startDate: String(w.startDate),
            endDate: String(w.endDate ?? ''),
            datasLen: Array.isArray(w.datasExcel) ? w.datasExcel.length : 0,
            loadingVisible:
              !!barStyle &&
              barStyle.display !== 'none' &&
              barStyle.visibility !== 'hidden',
          } as const;
        }
        if (w.document.querySelector(s.personalWeekButton)) {
          return { state: 'calendar' } as const;
        }
      } catch {
        return { state: 'none' } as const;
      }
      return { state: 'loading' } as const;
    }, [sel]);
  } catch {
    // 페이지/iframe 이동 중이거나 스크립트 실행이 끊기면 잠시 후 재시도하도록 loading 취급
    return { state: 'loading' };
  }
}

/** 조건을 만족하는 iframe 상태가 될 때까지 폴링 */
async function waitFrameState(
  page: Page,
  accept: (st: FrameState) => boolean,
  timeoutMs: number,
  description: string,
): Promise<FrameState> {
  const startedAt = Date.now();
  for (;;) {
    const st = await readFrameState(page);
    if (accept(st)) return st;
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(
        `${description} 대기 시간이 초과되었습니다 — 그룹웨어 화면 변경 여부를 확인하세요.`,
      );
    }
    await sleep(400);
  }
}

/** 일정 메뉴 → FE챕터 → 개인별 주간 화면까지 이동 */
async function moveToPersonalWeek(page: Page, onProgress?: ProgressFn) {
  const { selectors: sel } = WEEKLY_CONFIG;

  onProgress?.('일정 화면으로 이동 중…');
  await clickUntilTextVisible(page, sel.scheduleMenu, sel.chapterText);
  await clickByText(page, sel.chapterText);

  // 캘린더(iframe) 로드 대기 — 이미 개인별 주간이면 그대로 사용
  let st = await waitFrameState(
    page,
    (s) => s.state === 'calendar' || s.state === 'personalWeek',
    30000,
    '일정 화면',
  );

  if (st.state === 'calendar') {
    onProgress?.('개인별 주간 보기로 전환 중…');
    await evalInPage(
      page,
      (s: typeof sel) => {
        const f = document.querySelector(s.contentIframe) as HTMLIFrameElement | null;
        const btn = f?.contentDocument?.querySelector(
          s.personalWeekButton,
        ) as HTMLButtonElement | null;
        btn?.click();
        return true;
      },
      [sel],
    );
    st = await waitFrameState(
      page,
      (s) => s.state === 'personalWeek',
      30000,
      '개인별 주간 화면',
    );
  }
  return st;
}

/** beforeWeek()/nextWeek() 호출로 대상 주(target: 일요일 YYYYMMDD)로 이동 */
async function moveToWeek(
  page: Page,
  target: string,
  onProgress?: ProgressFn,
): Promise<WeeklyPeriod> {
  const { selectors: sel } = WEEKLY_CONFIG;

  // 최대 12주 거리까지만 이동 (무한 루프 방지)
  for (let i = 0; i < 12; i++) {
    const st = await waitFrameState(
      page,
      (s) => s.state === 'personalWeek',
      20000,
      '개인별 주간 화면',
    );
    const current = st.startDate ?? '';
    if (current === target) {
      return { start: toDashDate(current), end: toDashDate(st.endDate ?? current) };
    }

    onProgress?.('주간 이동 중…');
    const fnName = Number(current) > Number(target) ? 'beforeWeek' : 'nextWeek';
    const moved = await evalInPage(
      page,
      (s: typeof sel, fn: string) => {
        const f = document.querySelector(s.contentIframe) as HTMLIFrameElement | null;
        const w = f?.contentWindow as unknown as Record<string, unknown> | undefined;
        if (typeof w?.[fn] !== 'function') return false;
        (w[fn] as () => void)();
        return true;
      },
      [sel, fnName],
    );
    if (!moved) {
      throw new Error(
        '주간 이동 함수를 찾을 수 없습니다 — 그룹웨어 화면이 바뀌었을 수 있습니다.',
      );
    }
    // 주간 데이터가 ajax 로 갱신되어 startDate 가 바뀔 때까지 대기
    await waitFrameState(
      page,
      (s) =>
        s.state === 'personalWeek' && s.startDate !== current && !s.loadingVisible,
      20000,
      '주간 이동',
    );
  }
  throw new Error('대상 주까지 이동하지 못했습니다. (최대 12주)');
}

/** calendarExcelSave 의 form submit 을 후킹해 datas(JSON payload)만 가로챈다 */
async function captureRows(page: Page): Promise<WeeklyRawRow[]> {
  const { selectors: sel } = WEEKLY_CONFIG;

  const raw = await evalInPage(
    page,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (s: any) => {
    const f = document.querySelector(s.contentIframe) as HTMLIFrameElement;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = f.contentWindow as any;
    // 해당 주에 일정이 없으면 엑셀 생성 자체가 불가 — 빈 결과로 처리
    if (!Array.isArray(w.datasExcel) || w.datasExcel.length === 0) return '';

    return await new Promise<string>((resolve, reject) => {
      const proto = w.HTMLFormElement.prototype;
      const orig = proto.submit;
      let settled = false;
      const cleanup = () => {
        proto.submit = orig;
      };

      proto.submit = function (this: HTMLFormElement) {
        if (settled) return orig.apply(this);
        settled = true;
        cleanup();
        const inp = this.querySelector('[name="datas"]') as HTMLInputElement | null;
        if (inp) resolve(inp.value);
        else reject(new Error('datas 필드를 찾지 못했습니다.'));
      };

      try {
        w.calendarExcelSave();
      } catch (err) {
        settled = true;
        cleanup();
        reject(err as Error);
      }

      setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanup();
          reject(new Error('일정 데이터 생성 시간이 초과되었습니다.'));
        }
      }, 10000);
    });
  },
    [sel],
    // 페이지 안 타임아웃(10초)보다 넉넉하게
    30000,
  );

  if (!raw) return [];

  const parsed = JSON.parse(raw) as { datas?: unknown };
  const list = Array.isArray(parsed.datas) ? parsed.datas : [];
  return list.map((r: Record<string, unknown>) => ({
    day: String(r.day ?? ''),
    time: String(r.time1 ?? ''),
    title: String(r.title ?? ''),
    createName: String(r.createName ?? ''),
    userList: String(r.userList ?? ''),
  }));
}

/** 일정 목록 ajax 안정화 대기 후 datas 캡처 (제거하면 빈 결과 레이스 재발) */
async function stabilizeAndCapture(
  page: Page,
  onProgress?: ProgressFn,
): Promise<WeeklyRawRow[]> {
  onProgress?.('일정 데이터 수집 중…');
  // 일정 목록 ajax 가 끝나 datasExcel 이 채워질 때까지 대기.
  // 정말 일정이 없는 주면 계속 비어 있으므로, 시간 초과는 빈 주로 간주하고 진행한다.
  await waitFrameState(
    page,
    (s) =>
      s.state === 'personalWeek' && !s.loadingVisible && (s.datasLen ?? 0) > 0,
    20000,
    '일정 데이터 로드',
  ).catch((): undefined => undefined);

  // 주간 이동 직후에는 datasExcel 이 갱신 중일 수 있어 행 수가 안정될 때까지 대기
  let prevLen = -1;
  for (let i = 0; i < 8; i++) {
    const st = await readFrameState(page);
    const len = st.datasLen ?? 0;
    if (!st.loadingVisible && len === prevLen) break;
    prevLen = len;
    await sleep(800);
  }

  // 페이지 상태가 어중간하면 엑셀 저장 함수가 조용히 실패할 수 있어 재시도한다
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await captureRows(page);
    } catch (err) {
      lastErr = err;
      await sleep(3000);
    }
  }
  throw lastErr;
}

/** 실제 수집 흐름 — collectWeekly 의 watchdog 안에서 실행된다 */
async function runCollect(
  page: Page,
  weekOffset: number,
  monWeek: boolean,
  onProgress?: ProgressFn,
): Promise<WeeklyCollectData> {
  // 예기치 않은 alert/confirm 은 browser.ts 의 DIALOG_OVERRIDE 가 삼킨다

  onProgress?.('그룹웨어 접속 중…');
  // 공용 세션 쿠키를 주입해 로그인 화면을 건너뛰고 상단 메뉴가 있는 포털로 직행한다
  // (예전엔 여기서 직접 로그인했다 — 메일·근태와 로그인을 나눠 쓰게 되어 한 번을 줄였다)
  await gotoWithSessionInWindow(page, GROUPWARE_CONFIG.portalUrl);

  await moveToPersonalWeek(page, onProgress);

  if (!monWeek) {
    const sunday = weekAnchor(weekOffset, false);
    const period = await moveToWeek(page, toYmd(sunday), onProgress);
    const rows = await stabilizeAndCapture(page, onProgress);
    const inWeek = mmddSet(sunday, 7); // 일~토
    return { rows: rows.filter((r) => inWeek.has(dayMmdd(r))), period };
  }

  // 월~일 기준 — 페이지는 일~토 단위로만 데이터를 주므로 두 주를 이어 붙인다:
  // 주 A(월요일 전날 일요일 시작)에서 월~토, 다음 주 B에서 일요일 행만 취한다.
  const monday = weekAnchor(weekOffset, true);
  await moveToWeek(page, toYmd(addDays(monday, -1)), onProgress);
  const rowsA = await stabilizeAndCapture(page, onProgress);

  onProgress?.('마지막 일요일 일정 수집 중…');
  await moveToWeek(page, toYmd(addDays(monday, 6)), onProgress);
  const rowsB = await stabilizeAndCapture(page, onProgress);

  const monSat = mmddSet(monday, 6); // 월~토
  const sunOnly = mmddSet(addDays(monday, 6), 1); // 마지막 일요일 하루
  return {
    rows: [
      ...rowsA.filter((r) => monSat.has(dayMmdd(r))),
      ...rowsB.filter((r) => sunOnly.has(dayMmdd(r))),
    ],
    period: {
      start: toDashDate(toYmd(monday)),
      end: toDashDate(toYmd(addDays(monday, 6))),
    },
  };
}

// 수집 전체(브라우저 기동~캡처)의 최대 허용 시간 — 초과 시 강제 중단해 무한 로딩을 막는다
const COLLECT_DEADLINE_MS = 150000;
// 월~일 기준은 두 주를 수집하므로 여유 시간을 더 준다
const MON_WEEK_EXTRA_MS = 60000;

/**
 * 주간보고 데이터 수집 실행.
 * 로그인 → 일정 메뉴 → FE챕터 → 개인별 주간 → 대상 주 이동 → datas 캡처.
 * monWeek=true 면 월~일 기준으로 두 주(일~토 × 2)를 수집해 이어 붙인다.
 */
export async function collectWeekly(
  weekOffset: number,
  monWeek: boolean,
  onProgress?: ProgressFn,
): Promise<WeeklyCollectData> {
  if (running) throw new Error('이미 주간보고 수집이 진행 중입니다.');
  running = true;
  let page: Page | null = null;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const deadlineMs = COLLECT_DEADLINE_MS + (monWeek ? MON_WEEK_EXTRA_MS : 0);
  try {
    page = await openPage(false, {
      partition: AUTOMATION_PARTITION.weekly,
      title: '주간보고 수집',
    });
    // 어느 단계든 예상 밖으로 멈추면 deadline 이 reject 시켜 로딩이 끝나게 한다
    const deadline = new Promise<never>((_, reject) => {
      deadlineTimer = setTimeout(
        () =>
          reject(
            new Error(
              `수집이 ${deadlineMs / 1000}초 안에 끝나지 않아 중단했습니다. 잠시 후 다시 시도하세요.`,
            ),
          ),
        deadlineMs,
      );
    });
    return await Promise.race([
      runCollect(page, weekOffset, monWeek, onProgress),
      deadline,
    ]);
  } finally {
    running = false;
    if (deadlineTimer) clearTimeout(deadlineTimer);
    // 앱 프로세스 안의 창이라 destroy 로 즉시 회수된다 (예전 Chrome 프로세스 kill 폴백 불필요)
    closePage(page);
  }
}
