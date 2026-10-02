// Tailscale CLI 위치 — MO 서버 인증서(terminal/tls.ts)와 VPN 우회 경로(vpn/tailscaleBypass.ts)가 함께 쓴다.
import fs from 'node:fs';

/** 설치 후보 경로 (앱이 깔아 둔 CLI 링크 → Homebrew → 앱 번들 본체) */
const TAILSCALE_BINS = [
  '/usr/local/bin/tailscale',
  '/opt/homebrew/bin/tailscale',
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
];

/** 설치된 tailscale CLI 경로. 없으면 null */
export const findTailscale = (): string | null =>
  TAILSCALE_BINS.find((p) => fs.existsSync(p)) ?? null;
