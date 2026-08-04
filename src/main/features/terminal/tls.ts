// MO 서버용 TLS — Tailscale 이 MagicDNS 이름으로 발급하는 무료 인증서를 쓴다.
//
// 왜 HTTPS 가 필요한가: Chrome 은 **HTTPS 를 설치형 PWA 의 필수 조건**으로 본다(2025 년부터
// 서비스 워커 요구는 없어졌지만 HTTPS 는 예외 없음). 평문 HTTP 로 '홈 화면에 추가' 하면
// 그냥 탭 바로가기가 되어 주소창이 남는다. HTTPS 면 `display: standalone` 이 실제로 적용돼
// 주소창 없이 앱처럼 열리고, secure context 라 클립보드 API·wss 도 정상 동작한다.
//
// 전제: 사용자가 Tailscale 관리 콘솔에서 HTTPS Certificates 를 활성화해야 한다
// (안 되어 있으면 발급이 실패하고 서버는 HTTP 로 폴백한다).
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

/** 인증서 만료가 이 기간 안으로 들어오면 갱신 (Tailscale 인증서는 90일) */
const RENEW_BEFORE_MS = 20 * 24 * 60 * 60 * 1000;
const TAILSCALE_BINS = [
  '/usr/local/bin/tailscale',
  '/opt/homebrew/bin/tailscale',
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
];

export type TlsFiles = { cert: string; key: string; domain: string };

const certDir = () => path.join(app.getPath('userData'), 'mo-cert');
const findTailscale = (): string | null =>
  TAILSCALE_BINS.find((p) => fs.existsSync(p)) ?? null;

const run = (bin: string, args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: 60_000 }, (err, stdout, stderr) =>
      err ? reject(new Error(stderr || err.message)) : resolve(stdout)
    );
  });

/** Tailscale 이 인증서를 발급할 수 있는 이 기기의 도메인 (없으면 null = HTTPS 불가) */
export async function certDomain(): Promise<string | null> {
  const bin = findTailscale();
  if (!bin) return null;
  try {
    const json = JSON.parse(await run(bin, ['status', '--json'])) as {
      CertDomains?: string[];
      Self?: { DNSName?: string };
    };
    // CertDomains 는 관리 콘솔에서 HTTPS 를 켰을 때만 채워진다
    const domain = json.CertDomains?.[0] ?? null;
    if (domain) return domain;
    // 폴백: DNSName 은 항상 있지만 HTTPS 가 꺼져 있으면 발급이 실패한다
    return json.Self?.DNSName?.replace(/\.$/, '') ?? null;
  } catch {
    return null;
  }
}

/** 남은 유효기간이 충분한가 (파일이 없거나 파싱 실패면 false) */
function isFresh(certPath: string): boolean {
  try {
    const pem = fs.readFileSync(certPath, 'utf8');
    // openssl 없이 만료일을 읽는다 — 인증서의 notAfter (X.509 UTCTime/GeneralizedTime)
    const der = Buffer.from(
      pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, ''),
      'base64'
    );
    // 간단한 스캔: 2건의 시각 필드(notBefore, notAfter) 중 두 번째를 쓴다
    const times: Date[] = [];
    for (let i = 0; i < der.length - 2 && times.length < 2; i++) {
      const tag = der[i];
      if (tag !== 0x17 && tag !== 0x18) continue; // UTCTime / GeneralizedTime
      const len = der[i + 1];
      if (len !== 13 && len !== 15) continue;
      const s = der.subarray(i + 2, i + 2 + len).toString('ascii');
      const m =
        tag === 0x17
          ? s.match(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/)
          : s.match(/^\d{2}(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/);
      if (!m) continue;
      const yy = Number(m[1]);
      times.push(
        new Date(
          Date.UTC(yy < 50 ? 2000 + yy : 1900 + yy, Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]))
        )
      );
    }
    const notAfter = times[1];
    return !!notAfter && notAfter.getTime() - Date.now() > RENEW_BEFORE_MS;
  } catch {
    return false;
  }
}

/**
 * 인증서를 확보한다 — 있으면 그대로, 없거나 만료가 가까우면 `tailscale cert` 로 갱신.
 * HTTPS 가 불가능하면 null (호출부는 HTTP 로 폴백).
 * ⚠️ `tailscale cert` 는 출력 경로를 안 주면 **현재 디렉터리**에 파일을 쓴다 — 항상 명시할 것.
 */
export async function ensureTls(): Promise<TlsFiles | null> {
  const domain = await certDomain();
  const bin = findTailscale();
  if (!domain || !bin) return null;

  const dir = certDir();
  const cert = path.join(dir, `${domain}.crt`);
  const key = path.join(dir, `${domain}.key`);
  if (fs.existsSync(cert) && fs.existsSync(key) && isFresh(cert)) {
    return { cert, key, domain };
  }
  try {
    fs.mkdirSync(dir, { recursive: true });
    await run(bin, ['cert', '--cert-file', cert, '--key-file', key, domain]);
    return fs.existsSync(cert) && fs.existsSync(key) ? { cert, key, domain } : null;
  } catch {
    // 관리 콘솔에서 HTTPS 를 안 켰거나 tailscale 이 로그아웃 상태 — HTTP 로 계속한다
    return null;
  }
}
