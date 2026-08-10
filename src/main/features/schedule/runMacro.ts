// 일정 매크로 실행 흐름 (Day_Schedule_Macro/index.js 의 runMacro 이식)
//
// ⚠️ puppeteer 대신 Electron BrowserWindow(`lib/browser.ts`)를 쓴다 — 시스템 Chrome 의존 제거
// (2026-08 전환). 사용자가 진행을 지켜보는 창이라 show=true 로 띄운다.
// 로그인은 하지 않고 **공용 세션 쿠키를 주입**한다(2026-08-10 — 메일·근태와 로그인 공유).
import { SCHEDULE_CONFIG } from './config';
import { PageMacro } from './pageMacro';
import { getDateTimeFormat, getFilteredData } from './scheduleUtils';
import { GROUPWARE_CONFIG } from '../groupware/config';
import { gotoWithSessionInWindow } from '../groupware/session';
import {
  AUTOMATION_PARTITION,
  closePage,
  openPage,
  releasePage,
  type Page,
} from '../../lib/browser';

export interface RunMacroOptions {
  lines: string[];
  startTime: number;
  baseDate: Date;
  testMode: boolean;
  onLog: (msg: string) => void;
  onPage?: (page: Page) => void; // 취소(창 닫기)용 참조 전달
}

export async function runMacro(opts: RunMacroOptions): Promise<void> {
  const { lines, startTime, baseDate, testMode, onLog, onPage } = opts;

  // 사용자가 등록 과정을 지켜보는 창 — 보이게 띄운다
  const page = await openPage(true, {
    partition: AUTOMATION_PARTITION.schedule,
    title: '일정 등록',
  });
  page.win.setSize(SCHEDULE_CONFIG.viewport.width, SCHEDULE_CONFIG.viewport.height);
  onPage?.(page);

  try {
    const macro = new PageMacro(page);
    macro.ignoreAlert();

    onLog('🔐 그룹웨어 접속 중...\n');
    // 공용 세션 쿠키를 주입해 로그인 화면을 건너뛰고 상단 메뉴가 있는 포털로 직행한다
    // (예전엔 여기서 직접 로그인했다 — 메일·근태와 로그인을 나눠 쓰게 되어 한 번을 줄였다)
    await gotoWithSessionInWindow(page, GROUPWARE_CONFIG.portalUrl);
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
      closePage(page);
    } else if (!page.win.isDestroyed()) {
      // 확인용으로 창을 남긴다 — 자동화 장치를 걷어내야 사용자가 정상적으로 쓸 수 있다
      await releasePage(page).catch((): void => undefined);
      page.win.setTitle('일정 등록 — 확인 후 닫으세요');
    }
  }
}
