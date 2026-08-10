import { ipcMain } from 'electron';
import { closePage, type Page } from '../../lib/browser';
import { runMacro } from './runMacro';
import { resolveBaseDate } from './scheduleUtils';
import { SCHEDULE_CONFIG } from './config';
import { getCredentials } from '../settings/store';
import { readUserJson, writeUserJson } from '../../lib/store';
import {
  SCHEDULE_DEFAULT_START_TIME,
  type ScheduleRunPayload,
  type ScheduleWorkItem,
  type ScheduleWorklog,
} from '../../../shared/types';

let running = false;
let currentPage: Page | null = null;

// 작업 기록 — localStorage 는 강제 종료 시 디스크 flush 가 안 돼 유실되므로
// (2026-07-29 실측: 쓰기 후 45초에도 leveldb 미커밋) userData JSON 에 즉시 저장한다.
const WORKLOG_FILE = 'worklog.json';

const isTime = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{1,2}:\d{2}$/.test(v);

/** 저장본 정규화 — 항목만 담던 예전 배열 형식도 읽어 객체로 승격한다 */
function normalizeWorklog(raw: unknown): ScheduleWorklog {
  const source: Partial<ScheduleWorklog> = Array.isArray(raw)
    ? { items: raw as ScheduleWorkItem[] }
    : ((raw as Partial<ScheduleWorklog>) ?? {});
  const items = Array.isArray(source.items) ? source.items : [];
  return {
    items: items.filter(
      (it) =>
        typeof it?.id === 'string' &&
        typeof it?.end === 'string' &&
        typeof it?.title === 'string',
    ),
    startTime: isTime(source.startTime)
      ? source.startTime
      : SCHEDULE_DEFAULT_START_TIME,
  };
}

/**
 * 앱 종료 시 남은 자동화 창 정리 — 완료 후 확인용으로 열어 두는 창
 * (closeBrowserOnFinish=false)이 고아로 남지 않게 한다.
 * BrowserWindow 는 앱 프로세스 안에 있어 destroy 로 즉시 회수된다(예전 Chrome kill 대체).
 */
export function disposeScheduleBrowser(): void {
  if (!currentPage) return;
  closePage(currentPage);
  currentPage = null;
  running = false;
}

/** 일정 등록 관련 IPC 핸들러 등록 (앱 내부 자동화 창으로 실행) */
export function registerScheduleIpc() {
  ipcMain.handle('schedule:run', async (event, payload: ScheduleRunPayload) => {
    const sender = event.sender;
    const send = (stream: string, data: string) =>
      sender.send('schedule:output', { stream, data });
    const done = (code: number) => sender.send('schedule:done', { code });

    if (running) {
      send('stderr', '이미 실행 중입니다. 잠시 후 다시 시도하세요.\n');
      return { ok: false, error: 'already_running' };
    }

    // 1) 자격증명 확인 (로그인 자체는 공용 세션 모듈이 담당 — 여기서는 미설정만 걸러낸다)
    if (!getCredentials()) {
      send(
        'stderr',
        '⚠️ 비즈박스 계정 정보가 없습니다. [환경설정] 탭에서 아이디/비밀번호를 먼저 저장하세요.\n',
      );
      done(-1);
      return { ok: false, error: 'no_credentials' };
    }

    // 2) 일정 파싱
    const lines = (payload.scheduleText ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      send('stderr', '등록할 일정이 없습니다.\n');
      done(-1);
      return { ok: false, error: 'empty' };
    }

    // 3) 시작 시간
    const parsedStart = Number(String(payload.startTime ?? '').trim());
    const startTime = Number.isNaN(parsedStart)
      ? SCHEDULE_CONFIG.defaultWorkStartTime
      : parsedStart;

    // 4) 기준 날짜
    let baseDate: Date;
    try {
      baseDate = resolveBaseDate(payload.dateOption);
    } catch (err) {
      send('stderr', `${(err as Error).message}\n`);
      done(-1);
      return { ok: false, error: 'bad_date' };
    }

    // 이전 실행 창이 남아 있으면 닫기
    if (currentPage) {
      closePage(currentPage);
      currentPage = null;
    }

    send(
      'info',
      `▶︎ 일정 등록 시작 — 시작 ${startTime}, ${
        payload.testMode ? '테스트(등록 안 함)' : `${lines.length}건`
      }\n`,
    );

    running = true;
    // 브라우저가 열린 채 유지될 수 있으므로 완료를 기다리지 않고 즉시 반환.
    // 진행/완료는 이벤트로 전달한다.
    runMacro({
      lines,
      startTime,
      baseDate,
      testMode: !!payload.testMode,
      onLog: (msg) => send('stdout', msg),
      onPage: (pg) => {
        currentPage = pg;
      },
    })
      .then(() => done(0))
      .catch((err: unknown) => {
        send('stderr', `\n❌ 오류: ${(err as Error)?.message ?? String(err)}\n`);
        done(1);
      })
      .finally(() => {
        running = false;
      });

    return { ok: true };
  });

  ipcMain.handle('schedule:worklog:get', () =>
    normalizeWorklog(readUserJson<unknown>(WORKLOG_FILE, null)),
  );

  ipcMain.handle('schedule:worklog:set', (_event, worklog: ScheduleWorklog) => {
    writeUserJson(WORKLOG_FILE, normalizeWorklog(worklog));
    return { ok: true };
  });

  ipcMain.handle('schedule:cancel', () => {
    if (currentPage) {
      closePage(currentPage);
      currentPage = null;
      running = false;
      return { ok: true };
    }
    return { ok: false };
  });
}
