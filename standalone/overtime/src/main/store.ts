// 설정 저장 — userData/settings.json
// 비밀번호는 Electron safeStorage(Windows DPAPI · macOS 키체인)로 암호화해 저장한다.
import { app, safeStorage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { OVERTIME_CONFIG } from './config';
import type {
  AccountView,
  OvertimeDefaults,
  SaveAccountInput,
} from '../shared/types';

const FILE = 'settings.json';

interface Stored {
  id: string;
  passwordEnc?: string; // safeStorage 로 암호화된 비밀번호(base64)
  dept?: string; // 근무자 표의 소속 문구
  showBrowser?: boolean; // 자동화 창 표시 (기본 off)
  defaults?: OvertimeDefaults; // 마지막 작성 내용
}

const filePath = () => path.join(app.getPath('userData'), FILE);

const read = (): Stored => {
  try {
    return JSON.parse(fs.readFileSync(filePath(), 'utf8')) as Stored;
  } catch {
    return { id: '' };
  }
};

const write = (value: Stored) => {
  fs.writeFileSync(filePath(), JSON.stringify(value, null, 2), 'utf8');
};

/** 비밀 값을 safeStorage 로 암호화해 base64 로 (암호화 불가 환경은 평문 base64 폴백) */
const encryptSecret = (plain: string): string =>
  safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(plain).toString('base64')
    : Buffer.from(plain, 'utf8').toString('base64');

/** encryptSecret 역방향 — 복호화 실패(OS 계정 변경 등) 시 null */
const decryptSecret = (enc: string): string | null => {
  try {
    const buf = Buffer.from(enc, 'base64');
    return safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(buf)
      : buf.toString('utf8');
  } catch {
    return null;
  }
};

export function getAccountView(): AccountView {
  const s = read();
  return {
    id: s.id ?? '',
    hasPassword: !!s.passwordEnc,
    dept: s.dept ?? OVERTIME_CONFIG.defaultDept,
    showBrowser: s.showBrowser === true,
  };
}

export function saveAccount(input: SaveAccountInput): AccountView {
  const next: Stored = { ...read(), id: input.id.trim() };
  // 비밀번호는 입력이 있을 때만 갱신 (빈 값이면 기존 유지)
  if (input.password && input.password.length > 0) {
    next.passwordEnc = encryptSecret(input.password);
  }
  next.dept = input.dept.trim();
  if (typeof input.showBrowser === 'boolean') next.showBrowser = input.showBrowser;
  write(next);
  return getAccountView();
}

/** 자동화 실행용 계정 — ID·비밀번호·소속이 모두 있어야 실행 가능 (아니면 null) */
export function getAccount(): {
  id: string;
  password: string;
  dept: string;
  showBrowser: boolean;
} | null {
  const s = read();
  if (!s.id || !s.passwordEnc) return null;
  const password = decryptSecret(s.passwordEnc);
  if (password == null) return null;
  return {
    id: s.id,
    password,
    dept: s.dept ?? OVERTIME_CONFIG.defaultDept,
    showBrowser: s.showBrowser === true,
  };
}

const FALLBACK_DEFAULTS: OvertimeDefaults = { target: '', content: '', reason: '' };

export function getDefaults(): OvertimeDefaults {
  return { ...FALLBACK_DEFAULTS, ...(read().defaults ?? {}) };
}

export function saveDefaults(defaults: OvertimeDefaults): void {
  write({ ...read(), defaults });
}
