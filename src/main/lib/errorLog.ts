// main 프로세스의 처리되지 않은 예외·Promise 거부를 파일에 남기고, 기능 하나의 등록 실패를 격리한다.
//
// ⚠️ Electron 기본 동작(43.4.1 실측, `lib/browser/init.ts` "Don't quit on fatal error"):
// - uncaughtException 에 앱 리스너가 없으면 영문 오류 대화상자("A JavaScript error occurred in the
//   main process" + 스택)를 띄운다. 앱은 죽지 않지만 대화상자를 닫을 때까지 main 이 멈춰
//   IPC·MO 서버·타이머가 다 선다. 리스너를 하나라도 달면 Electron 대화상자는 뜨지 않는다.
// - unhandledRejection 은 경고만 찍고 지나간다 — 설치본에선 어디에도 흔적이 남지 않았다.
// - 시작 중 `register*Ipc()` 하나가 던지면 main.ts 의 나머지(다른 등록·`app.on('ready')`)가
//   실행되지 않아 **창 없이 Dock 에만 떠 있는 앱**이 된다 → `runIsolated` 로 하나씩 감싼다(시작 시 도는 start* 도).
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { IS_DEV_INSTANCE } from './devInstance';

/** 넘으면 `.1` 로 밀어 두고 새로 쓴다 (최대 2개 파일) */
const MAX_LOG_BYTES = 1024 * 1024;

/** 기록 파일 — 개발 인스턴스와 설치본은 userData 를 공유하므로 이름을 가른다 */
export const MAIN_ERROR_LOG = IS_DEV_INSTANCE ? 'main-errors-dev.log' : 'main-errors.log';

const failedFeatures: string[] = [];

function describe(err: unknown): string {
  if (err instanceof Error) return err.stack ?? `${err.name}: ${err.message}`;
  return String(err);
}

/**
 * userData 의 기록 파일에 덧붙인다 — 1MB 를 넘으면 `.1` 로 밀어 두고 새로 쓴다.
 * 절대 던지지 않는다(예외 처리기 안에서 또 던지면 프로세스가 죽는다) — 실패하면 false.
 */
export function appendUserLog(fileName: string, text: string): boolean {
  try {
    const file = path.join(app.getPath('userData'), fileName);
    try {
      if (fs.statSync(file).size > MAX_LOG_BYTES) fs.renameSync(file, `${file}.1`);
    } catch {
      // 파일이 아직 없다 — 새로 만든다
    }
    fs.appendFileSync(file, text);
    return true;
  } catch {
    return false;
  }
}

/** 오류 한 건을 콘솔과 `userData/main-errors.log` 에 남긴다 — 이 함수 자체는 절대 던지지 않는다 */
export function recordMainError(kind: string, err: unknown): void {
  const text = describe(err);
  console.error(`[main:${kind}]`, text);
  appendUserLog(MAIN_ERROR_LOG, `[${new Date().toISOString()}] ${kind}\n${text}\n\n`);
}

/**
 * 전역 예외 처리기를 단다 — **기능 등록보다 먼저** 부를 것.
 * `onUncaught` 는 Electron 대화상자 대신 사용자에게 알릴 통로(토스트)다. 거부(rejection)는
 * 지금까지 조용히 지나가던 것이라 기록만 하고 알리지 않는다.
 */
export function installMainErrorGuards(onUncaught: (err: unknown) => void): void {
  process.on('uncaughtException', (err) => {
    recordMainError('uncaughtException', err);
    try {
      onUncaught(err);
    } catch {
      // 알림 실패는 무시 — 기록은 이미 남았다
    }
  });
  process.on('unhandledRejection', (reason) => {
    recordMainError('unhandledRejection', reason);
  });
}

/** 기능 등록·시작 하나를 격리한다 — 던져도 기록만 하고 나머지 기능·창 생성은 계속한다 */
export function runIsolated(name: string, run: () => void): void {
  try {
    run();
  } catch (err) {
    failedFeatures.push(name);
    recordMainError(`feature:${name}`, err);
  }
}

/** 등록·시작에 실패한 기능 이름 (창이 뜬 뒤 알릴 때 쓴다) */
export function getFailedFeatures(): readonly string[] {
  return failedFeatures;
}
