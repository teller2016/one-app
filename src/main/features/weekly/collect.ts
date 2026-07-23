// 주간보고 — headless 브라우저로 그룹웨어 개인별 주간 화면에서 일정 데이터를 수집한다.
// 엑셀 파일을 내려받지 않고, 엑셀 생성 함수(calendarExcelSave)가 서버로 보내는
// datas(JSON payload)를 form submit 후킹으로 가로채 그대로 사용한다.
import puppeteer, { type Browser, type Dialog, type Page } from 'puppeteer';
import { WEEKLY_CONFIG } from './config';
import type { WeeklyPeriod, WeeklyRawRow } from '../../../shared/types';
import { sleep } from '../../lib/util';

type Credentials = { id: string; password: string };
type ProgressFn = (step: string) => void;

export type WeeklyCollectData = { rows: WeeklyRawRow[]; period: WeeklyPeriod };

// 동시 실행 방지 (headless 브라우저 중복 기동 막기)
let running = false;

/** 텍스트가 정확히 일치하는 요소를 찾는 puppeteer XPath 셀렉터 */
const xpathByText = (text: string) => `::-p-xpath(//*[text()='${text}'])`;

/** 대상 주의 일요일 날짜(YYYYMMDD). weekOffset: 0=이번주, -1=지난주 */
function targetWeekStart(weekOffset: number): string {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay() + weekOffset * 7);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${dd}`;
}

const toDashDate = (yyyymmdd: string) =>
  `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;

/** 페이지 이동 중 컨텍스트 파괴 오류인지 (그룹웨어가 리다이렉트를 여러 번 함) */
const isContextDestroyed = (err: unknown) =>
  /Execution context was destroyed|Cannot find context|Target closed|detached/i.test(
    (err as Error)?.message ?? '',
  );

async function login(page: Page, credentials: Credentials) {
  const { selectors: sel } = WEEKLY_CONFIG;
  await page.goto(WEEKLY_CONFIG.loginUrl, { waitUntil: 'networkidle2' });

  // 로그인 폼이 있으면 로그인 수행 (세션이 있으면 메인으로 리다이렉트됨)
  if (await page.$(sel.userId)) {
    await page.type(sel.userId, credentials.id);
    await page.type(sel.userPw, credentials.password);
    await Promise.all([
      page
        .waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 })
        .catch((): null => null),
      page.click(sel.loginSubmit),
    ]);
    await sleep(1500); // 추가 리다이렉트 정리 대기
  }

  if (page.url().includes('egovLoginUsr')) {
    throw new Error('그룹웨어 로그인 실패 — 환경설정의 계정 정보를 확인하세요.');
  }
}

/**
 * 클릭이 무시되는 경우를 대비한 재시도 클릭 (일정 매크로와 동일 패턴).
 * 페이지 스크립트가 로드되기 전에 클릭하면 핸들러가 없어 조용히 무시되므로,
 * 기대 요소(expectSelector)가 화면에 보일 때까지 클릭을 반복한다.
 */
