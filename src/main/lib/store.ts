// userData JSON 파일 스토어 + safeStorage 암복호화 공통 유틸.
// 각 기능 스토어(settings·deploy·vpn·prs·applink·reminders)가 반복하던
// 파일 읽기/쓰기·암복호화 보일러플레이트를 한곳에 모은다.
import { app, safeStorage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

const userJsonPath = (filename: string) =>
  path.join(app.getPath('userData'), filename);

// 파일 내용 캐시 — 폴링류(리마인더 30초 tick·설정 조회·MO 인증 등)가 같은 파일을
// 반복해 동기 읽기하던 낭비를 없앤다(2026-08-07 성능 감사: 리마인더만 하루 2,880회).
// 이 파일들의 작성자는 main 프로세스 하나뿐이라 쓰기 시 캐시를 함께 갱신하면 일관된다.
// 파싱 결과가 아니라 원문 문자열을 캐시한다 — 호출부가 반환 객체를 변형해도
// 캐시가 오염되지 않게 매 호출 parse 한다(파일 대비 메모리 파싱은 충분히 싸다).
const fileCache = new Map<string, string | null>(); // null = 파일 없음/읽기 실패

/** userData 아래 JSON 파일 읽기 — 없거나 손상이면 fallback 반환 */
export function readUserJson<T>(filename: string, fallback: T): T {
  let raw = fileCache.get(filename);
  if (raw === undefined) {
    try {
      raw = fs.readFileSync(userJsonPath(filename), 'utf8');
    } catch {
      raw = null;
    }
    fileCache.set(filename, raw);
  }
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * userData 아래 JSON 파일 쓰기 (pretty-print) — tmp+rename 원자적 쓰기.
 * 쓰기 도중 크래시해도 기존 파일이 반파되지 않는다(반파되면 readUserJson 의
 * fallback 폴백으로 설정이 조용히 초기화되던 위험 제거).
 */
export function writeUserJson(filename: string, value: unknown): void {
  const json = JSON.stringify(value, null, 2);
  const target = userJsonPath(filename);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, json, 'utf8');
  fs.renameSync(tmp, target);
  fileCache.set(filename, json);
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
