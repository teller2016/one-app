// 터미널 입력대기 알림 진단 로그.
//
// 알림 오탐("끝난 세션에서 자꾸 토스트")은 **재현 시점을 잡기 어렵다** — 며칠에 몇 번,
// 조작 맥락도 남지 않는다. 그래서 콘솔이 아니라 userData 의 파일에 적어 나중에 읽는다.
// (개발 인스턴스는 npm start 콘솔이 있지만, 실제 사용은 빌드 앱 쪽에서 일어난다)
//
// 켜는 법: userData 에 스위치 파일을 만들면 끝 — 앱 재시작도 필요 없다.
//   touch ~/Library/Application\ Support/one-app/term-debug.on
// 끄는 법: 그 파일을 지운다. 로그는 term-debug.log(개발 인스턴스는 -dev)에 쌓인다.
// 환경변수 ONEAPP_TERM_DEBUG=1 로도 켜진다(개발 중 상수 보정용 — 파일 없이 콘솔만 볼 때).
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { IS_DEV_INSTANCE } from '../../lib/devInstance';

const ENV_DEBUG = process.env.ONEAPP_TERM_DEBUG === '1';
const SWITCH_FILE = 'term-debug.on';
const LOG_FILE = IS_DEV_INSTANCE ? 'term-debug-dev.log' : 'term-debug.log';
const LOG_MAX_BYTES = 2 * 1024 * 1024; // 넘으면 앞쪽 절반을 버린다 — 최근 기록이 중요하다
const SWITCH_TTL_MS = 10_000; // 스위치 파일 stat 캐시 — 키 입력마다 stat 하지 않게

let switchCachedAt = 0;
let switchOn = false;

const userPath = (filename: string) => path.join(app.getPath('userData'), filename);

/** 진단 로그가 켜져 있는가 (환경변수 또는 userData 의 스위치 파일) */
export function termDebugOn(): boolean {
  if (ENV_DEBUG) return true;
  const now = Date.now();
  if (now - switchCachedAt < SWITCH_TTL_MS) return switchOn;
  switchCachedAt = now;
  try {
    switchOn = fs.existsSync(userPath(SWITCH_FILE));
  } catch {
    switchOn = false; // 경로 접근 실패는 '꺼짐' 으로 — 진단 때문에 앱이 흔들리면 안 된다
  }
  return switchOn;
}

/** 파일 크기 상한 유지 — 뒤쪽 절반만 남긴다 */
function truncateIfBig(file: string) {
  try {
    const { size } = fs.statSync(file);
    if (size <= LOG_MAX_BYTES) return;
    const buf = fs.readFileSync(file);
    fs.writeFileSync(file, buf.subarray(buf.length - LOG_MAX_BYTES / 2));
  } catch {
    // 회전 실패는 무시 — 로그는 부가 기능이다
  }
}

/** 진단 한 줄 기록 (꺼져 있으면 no-op). tag 는 `[term:<tag>]` 로 찍힌다 */
export function termLog(tag: string, fields: Record<string, unknown>): void {
  if (!termDebugOn()) return;
  const stamp = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm — 간격 판독이 목적
  const body = Object.entries(fields)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ');
  const line = `${stamp} [${tag}] ${body}`;
  if (ENV_DEBUG) console.log(line);
  try {
    const file = userPath(LOG_FILE);
    truncateIfBig(file);
    fs.appendFileSync(file, line + '\n');
  } catch {
    // 쓰기 실패는 무시
  }
}

// PTY 로 흘러가는 입력을 **종류만** 남기기 위한 토큰 분해.
// ESC 시퀀스(마우스 리포트·포커스 이벤트·CPR 등)는 그것이 무엇인지가 진단 대상이라
// 원문을 보존하고, 일반 인쇄 문자는 «개수» 로만 적는다 — 프롬프트 본문이 로그에 남지 않는다.
// eslint-disable-next-line no-control-regex -- 터미널 이스케이프 시퀀스 매칭이 목적
const TOKEN_RE = /\x1b(?:\][^\x07\x1b]*(?:\x07|\x1b\\)|\[[0-?]*[ -/]*[@-~]|[@-Z\\-_]|.)|[\x00-\x1f\x7f]/g;

const escapeToken = (tok: string) =>
  // eslint-disable-next-line no-control-regex -- 제어문자 치환이 목적
  tok.replace(/[\x00-\x1f\x7f]/g, (c) => {
    const code = c.charCodeAt(0);
    if (code === 0x1b) return '\\e';
    if (code === 0x0d) return '\\r';
    if (code === 0x0a) return '\\n';
    if (code === 0x07) return '\\a';
    return `\\x${code.toString(16).padStart(2, '0')}`;
  });

/** 입력 데이터를 로그용 요약으로 — 시퀀스는 원문, 일반 문자는 «개수» */
export function describeInput(data: string): string {
  const out: string[] = [];
  let plain = 0;
  const flushPlain = () => {
    if (plain) out.push(`«${plain}»`);
    plain = 0;
  };
  TOKEN_RE.lastIndex = 0;
  let last = 0;
  for (let m = TOKEN_RE.exec(data); m; m = TOKEN_RE.exec(data)) {
    plain += m.index - last;
    flushPlain();
    out.push(escapeToken(m[0]));
    last = m.index + m[0].length;
  }
  plain += data.length - last;
  flushPlain();
  const s = out.join('');
  return s.length > 160 ? `${s.slice(0, 160)}…` : s;
}