async function clickUntilVisible(
  page: Page,
  clickSelector: string,
  expectSelector: string,
  retries = 5,
) {
  await page.waitForSelector(clickSelector);
  for (let i = 0; i < retries; i++) {
    try {
      await page.click(clickSelector);
    } catch {
      // 일시적으로 클릭 불가(가려짐 등)여도 아래에서 재시도
    }
    try {
      await page.waitForSelector(expectSelector, {
        visible: true,
        timeout: 3000,
      });
      return;
    } catch {
      // 기대 요소가 안 나타남 — 클릭이 무시된 것으로 보고 다시 클릭
    }
  }
  throw new Error(
    `메뉴 클릭이 계속 무시됩니다 — 그룹웨어 화면 변경 여부를 확인하세요. (${expectSelector})`,
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
    return await page.evaluate((s) => {
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
    }, sel);
  } catch (err) {
    // 페이지/iframe 이동 중이면 잠시 후 재시도하도록 loading 취급
    if (isContextDestroyed(err)) return { state: 'loading' };
    throw err;
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
  const chapterSelector = xpathByText(sel.chapterText);
  await clickUntilVisible(page, sel.scheduleMenu, chapterSelector);
  await page.click(chapterSelector);

  // 캘린더(iframe) 로드 대기 — 이미 개인별 주간이면 그대로 사용
  let st = await waitFrameState(
    page,
    (s) => s.state === 'calendar' || s.state === 'personalWeek',
    30000,
    '일정 화면',
  );

  if (st.state === 'calendar') {
    onProgress?.('개인별 주간 보기로 전환 중…');
    await page.evaluate((s) => {
      const f = document.querySelector(s.contentIframe) as HTMLIFrameElement;
      const btn = f.contentDocument?.querySelector(
        s.personalWeekButton,
      ) as HTMLButtonElement | null;
      btn?.click();
    }, sel);
    st = await waitFrameState(
      page,
      (s) => s.state === 'personalWeek',
      30000,
      '개인별 주간 화면',
    );
  }
  return st;
}

/** beforeWeek()/nextWeek() 호출로 대상 주(일요일 시작)로 이동 */
async function moveToWeek(
  page: Page,
  weekOffset: number,
  onProgress?: ProgressFn,
): Promise<WeeklyPeriod> {
  const { selectors: sel } = WEEKLY_CONFIG;
  const target = targetWeekStart(weekOffset);

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
    await page.evaluate(
      (s, fn) => {
        const f = document.querySelector(s.contentIframe) as HTMLIFrameElement;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = f.contentWindow as any;
        if (typeof w[fn] !== 'function') {
          throw new Error(
            '주간 이동 함수를 찾을 수 없습니다 — 그룹웨어 화면이 바뀌었을 수 있습니다.',
          );
        }
        w[fn]();
      },
      sel,
      fnName,
    );
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

  const raw = await page.evaluate(async (s) => {
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
  }, sel);

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

/** 실제 수집 흐름 — collectWeekly 의 watchdog 안에서 실행된다 */
async function runCollect(
  browser: Browser,
  weekOffset: number,
  credentials: Credentials,
  onProgress?: ProgressFn,
): Promise<WeeklyCollectData> {
  const page = await browser.newPage();
  // 명시 timeout 이 없는 대기(waitForSelector 등)도 전부 30초로 제한
  page.setDefaultTimeout(30000);
  await page.setViewport(WEEKLY_CONFIG.viewport);
  // 예기치 않은 alert/confirm 으로 흐름이 멈추지 않도록 자동 닫기
  page.on('dialog', (d: Dialog): void => {
    d.dismiss().catch((): void => {
      // 이미 닫힌 다이얼로그면 무시
    });
  });

  onProgress?.('그룹웨어 로그인 중…');
  await login(page, credentials);

  await moveToPersonalWeek(page, onProgress);
  const period = await moveToWeek(page, weekOffset, onProgress);

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
      const rows = await captureRows(page);
      return { rows, period };
    } catch (err) {
      lastErr = err;
      await sleep(3000);
    }
  }
  throw lastErr;
}

// 수집 전체(브라우저 기동~캡처)의 최대 허용 시간 — 초과 시 강제 중단해 무한 로딩을 막는다
const COLLECT_DEADLINE_MS = 150000;

/**
 * 주간보고 데이터 수집 실행.
 * 로그인 → 일정 메뉴 → FE챕터 → 개인별 주간 → 대상 주 이동 → datas 캡처.
 */
export async function collectWeekly(
  weekOffset: number,
  credentials: Credentials,
  onProgress?: ProgressFn,
): Promise<WeeklyCollectData> {
  if (running) throw new Error('이미 주간보고 수집이 진행 중입니다.');
  running = true;
  let browser: Browser | null = null;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    // 시스템에 설치된 Google Chrome 사용 (배포판에서 Chromium 동봉 없이 동작)
    browser = await puppeteer.launch({
      headless: 'new' as const,
      channel: 'chrome',
      timeout: 30000,
    });
    // 어느 단계든 예상 밖으로 멈추면 deadline 이 reject 시켜 로딩이 끝나게 한다
    const deadline = new Promise<never>((_, reject) => {
      deadlineTimer = setTimeout(
        () =>
          reject(
            new Error(
              `수집이 ${COLLECT_DEADLINE_MS / 1000}초 안에 끝나지 않아 중단했습니다. 잠시 후 다시 시도하세요.`,
            ),
          ),
        COLLECT_DEADLINE_MS,
      );
    });
    return await Promise.race([
      runCollect(browser, weekOffset, credentials, onProgress),
      deadline,
    ]);
  } finally {
    running = false;
    if (deadlineTimer) clearTimeout(deadlineTimer);
    if (browser) {
      // close 가 멈추는 경우까지 대비해 5초 후 프로세스 강제 종료로 폴백
      const proc = browser.process();
      await Promise.race([
        browser.close().catch((): void => undefined),
        sleep(5000),
      ]);
      try {
        proc?.kill('SIGKILL');
      } catch {
        // 이미 종료된 프로세스면 무시
      }
    }
  }
}
