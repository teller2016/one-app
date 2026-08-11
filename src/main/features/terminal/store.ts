// 터미널 설정 — userData/terminal.json (MO 접속 서버 + 입력대기 알림 강도).
// 토큰은 접속 자격증명이므로 safeStorage 로 암호화해 저장한다.
import crypto from 'node:crypto';
import type { TerminalNotifyLevel } from '../../../shared/types';
import { IS_DEV_INSTANCE } from '../../lib/devInstance';
import {
  decryptSecret,
  encryptSecret,
  readUserJson,
  writeUserJson,
} from '../../lib/store';

const FILE = 'terminal.json';
const DEFAULT_PORT = 18317;
const NOTIFY_LEVELS: TerminalNotifyLevel[] = ['badge', 'sound', 'alert'];

type TerminalStore = {
  port: number;
  tokenEnc?: string; // safeStorage 암호화 토큰
  serverEnabled: boolean; // 켜져 있으면 앱 시작 시 서버 자동 시작
  notifyLevel?: TerminalNotifyLevel; // 입력대기 알림 강도 (기본 sound — 뱃지+알림음)
};

const read = (): TerminalStore =>
  readUserJson<TerminalStore>(FILE, { port: DEFAULT_PORT, serverEnabled: false });

export function getPort(): number {
  const p = read().port;
  const port = Number.isInteger(p) && p > 0 && p < 65536 ? p : DEFAULT_PORT;
  // 개발 인스턴스는 한 칸 옆 포트를 쓴다 — 설정 파일(terminal.json)은 빌드 앱과 공유하므로
  // 그대로 두면 나중에 뜬 쪽이 EADDRINUSE 로 서버를 못 연다. 접속 URL·QR 도 이 값을 쓰므로
  // 폰에서 개발/빌드 중 어느 쪽에 붙을지도 포트로 갈린다.
  if (!IS_DEV_INSTANCE) return port;
  return port < 65535 ? port + 1 : port - 1;
}

export function getServerEnabled(): boolean {
  return !!read().serverEnabled;
}

export function setServerEnabled(enabled: boolean): void {
  writeUserJson(FILE, { ...read(), serverEnabled: !!enabled });
}

/** 입력대기 알림 강도 — 뱃지는 레벨 무관 항상, sound=+알림음, alert=+알럿 */
export function getNotifyLevel(): TerminalNotifyLevel {
  const level = read().notifyLevel;
  return level && NOTIFY_LEVELS.includes(level) ? level : 'sound';
}

export function setNotifyLevel(level: TerminalNotifyLevel): void {
  writeUserJson(FILE, {
    ...read(),
    notifyLevel: NOTIFY_LEVELS.includes(level) ? level : 'sound',
  });
}

/** 저장된 토큰 반환 — 없거나 복호화 실패(키체인 변경)면 새로 발급 */
export function getOrCreateToken(): string {
  const store = read();
  if (store.tokenEnc) {
    const token = decryptSecret(store.tokenEnc);
    if (token) return token;
  }
  return regenerateToken();
}

/** 토큰 재발급 — 기존 접속 URL·쿠키는 전부 무효화된다 */
export function regenerateToken(): string {
  const token = crypto.randomBytes(32).toString('base64url');
  writeUserJson(FILE, { ...read(), tokenEnc: encryptSecret(token) });
  return token;
}
