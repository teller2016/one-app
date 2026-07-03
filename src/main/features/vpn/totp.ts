// RFC 6238 TOTP 구현 — Google OTP 호환 (SHA-1 · 6자리 · 30초 주기)
import crypto from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** base32 시크릿 디코드 — 공백·하이픈·소문자·패딩(=) 허용 */
export function decodeBase32(secret: string): Buffer {
  const clean = secret.replace(/[\s-]/g, '').toUpperCase().replace(/=+$/, '');
  if (!clean || /[^A-Z2-7]/.test(clean)) {
    throw new Error('올바른 base32 시크릿 키가 아닙니다.');
  }
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | BASE32_ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** 주어진 시각 기준 6자리 TOTP 코드 생성 */
export function generateTotp(secret: string, nowMs = Date.now()): string {
  const key = decodeBase32(secret);
  const counter = Math.floor(nowMs / 1000 / 30);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    (hmac[offset + 1] << 16) |
    (hmac[offset + 2] << 8) |
    hmac[offset + 3];
  return String(code % 1_000_000).padStart(6, '0');
}

/** 현재 TOTP 창의 남은 유효 시간(초) */
export function totpRemainingSeconds(nowMs = Date.now()): number {
  return 30 - (Math.floor(nowMs / 1000) % 30);
}
