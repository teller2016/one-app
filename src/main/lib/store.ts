// userData JSON 파일 스토어 + safeStorage 암복호화 공통 유틸.
// 각 기능 스토어(settings·deploy·vpn·prs·applink·reminders)가 반복하던
// 파일 읽기/쓰기·암복호화 보일러플레이트를 한곳에 모은다.
import { app, safeStorage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

const userJsonPath = (filename: string) =>
  path.join(app.getPath('userData'), filename);

/** userData 아래 JSON 파일 읽기 — 없거나 손상이면 fallback 반환 */
export function readUserJson<T>(filename: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(userJsonPath(filename), 'utf8')) as T;
  } catch {
    return fallback;
  }
}

/** userData 아래 JSON 파일 쓰기 (pretty-print) */
export function writeUserJson(filename: string, value: unknown): void {
  fs.writeFileSync(userJsonPath(filename), JSON.stringify(value, null, 2), 'utf8');
}

/** 비밀 값을 safeStorage 로 암호화해 base64 로 (키체인 불가 환경은 평문 base64 폴백) */
export function encryptSecret(plain: string): string {
  return safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(plain).toString('base64')
    : Buffer.from(plain, 'utf8').toString('base64');
}

/** encryptSecret 역방향 — 복호화 실패(키체인 변경 등) 시 null */
export function decryptSecret(enc: string): string | null {
  try {
    const buf = Buffer.from(enc, 'base64');
    return safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(buf)
      : buf.toString('utf8');
  } catch {
    return null;
  }
}
