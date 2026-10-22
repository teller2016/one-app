import { ipcMain, type WebContents } from 'electron';
import { closePage, type Page } from '../../lib/browser';
import { runMacro } from './runMacro';
import { resolveBaseDate } from './scheduleUtils';
import { recordScheduleToNotion } from './notion';
import { SCHEDULE_CONFIG } from './config';
import {
  markScheduleRegistered,
  startScheduleRegisterReminder,
} from './registerReminder';
import { getCredentials } from '../settings/store';
import { readUserJson, writeUserJson } from '../../lib/store';
import {
  SCHEDULE_DEFAULT_START_TIME,
  SCHEDULE_START_CONFIG_DEFAULT,
  type ScheduleNotionRecordPayload,
  type ScheduleOutputChunk,
  type ScheduleRunPayload,
  type ScheduleRunStatus,
  type ScheduleStartConfig,
  type ScheduleWorkItem,
  type ScheduleWorklog,
} from '../../../shared/types';

let running = false;
let currentPage: Page | null = null;
// 실행 세대 — [중지] 뒤 다시 실행하면 옛 실행의 로그·완료·정리가 새 실행 상태를 건드리지 않게
// 한다(옛 실행은 창이 닫혀 늦게 실패하며 done(1)·running=false 를 보냈다).
let runGen = 0;
// 이번 실행의 로그 — 섹션을 옮겼다 돌아오면(재마운트) 렌더러가 schedule:status 로 되살린다
let runLog: ScheduleOutputChunk[] = [];
const RUN_LOG_MAX = 500;

/** 창이 닫혔으면 보내지 않는다 — 파괴된 sender 의 send 는 throw 해 등록을 중간에 끊었다 */
function safeSend(sender: WebContents, channel: string, payload: unknown): void {
  if (sender.isDestroyed()) return;
  try {
    sender.send(channel, payload);
  } catch {
    // destroyed 체크 후에도 남는 종료 타이밍 예외 — 무시
  }
}

// 작업 기록 — localStorage 는 강제 종료 시 디스크 flush 가 안 돼 유실되므로
// (2026-07-29 실측: 쓰기 후 45초에도 leveldb 미커밋) userData JSON 에 즉시 저장한다.
const WORKLOG_FILE = 'worklog.json';

// 요일별 기준 시작 시각 (재택/출근) — 등록 전 확인의 기준값
const START_CONFIG_FILE = 'schedule-start.json';

const isTime = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{1,2}:\d{2}$/.test(v);

/** 기준 시작 시각 저장본 보정 — 형식이 어긋난 필드는 기본값으로 되돌린다 */
function normalizeStartConfig(raw: unknown): ScheduleStartConfig {
  const source = (raw as Partial<ScheduleStartConfig>) ?? {};
  return {
    remoteDays: Array.isArray(source.remoteDays)
      ? source.remoteDays.filter(
          (d): d is number => typeof d === 'number' && d >= 1 && d <= 5,
        )
      : SCHEDULE_START_CONFIG_DEFAULT.remoteDays,
    remoteStart: isTime(source.remoteStart)
      ? source.remoteStart
      : SCHEDULE_START_CONFIG_DEFAULT.remoteStart,
    officeStart: isTime(source.officeStart)
      ? source.officeStart
      : SCHEDULE_START_CONFIG_DEFAULT.officeStart,
  };
}

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

/** 저장된 작업 기록(정규화) — IPC 와 루트 세션 도구(get_worklog)가 같은 것을 읽는다 */
export const readWorklog = (): ScheduleWorklog => normalizeWorklog(readUserJson<unknown>(WORKLOG_FILE, null));

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

export const readStartConfig = () =>
  normalizeStartConfig(readUserJson<unknown>(START_CONFIG_FILE, null));

/** 일정 등록 누락 알림 시작 — 앱 준비(ready) 뒤 main.ts 에서 호출 */
export function startScheduleRegisterCheck(): void {
  startScheduleRegisterReminder(readStartConfig);
}

/** 일정 등록 관련 IPC 핸들러 등록 (앱 내부 자동화 창으로 실행) */
export function registerScheduleIpc() {
  ipcMain.handle('schedule:run', async (event, payload: ScheduleRunPayload) => {
    const sender = event.sender;

    if (running) {
      // 진행 중인 실행의 로그에는 섞지 않는다
      safeSend(sender, 'schedule:output', {
        stream: 'stderr',
        data: '이미 실행 중입니다. 잠시 후 다시 시도하세요.\n',
      });
      return { ok: false, error: 'already_running' };
    }

    const gen = ++runGen;
    runLog = [];
    const isCurrent = () => gen === runGen;
    const send = (stream: string, data: string) => {
      if (!isCurrent()) return;
      runLog.push({ stream, data });
      if (runLog.length > RUN_LOG_MAX) runLog.splice(0, runLog.length - RUN_LOG_MAX);
      safeSend(sender, 'schedule:output', { stream, data });
    };
    const done = (code: number) => {
      if (!isCurrent()) return;
      safeSend(sender, 'schedule:done', { code });
    };

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
        // 창이 뜨기 전에 [중지]됐으면 새로 뜬 창도 닫는다(남은 단계는 닫힌 창에서 실패한다)
        if (isCurrent()) currentPage = pg;
        else closePage(pg);
      },
    })
      .then(() => {
        // 실제 등록만 기록한다 — 다음 평일 아침 누락 알림의 근거.
        // 메인 창이 닫혀 있어도(send 생략) 등록이 끝까지 갔으면 기록한다.
        if (!payload.testMode) markScheduleRegistered(baseDate);
        done(0);
      })
      .catch((err: unknown) => {
        send('stderr', `\n❌ 오류: ${(err as Error)?.message ?? String(err)}\n`);
        done(1);
      })
      .finally(() => {
        if (isCurrent()) running = false;
      });

    return { ok: true };
  });

  ipcMain.handle('schedule:worklog:get', readWorklog);

  ipcMain.handle('schedule:worklog:set', (_event, worklog: ScheduleWorklog) => {
    writeUserJson(WORKLOG_FILE, normalizeWorklog(worklog));
    return { ok: true };
  });

  ipcMain.handle('schedule:start-config:get', readStartConfig);

  ipcMain.handle(
    'schedule:start-config:set',
    (_event, config: ScheduleStartConfig) => {
      const normalized = normalizeStartConfig(config);
      writeUserJson(START_CONFIG_FILE, normalized);
      return normalized;
    },
  );

  // 노션 기록 — 외부 쓰기 채널이라 MO(폰)에 열지 않는다 (ipcMain.handle 유지)
  ipcMain.handle(
    'schedule:notion:record',
    (_event, payload: ScheduleNotionRecordPayload) =>
      recordScheduleToNotion(payload),
  );

  // 실행 상태 — 섹션 재마운트 때 [중지] 버튼·로그를 되살린다
  ipcMain.handle(
    'schedule:status',
    (): ScheduleRunStatus => ({
      running,
      log: runLog.map((c) => c.data).join(''),
    }),
  );

  ipcMain.handle('schedule:cancel', () => {
    if (!currentPage && !running) return { ok: false };
    // 세대를 넘겨 옛 실행의 남은 로그·완료·정리를 무시한다
    runGen++;
    if (currentPage) closePage(currentPage);
    currentPage = null;
    running = false;
    return { ok: true };
  });
}
