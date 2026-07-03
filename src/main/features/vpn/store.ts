// VPN 설정 저장 — TOTP 시크릿은 safeStorage(OS 키체인)로 암호화해 저장
import { app, safeStorage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import type { SaveVpnSettingsInput, VpnSettingsView } from '../../../shared/types';
import { findOpenvpnBinary } from './config';
import { decodeBase32 } from './totp';

interface StoredVpn {
  username: string;
  totpSecretEnc?: string; // safeStorage 로 암호화된 TOTP 시크릿(base64)
  ovpnPath: string;
}

const vpnSettingsPath = () => path.join(app.getPath('userData'), 'vpn.json');

function readStored(): StoredVpn {
  try {
    return JSON.parse(fs.readFileSync(vpnSettingsPath(), 'utf8')) as StoredVpn;
  } catch {
    return { username: '', ovpnPath: '' };
  }
}

function writeStored(s: StoredVpn) {
  fs.writeFileSync(vpnSettingsPath(), JSON.stringify(s, null, 2), 'utf8');
}

/** 렌더러에 보낼 안전한 형태 — 시크릿 값은 보내지 않고 "설정됨" 여부만 */
export function getVpnSettingsForRenderer(): VpnSettingsView {
  const s = readStored();
  return {
    username: s.username ?? '',
    hasTotpSecret: !!s.totpSecretEnc,
    ovpnPath: s.ovpnPath ?? '',
    openvpnInstalled: !!findOpenvpnBinary(),
  };
}

export function saveVpnSettings(input: SaveVpnSettingsInput): VpnSettingsView {
  const next: StoredVpn = {
    ...readStored(),
    username: (input.username ?? '').trim(),
    ovpnPath: (input.ovpnPath ?? '').trim(),
  };
  // 시크릿은 입력이 있을 때만 갱신 (빈 값이면 기존 유지)
  if (input.totpSecret && input.totpSecret.trim().length > 0) {
    const secret = input.totpSecret.trim();
    decodeBase32(secret); // 잘못된 키 저장 방지 — 실패 시 throw
    next.totpSecretEnc = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(secret).toString('base64')
      : Buffer.from(secret, 'utf8').toString('base64');
  }
  writeStored(next);
  return getVpnSettingsForRenderer();
}

/** 연결용 자격증명 복호화. 설정이 없으면 null */
export function getVpnCredentials(): {
  username: string;
  totpSecret: string | null;
  ovpnPath: string;
} | null {
  const s = readStored();
  if (!s.username) return null;
  let totpSecret: string | null = null;
  if (s.totpSecretEnc) {
    try {
      const buf = Buffer.from(s.totpSecretEnc, 'base64');
      totpSecret = safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(buf)
        : buf.toString('utf8');
    } catch {
      totpSecret = null;
    }
  }
  return { username: s.username, totpSecret, ovpnPath: s.ovpnPath ?? '' };
}
