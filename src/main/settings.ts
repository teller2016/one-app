// 앱 설정 저장 — 비밀번호는 Electron safeStorage(OS 키체인)로 암호화해 저장
import { app, safeStorage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import type { AppSettingsView, SaveSettingsInput } from '../shared/types';

interface StoredSettings {
  bizboxId: string;
  bizboxPasswordEnc?: string; // safeStorage 로 암호화된 비밀번호(base64)
}

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

function readStored(): StoredSettings {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) as StoredSettings;
  } catch {
    return { bizboxId: '' };
  }
}

function writeStored(s: StoredSettings) {
  fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2), 'utf8');
}

/** 렌더러에 보낼 안전한 형태 — 비밀번호 값은 보내지 않고 "설정됨" 여부만 */
export function getSettingsForRenderer(): AppSettingsView {
  const s = readStored();
  return { bizboxId: s.bizboxId ?? '', hasPassword: !!s.bizboxPasswordEnc };
}

export function saveSettings(input: SaveSettingsInput): AppSettingsView {
  const next: StoredSettings = {
    ...readStored(),
    bizboxId: input.bizboxId ?? '',
  };
  // 비밀번호는 입력이 있을 때만 갱신 (빈 값이면 기존 유지)
  if (input.password && input.password.length > 0) {
    next.bizboxPasswordEnc = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(input.password).toString('base64')
      : Buffer.from(input.password, 'utf8').toString('base64');
  }
  writeStored(next);
  return getSettingsForRenderer();
}

/** 매크로 실행용 자격증명 복호화. 없으면 null */
export function getCredentials(): { id: string; password: string } | null {
  const s = readStored();
  if (!s.bizboxId || !s.bizboxPasswordEnc) return null;
  try {
    const buf = Buffer.from(s.bizboxPasswordEnc, 'base64');
    const password = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(buf)
      : buf.toString('utf8');
    return { id: s.bizboxId, password };
  } catch {
    return null;
  }
}
