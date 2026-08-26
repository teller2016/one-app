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
// 파싱 결과가 아니라 원문 문자열을 캐시한다 — 호출부가 반환 객체를 변형해도
// 캐시가 오염되지 않게 매 호출 parse 한다(파일 대비 메모리 파싱은 충분히 싸다).
//
// ⚠️ 개발 인스턴스와 빌드 앱이 같은 userData 를 공유하므로(devInstance.ts 참고)
// 이 파일들의 작성자는 더 이상 한 프로세스가 아니다. 캐시를 무조건 믿으면 상대가
// 저장한 변경을 못 보고 **오래된 값으로 통째 덮어쓴다** — 그래서 매 읽기마다 mtime·size 를
// 확인하고 달라졌을 때만 다시 읽는다(stat 은 read 보다 훨씬 싸서 캐시 이득은 유지된다).
type CacheEntry = {
  raw: string | null; // null = 파일 없음/읽기 실패
  mtimeMs: number;
  size: number;
};
const fileCache = new Map<string, CacheEntry>();

/** 캐시 판정용 stat — 파일이 없으면 null */
function statOf(target: string): { mtimeMs: number; size: number } | null {
  try {
    const st = fs.statSync(target);
    return { mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return null;
  }
}

/** userData 아래 JSON 파일 읽기 — 없거나 손상이면 fallback 반환 */
export function readUserJson<T>(filename: string, fallback: T): T {
  const target = userJsonPath(filename);
  const st = statOf(target);
  const cached = fileCache.get(filename);
  // 파일이 없는 상태(raw === null)가 캐시돼 있고 지금도 없으면 그대로 유효
  const isFresh =
    cached !== undefined &&
    (st === null
      ? cached.raw === null
      : cached.mtimeMs === st.mtimeMs && cached.size === st.size);

  let raw: string | null;
  if (isFresh) {
    raw = cached.raw;
  } else {
    try {
      raw = fs.readFileSync(target, 'utf8');
    } catch {
      raw = null;
    }
    fileCache.set(filename, {
      raw,
      mtimeMs: st?.mtimeMs ?? 0,
      size: st?.size ?? 0,
    });
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
  // 방금 쓴 내용의 mtime·size 로 캐시를 채운다 — 이걸 빠뜨리면 바로 다음 읽기가
  // 캐시를 무효로 보고 파일을 다시 읽는다(동작은 맞지만 캐시 이득이 사라진다)
  const st = statOf(target);
  fileCache.set(filename, {
    raw: json,
    mtimeMs: st?.mtimeMs ?? 0,
    size: st?.size ?? 0,
  });
}

/**
 * 키체인 암호화를 쓸 수 있는가 — 못 쓰면 비밀이 **평문 base64 로** 저장된다.
 *
 * 정상 환경(서명된 앱 + 로그인된 키체인)에서는 항상 true 다. false 가 되는 경우는
 * 서명이 깨졌거나 키체인이 잠긴 상태 — 이때 조용히 폴백하면 사용자는 비밀번호·API 토큰이
 * userData JSON 에 사실상 평문으로 쌓이는 걸 **모른 채** 계속 쓰게 된다.
 * 그래서 여기서 경고를 남기고, 환경설정 화면에도 배너로 알린다(`AppSettingsView.secureStorage`).
 */
export function isSecureStorageAvailable(): boolean {
  return safeStorage.isEncryptionAvailable();
}

// 프로세스당 한 번만 경고한다 (저장할 때마다 찍으면 로그가 의미를 잃는다)
let warnedInsecure = false;
function warnInsecureOnce(): void {
  if (warnedInsecure) return;
  warnedInsecure = true;
  console.warn(
    '[store] ⚠️ safeStorage 를 쓸 수 없어 비밀 값을 평문 base64 로 저장합니다. ' +
      '앱 서명이 깨졌거나 키체인이 잠겼을 수 있습니다 — 저장된 계정·토큰이 보호되지 않습니다.',
  );
}

/** 비밀 값을 safeStorage 로 암호화해 base64 로 (키체인 불가 환경은 평문 base64 폴백) */
export function encryptSecret(plain: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    warnInsecureOnce();
    return Buffer.from(plain, 'utf8').toString('base64');
  }
  return safeStorage.encryptString(plain).toString('base64');
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
