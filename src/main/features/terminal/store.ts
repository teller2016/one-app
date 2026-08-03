// MO(모바일) 접속 서버 설정 — userData/terminal.json.
// 토큰은 접속 자격증명이므로 safeStorage 로 암호화해 저장한다.
import crypto from 'node:crypto';
import {
  decryptSecret,
  encryptSecret,
  readUserJson,
  writeUserJson,
} from '../../lib/store';

const FILE = 'terminal.json';
const DEFAULT_PORT = 18317;

type TerminalStore = {
  port: number;
  tokenEnc?: string; // safeStorage 암호화 토큰
  serverEnabled: boolean; // 켜져 있으면 앱 시작 시 서버 자동 시작
};

const read = (): TerminalStore =>
  readUserJson<TerminalStore>(FILE, { port: DEFAULT_PORT, serverEnabled: false });

export function getPort(): number {
  const p = read().port;
  return Number.isInteger(p) && p > 0 && p < 65536 ? p : DEFAULT_PORT;
}

export function getServerEnabled(): boolean {
  return !!read().serverEnabled;
}

export function setServerEnabled(enabled: boolean): void {
  writeUserJson(FILE, { ...read(), serverEnabled: !!enabled });
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
