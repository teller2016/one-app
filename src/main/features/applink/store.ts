// applink.kr API 키 저장 — safeStorage(OS 키체인)로 암호화해 userData 에만 둔다.
// (코드·리포에 키를 하드코딩하지 않는다.)
import {
  readUserJson,
  writeUserJson,
  encryptSecret,
  decryptSecret,
} from '../../lib/store';

interface StoredApplink {
  keyEnc?: string; // safeStorage 로 암호화된 X-API-KEY (base64)
}

const read = (): StoredApplink => readUserJson<StoredApplink>('applink.json', {});

export function hasApiKey(): boolean {
  return !!read().keyEnc;
}

export function getApiKey(): string | null {
  const enc = read().keyEnc;
  if (!enc) return null;
  return decryptSecret(enc);
}

export function saveApiKey(key: string): void {
  writeUserJson('applink.json', { keyEnc: encryptSecret(key) });
}
