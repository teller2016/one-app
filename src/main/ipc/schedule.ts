import { ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { spawn, ChildProcess } from 'node:child_process';
import type { ScheduleRunPayload } from '../../shared/types';

// 기존 Day_Schedule_Macro(Puppeteer)를 수정 없이 자식 프로세스로 실행한다.
const SCHEDULE_MACRO_DIR = '/Users/sbjung/Desktop/Coding/Day_Schedule_Macro';

let scheduleChild: ChildProcess | null = null;

/** 일정 등록 관련 IPC 핸들러 등록 */
export function registerScheduleIpc() {
  ipcMain.handle('schedule:run', async (event, payload: ScheduleRunPayload) => {
    const sender = event.sender;
    const send = (stream: string, data: string) =>
      sender.send('schedule:output', { stream, data });

    // 매크로 엔트리 존재 확인
    const indexPath = path.join(SCHEDULE_MACRO_DIR, 'index.js');
    if (!fs.existsSync(indexPath)) {
      send('stderr', `매크로를 찾을 수 없습니다: ${indexPath}\n`);
      return { ok: false, error: 'macro_not_found' };
    }

    // 1) 텍스트창 내용을 schedule.txt 에 저장
    const schedulePath = path.join(SCHEDULE_MACRO_DIR, 'schedule.txt');
    try {
      fs.writeFileSync(schedulePath, payload.scheduleText ?? '', 'utf8');
      const lineCount = (payload.scheduleText ?? '')
        .split('\n')
        .filter((l) => l.trim()).length;
      send('info', `📝 schedule.txt 저장 (${lineCount}줄)\n`);
    } catch (err) {
      send('stderr', `schedule.txt 저장 실패: ${(err as Error).message}\n`);
      return { ok: false, error: 'write_failed' };
    }

    // 2) 실행 인자 구성 (숫자 인자를 주면 대화형을 건너뛰고 schedule.txt 로 바로 실행)
    const startTime = String(payload.startTime ?? '').trim() || '9.5';
    const args: string[] = [startTime];
    if (payload.dateOption?.type === 'yesterday') args.push('--days=-1');
    else if (payload.dateOption?.type === 'date' && payload.dateOption.date)
      args.push(`--date=${payload.dateOption.date}`);
    if (payload.testMode) args.push('--test');

    // 3) 이전 실행이 남아 있으면 정리 (이전 브라우저도 함께 닫힘)
    if (scheduleChild && !scheduleChild.killed) {
      scheduleChild.kill();
      scheduleChild = null;
    }

    // 4) 로그인 셸로 실행 (실행.command 와 동일하게 volta node PATH 확보)
    const quoted = args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' ');
    const cmd = `cd '${SCHEDULE_MACRO_DIR}' && node index.js ${quoted}`;
    send(
      'info',
      `▶︎ node index.js ${args.join(' ')}${
        payload.testMode ? '  (테스트: 등록 안 함)' : ''
      }\n`,
    );

    const child = spawn('/bin/zsh', ['-lc', cmd], { cwd: SCHEDULE_MACRO_DIR });
    scheduleChild = child;

    child.stdout?.on('data', (d) => send('stdout', d.toString()));
    child.stderr?.on('data', (d) => send('stderr', d.toString()));
    child.on('error', (err) => {
      send('stderr', `실행 오류: ${err.message}\n`);
      sender.send('schedule:done', { code: -1 });
      if (scheduleChild === child) scheduleChild = null;
    });
    child.on('close', (code) => {
      sender.send('schedule:done', { code });
      if (scheduleChild === child) scheduleChild = null;
    });

    // 브라우저가 열려 있는 동안 자식 프로세스가 유지될 수 있으므로,
    // 종료를 기다리지 않고 "시작됨"으로 즉시 반환한다. (완료/종료는 이벤트로 전달)
    return { ok: true };
  });

  ipcMain.handle('schedule:cancel', async () => {
    if (scheduleChild && !scheduleChild.killed) {
      scheduleChild.kill();
      scheduleChild = null;
      return { ok: true };
    }
    return { ok: false };
  });
}
