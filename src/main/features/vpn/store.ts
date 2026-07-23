// VPN 설정 저장 — TOTP 시크릿은 safeStorage(OS 키체인)로 암호화해 저장
import type { SaveVpnSettingsInput, VpnSettingsView } from '../../../shared/types';
import { findOpenvpnBinary } from './config';
import { decodeBase32 } from './totp';
import {
  readUserJson,
  writeUserJson,
  encryptSecret,
  decryptSecret,
} from '../../lib/store';

interface StoredVpn {
  username: string;
  totpSecretEnc?: string; // safeStorage 로 암호화된 TOTP 시크릿(base64)
  ovpnPath: string;
}

const readStored = (): StoredVpn =>
  readUserJson<StoredVpn>('vpn.json', { username: '', ovpnPath: '' });

const writeStored = (s: StoredVpn) => writeUserJson('vpn.json', s);

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
    next.totpSecretEnc = encryptSecret(secret);
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
  const totpSecret = s.totpSecretEnc ? decryptSecret(s.totpSecretEnc) : null;
  return { username: s.username, totpSecret, ovpnPath: s.ovpnPath ?? '' };
}
