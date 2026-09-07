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

// ── 키체인 첫 접근(워밍업) ─────────────────────────────
// macOS 는 safeStorage 가 키체인 항목 `One App Safe Storage` 를 처음 읽을 때 프롬프트(허용·로그인
// 비밀번호)를 띄울 수 있다 — 접근 목록이 **빌드별 cdhash** 에 묶여 있어 재빌드 뒤 첫 실행마다 뜬다
// (2026-09-07 실측: 해시 60개 누적, 자가서명이라 구조적). 그 호출은 **동기**라 프롬프트가 닫힐 때까지
// main 스레드가 멈춘다. 창이 그려지기 전(ready 시점)에 멈추면 빈 창만 남아 먹통으로 보였다.
// 그래서 첫 접근을 메인 창이 그려진 뒤·앱이 앞에 있을 때 한 곳에서 1회 치르고(Chromium 이 키를 프로세스
// 수명 동안 캐시해 이후 복호화는 프롬프트 없이 즉시), 기동 경로의 소비자는 whenSecretsReady 를 기다린다.
let secretsReady: Promise<void> | null = null;
let resolveSecretsReady: (() => void) | null = null;
/** 워밍업이 어떤 이유로든 안 불리면(창 없는 기동 등) 기동 경로가 영영 막히지 않게 하는 상한 */
const SECRETS_READY_FALLBACK_MS = 15_000;

// 첫 접근 게이트 — 프로세스에서 safeStorage 를 처음 건드리는 호출 **직전에** 앱을 앞으로 가져온다(프롬프트가
// 다른 앱 뒤에 숨지 않게). 워밍업(did-finish-load)에만 붙였더니 사이드바 위젯(출퇴근·메일)이 마운트하며 보내는
// 첫 IPC 가 먼저 도착할 수 있었다 — React 이펙트와 load 이벤트의 도착 순서는 보장되지 않는다(2026-09-07 리뷰).
// 어떤 경로(워밍업·IPC·트레이)로 오든 여기서 1회 처리하므로 호출부는 순서를 신경 쓰지 않는다.
let firstAccessDone = false;
function beforeSecretAccess(): void {
  if (firstAccessDone) return;
  firstAccessDone = true;
  // 포커스를 **훔치는** 것은 패키징된 앱에서만 — 개발 인스턴스(`npm start`)는 사용자가 설치본 One App 의
  // 터미널에서 작업하는 옆에서 기동하므로, 훔치면 그 작업의 포커스를 빼앗는다(2026-09-07 리뷰).
  // 기준은 `!app.isPackaged` = lib/devInstance.ts 의 IS_DEV_INSTANCE 와 같다 — 이 파일은 단독 배포판 lite
  // 번들에도 실리므로 그 모듈을 import 하지 않고 기준만 맞춘다.
  if (app.isReady()) app.focus({ steal: app.isPackaged });
}

/** 키체인 워밍업이 끝날 때까지 기다린다 (기동 경로에서 decryptSecret 을 부르기 전에) */
export function whenSecretsReady(): Promise<void> {
  if (!secretsReady) {
    secretsReady = new Promise<void>((resolve) => {
      resolveSecretsReady = resolve;
      setTimeout(resolve, SECRETS_READY_FALLBACK_MS);
    });
  }
  return secretsReady;
}

/** 키체인 첫 접근을 지금 치른다 — main.ts 가 메인 창 did-finish-load 에서 부른다(앞으로 가져오기는 게이트가 한다) */
export function warmUpSecrets(): void {
  beforeSecretAccess();
  try {
    // 암호화만 해도 키를 읽는다 — 저장된 비밀이 없어도 프롬프트를 여기서 소화한다
    if (safeStorage.isEncryptionAvailable()) safeStorage.encryptString('warm-up');
  } catch {
    // 실패해도 진행 — 실제 복호화가 각자 null 로 처리한다
  }
  if (!secretsReady) secretsReady = Promise.resolve();
  else resolveSecretsReady?.();
}

/**
 * 키체인 암호화를 쓸 수 있는가.
 *
 * 정상 환경(서명된 앱 + 로그인된 키체인)에서는 항상 true 다. false 가 되는 경우는
 * 서명이 깨졌거나 키체인이 잠긴 상태 — 그때는 `encryptSecret` 이 **저장을 거부한다**.
 * 환경설정 화면이 이 값으로 배너를 띄운다(`AppSettingsView.secureStorage`).
 */
export function isSecureStorageAvailable(): boolean {
  beforeSecretAccess();
  return safeStorage.isEncryptionAvailable();
}

/**
 * 비밀 값을 safeStorage 로 암호화해 base64 로.
 *
 * ⚠️ 키체인을 못 쓰면 **평문으로 저장하지 않고 throw 한다**(2026-09-03). 예전에는 평문
 * base64 로 조용히 폴백했는데, 그러면 앱이 화면·README 로 약속한 "이 PC 에만 암호화 저장"이
 * 깨진 채로 그룹웨어 비밀번호가 userData JSON 에 쌓인다 — 특히 환경을 통제할 수 없는
 * 단독 배포판(One App Lite)을 받은 동료 PC 에서 위험하다. 저장이 실패하면 사용자가 즉시
 * 알고 조치(키체인 잠금 해제·재로그인·재서명)할 수 있다.
 *
 * 복호화(`decryptSecret`)는 **평문 base64 로 저장된 옛 값만** 폴백으로 읽는다(암호문은 null).
 */
export function encryptSecret(plain: string): string {
  beforeSecretAccess();
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'OS 보안 저장소(키체인)를 쓸 수 없어 비밀번호·토큰을 저장하지 않았습니다 — ' +
        '키체인이 잠겼거나 앱 서명이 바뀌었을 수 있습니다. 잠금을 풀고 다시 시도하세요.',
    );
  }
  return safeStorage.encryptString(plain).toString('base64');
}

/** safeStorage(Chromium OSCrypt) 암호문의 버전 프리픽스 — macOS 'v10', Linux 'v10'/'v11' */
const ENCRYPTED_PREFIX = /^v1[01]/;

/**
 * encryptSecret 역방향 — 복호화 실패(키체인 변경·프롬프트 취소·잠김) 시 null.
 *
 * ⚠️ 키체인을 못 쓰는 상태(`isEncryptionAvailable() === false` — 프롬프트를 취소하면 Chromium 이 키를 null 로
 * 캐시해 프로세스 내내 이렇다)에서 **암호문은 null** 이어야 한다. 예전엔 여기서도 utf8 폴백을 타서 암호문
 * 바이트가 **쓰레기 문자열(비-null)** 로 반환됐고, 호출부의 `=== null` 가드가 전부 통과해 그 값이 MO 토큰·
 * 비밀번호로 쓰였다(2026-09-07 리뷰 — 폰 접속 URL 이 쓰레기 토큰으로 발급되는 경로). 평문 base64 로 저장된
 * 옛 값(암호화 도입 전)만 그대로 읽는다.
 */
export function decryptSecret(enc: string): string | null {
  beforeSecretAccess();
  try {
    const buf = Buffer.from(enc, 'base64');
    if (safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(buf);
    return ENCRYPTED_PREFIX.test(buf.subarray(0, 3).toString('latin1')) ? null : buf.toString('utf8');
  } catch {
    return null;
  }
}
