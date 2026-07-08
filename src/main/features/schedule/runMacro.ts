// 일정 매크로 실행 흐름 (Day_Schedule_Macro/index.js 의 runMacro 이식)
import puppeteer, { type Browser } from 'puppeteer';
import { SCHEDULE_CONFIG } from './config';
import { PageMacro } from './pageMacro';
import { getDateTimeFormat, getFilteredData } from './scheduleUtils';

export interface RunMacroOptions {
  lines: string[];
  startTime: number;
  baseDate: Date;
  testMode: boolean;
  credentials: { id: string; password: string };
  onLog: (msg: string) => void;
  onBrowser?: (browser: Browser) => void; // 취소(브라우저 닫기)용 참조 전달
}

export async function runMacro(opts: RunMacroOptions): Promise<void> {
  const { lines, startTime, baseDate, testMode, credentials, onLog, onBrowser } =
    opts;

  // 시스템에 설치된 Google Chrome 사용 (배포판에서 Chromium 동봉 없이 동작)
  const browser = await puppeteer.launch({ headless: false, channel: 'chrome' });
  onBrowser?.(browser);

  try {
    const page = await browser.newPage();
    await page.setViewport(SCHEDULE_CONFIG.viewport);
    await page.goto(SCHEDULE_CONFIG.bizboxURL);

    const macro = new PageMacro(page);
    macro.ignoreAlert();

    onLog('🔐 로그인 중...\n');
    await macro.login(credentials.id, credentials.password);
    await macro.moveToSchedulePage();

    if (testMode) {
      onLog('✅ 테스트 모드: 일정 페이지 이동까지 완료\n');
      return;
    }

    const dataList = getFilteredData(
      lines,
      startTime,
      SCHEDULE_CONFIG.lunchStartTime,
      SCHEDULE_CONFIG.lunchEndTime,
      onLog,
    );

    for (const item of dataList) {
      await new Promise((resolve) =>
        setTimeout(resolve, SCHEDULE_CONFIG.scheduleDelayMs),
      );
      await macro.addSchedule(
        item.title,
        getDateTimeFormat(item.start, baseDate),
        getDateTimeFormat(item.end, baseDate),
      );
      onLog(`📅 등록: ${item.start} ~ ${item.end}  ${item.title}\n`);
    }

    onLog(`\n✅ 총 ${dataList.length}개 일정 등록 완료\n`);
  } finally {
    if (SCHEDULE_CONFIG.closeBrowserOnFinish) {
      await browser.close();
    }
  }
}
