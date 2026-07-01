import { ipcMain } from 'electron';
import type { Browser } from 'puppeteer';
import { runMacro } from '../schedule/runMacro';
import { resolveBaseDate } from '../schedule/scheduleUtils';
import { SCHEDULE_CONFIG } from '../schedule/config';
import { getCredentials } from '../settings';
import type { ScheduleRunPayload } from '../../shared/types';

let running = false;
let currentBrowser: Browser | null = null;

/** 일정 등록 관련 IPC 핸들러 등록 (앱 내부에서 puppeteer 직접 실행) */
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

    // 1) 자격증명 확인
    const credentials = getCredentials();
    if (!credentials) {
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

    // 이전 실행 브라우저가 남아 있으면 닫기
    if (currentBrowser) {
      try {
        await currentBrowser.close();
      } catch {
        // 이미 닫혔거나 실패해도 무시
      }
      currentBrowser = null;
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
      credentials,
      onLog: (msg) => send('stdout', msg),
      onBrowser: (b) => {
        currentBrowser = b;
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

  ipcMain.handle('schedule:cancel', async () => {
    if (currentBrowser) {
      try {
        await currentBrowser.close();
      } catch {
        // 이미 닫혔거나 실패해도 무시
      }
      currentBrowser = null;
      running = false;
      return { ok: true };
    }
    return { ok: false };
  });
}
