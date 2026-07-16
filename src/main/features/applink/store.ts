// applink.kr API 키 저장 — safeStorage(OS 키체인)로 암호화해 userData 에만 둔다.
// (코드·리포에 키를 하드코딩하지 않는다.)
import { app, safeStorage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

interface StoredApplink {
  keyEnc?: string; // safeStorage 로 암호화된 X-API-KEY (base64)
}

const filePath = () => path.join(app.getPath('userData'), 'applink.json');

function read(): StoredApplink {
  try {
    return JSON.parse(fs.readFileSync(filePath(), 'utf8')) as StoredApplink;
  } catch {
    return {};
  }
}

export function hasApiKey(): boolean {
  return !!read().keyEnc;
}

export function getApiKey(): string | null {
  const enc = read().keyEnc;
  if (!enc) return null;
  try {
    const buf = Buffer.from(enc, 'base64');
    return safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(buf)
      : buf.toString('utf8');
  } catch {
    return null;
  }
}

export function saveApiKey(key: string): void {
  const enc = safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(key).toString('base64')
    : Buffer.from(key, 'utf8').toString('base64');
  fs.writeFileSync(filePath(), JSON.stringify({ keyEnc: enc }, null, 2), 'utf8');
}
