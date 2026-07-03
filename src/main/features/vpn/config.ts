// VPN(OpenVPN) 실행 관련 경로·상수
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

/** openvpn CLI 설치 후보 경로 (Homebrew — Apple Silicon / Intel) */
const OPENVPN_CANDIDATES = [
  '/opt/homebrew/sbin/openvpn',
  '/opt/homebrew/bin/openvpn',
  '/usr/local/sbin/openvpn',
  '/usr/local/bin/openvpn',
];

/** 설치된 openvpn 바이너리 경로. 없으면 null */
export function findOpenvpnBinary(): string | null {
  return OPENVPN_CANDIDATES.find((p) => fs.existsSync(p)) ?? null;
}

/** 관리 소켓 비밀번호·로그 등 런타임 파일 폴더 (userData/vpn) */
export function vpnRuntimeDir(): string {
  const dir = path.join(app.getPath('userData'), 'vpn');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** management 인터페이스 접속 비밀번호 파일 (0600) */
export const mgmtPwPath = () => path.join(vpnRuntimeDir(), 'mgmt.pw');

/** openvpn 로그 파일 (root 소유) */
export const logPath = () => path.join(vpnRuntimeDir(), 'openvpn.log');

/** openvpn PID 파일 */
export const pidPath = () => path.join(vpnRuntimeDir(), 'openvpn.pid');

/** 마지막 실행 정보(management 포트) — 앱 재시작 후 재접속용 */
export const sessionPath = () => path.join(vpnRuntimeDir(), 'session.json');
