// /test 공용 헬퍼 — 개발 인스턴스(디버깅 포트)에 붙어 화면을 조작·측정한다.
// 스크래치패드 스크립트에서 절대경로로 import 해 쓴다(스크래치패드엔 node_modules 가 없다):
//
//   import * as t from '/Users/sbjung/coding/one-app/.claude/skills/test/lib.mjs';
//   const { browser, page, log } = await t.attach();
//   const m = log.mark();
//   console.log(await t.gotoSection(page, 'Jira'));        // { via, errBox }
//   console.log(t.errors(log, m));                         // 이번 동작으로 새로 난 에러만
//   await browser.disconnect();
//
// ⚠️ 읽기와 화면 전환만 한다. 상태를 바꾸는 IPC 는 부르는 쪽이 전/후 값을 읽어 원복한다
//    (dev 는 userData 를 설치본과 공유한다).
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from '/Users/sbjung/coding/one-app/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

export const PORT = Number(process.env.TEST_PORT ?? 9333);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 본체 dev 의 Electron 메인 프로세스 — 단독판(standalone/lite)·Helper 프로세스는 이 경로에 안 걸린다
const DEV_ELECTRON = 'coding/one-app/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron';

// 정상 기동에도 찍히는 콘솔 — 이슈로 세지 않는다 (reference/noise.md 기준선)
const NOISE = [/^\[vite\] (connecting|connected)/, /Download the React DevTools/];

/** macOS 엔 `timeout` 명령이 없다 — 스크립트가 매달리지 않게 스스로 끝낸다 */
export function deadline(sec) {
  setTimeout(() => {
    console.error(`⏱ ${sec}초 초과 — 강제 종료 (창이 가려져 멈췄을 수 있다: reference/pitfalls.md)`);
    process.exit(124);
  }, sec * 1000).unref();
}

/** 붙기 — 메인 창 페이지와 콘솔 수집기를 함께 돌려준다 */
export async function attach({ port = PORT, deadlineSec = 120 } = {}) {
  if (deadlineSec) deadline(deadlineSec);
  const browser = await puppeteer.connect({
    browserURL: `http://127.0.0.1:${port}`,
    defaultViewport: null, // 안 주면 800x600 으로 덮어쓴다
  });
  const page = await mainPage(browser);
  return { browser, page, log: collect(page) };
}

/** 메인 창 — 팝아웃(?popout=)·DevTools 를 빼고, 사이드바가 있는 페이지를 고른다 */
export async function mainPage(browser) {
  const cands = (await browser.pages()).filter((p) => {
    const u = p.url();
    return u.startsWith('http://localhost:') && !u.includes('popout=');
  });
  for (const p of cands) {
    if (await p.evaluate(() => !!document.querySelector('.sidebar')).catch(() => false)) return p;
  }
  if (cands[0]) return cands[0];
  throw new Error('메인 창 페이지를 못 찾음 — dev 가 떠 있고 디버깅 포트가 맞는지 (dev.sh status)');
}

/** 콘솔·미포착 예외 수집 — 붙은 뒤의 것만 받는다(초기 로딩까지 보려면 page.reload) */
export function collect(page) {
  const all = [];
  page.on('console', (m) => all.push({ kind: m.type(), text: m.text() }));
  page.on('pageerror', (e) => all.push({ kind: 'pageerror', text: String(e?.stack ?? e) }));
  return { all, mark: () => all.length };
}

/** from(mark) 이후의 error·pageerror — 기준선 노이즈는 뺀다 */
export function errors(log, from = 0) {
  return log.all
    .slice(from)
    .filter((l) => (l.kind === 'error' || l.kind === 'pageerror') && !NOISE.some((r) => r.test(l.text)));
}

/** 조건 대기 — waitForSelector 는 창이 가려지면 RAF 스로틀로 안 풀려서 짧은 evaluate 폴링을 쓴다 */
export async function waitFor(page, fn, { arg, timeout = 20000, label = '조건', interval = 250 } = {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await page.evaluate(fn, arg).catch(() => false)) return true;
    await sleep(interval);
  }
  throw new Error(`타임아웃(${timeout}ms): ${label}`);
}

/** 앱이 그려질 때까지 — 디버깅 포트가 열린 직후엔 아직 빈 화면일 수 있다 */
export const ready = (page) =>
  waitFor(page, () => !!document.querySelector('.sidebar__nav .sidebar__item'), { label: '사이드바 렌더', timeout: 60000 });

/** 지금 사이드바에 보이는 섹션 라벨 — 접힌 사이드바에선 숨긴 메뉴가 빠진다 */
export const visibleSections = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll('.sidebar__nav .sidebar__item')].map(
      (b) => b.querySelector('.sidebar__item-label')?.textContent.trim() || b.title,
    ),
  );

/** 전체 섹션 라벨(숨긴 것 포함) — ⌘P 팔레트의 '이동' 그룹에서 읽는다 */
export async function allSections(page) {
  await openPalette(page);
  // 섹션 항목 id = palette-nav-<섹션id> (Palette.tsx optionId + CommandPalette.tsx) — 배포 명령 등은 뺀다
  const labels = await page.evaluate(() =>
    [...document.querySelectorAll('.palette__item[id^="palette-nav-"]')].map((b) =>
      b.querySelector('.palette__label')?.textContent.trim(),
    ),
  );
  await closePalette(page);
  return labels;
}

// ⌘P 는 window keydown(capture) 리스너라 합성 이벤트로도 열린다 (App.tsx)
async function openPalette(page) {
  const open = await page.evaluate(() => !!document.querySelector('.palette'));
  if (!open)
    await page.evaluate(() =>
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', key: 'p', metaKey: true, bubbles: true })),
    );
  await waitFor(page, () => !!document.querySelector('.palette__item'), { label: '명령 팔레트', timeout: 5000 });
}
async function closePalette(page) {
  await page.evaluate(() =>
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP', key: 'p', metaKey: true, bubbles: true })),
  );
  await waitFor(page, () => !document.querySelector('.palette'), { label: '팔레트 닫힘', timeout: 3000 }).catch(() => {});
}

/**
 * 섹션 이동 — 사이드바 클릭, 안 되면(접힌 사이드바의 숨긴 메뉴·⌘\ 로 숨긴 사이드바) ⌘P 팔레트로.
 * 돌려주는 errBox 는 ErrorBoundary 가 잡은 렌더 예외(.err-box) — 있으면 즉시 🔴.
 */
export async function gotoSection(page, label, { settle = 800 } = {}) {
  const isActive = () =>
    page.evaluate(
      (l) => document.querySelector('.sidebar__item--active .sidebar__item-label')?.textContent.trim() === l,
      label,
    );
  let via = 'sidebar';
  await page.evaluate((l) => {
    const hit = [...document.querySelectorAll('.sidebar__nav .sidebar__item')].find(
      (b) => (b.querySelector('.sidebar__item-label')?.textContent.trim() || b.title) === l,
    );
    hit?.click();
  }, label);
  await sleep(150);
  if (!(await isActive())) {
    via = 'palette';
    await openPalette(page);
    const ok = await page.evaluate((l) => {
      const it = [...document.querySelectorAll('.palette__item[id^="palette-nav-"]')].find(
        (b) => b.querySelector('.palette__label')?.textContent.trim() === l,
      );
      it?.click();
      return !!it;
    }, label);
    if (!ok) {
      await closePalette(page);
      throw new Error(`섹션 없음: ${label} — SECTIONS 의 label 과 정확히 같아야 한다`);
    }
  }
  await sleep(settle);
  const errBox = await page.evaluate(
    () => document.querySelector('.main .err-box')?.textContent.trim().slice(0, 200) ?? null,
  );
  return { via, errBox };
}

/** 사각형 측정 — { 이름: 셀렉터 } → { 이름: {x,y,w,h} | null }. 레이아웃 변경은 전/후를 이걸로 비교한다 */
export const measure = (page, sels) =>
  page.evaluate((sels) => {
    const out = {};
    for (const [k, s] of Object.entries(sels)) {
      const r = document.querySelector(s)?.getBoundingClientRect();
      out[k] = r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null;
    }
    return out;
  }, sels);

/** measure 결과 두 개를 비교해 달라진 것만 줄로 — "작업 대상 말고 이웃 영역이 줄었나"를 보는 용도 */
export function diff(before, after) {
  const lines = [];
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = before[k], b = after[k];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    const f = (r) => (r ? `${r.w}×${r.h} @${r.x},${r.y}` : '없음');
    lines.push(`${k}: ${f(a)} → ${f(b)}`);
  }
  return lines.length ? lines.join('\n') : '변화 없음';
}

/** 좌표 클릭 — onMouseDown/pointerdown 으로 동작하는 것(Select 옵션·외부클릭 닫힘)은 el.click() 이 안 먹는다 */
export async function realClick(page, selector) {
  const c = await page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, selector);
  if (!c) throw new Error(`요소 없음: ${selector}`);
  await page.mouse.click(c.x, c.y);
}

/** transition·animation 끄기 — 측정값이 애니메이션 중간값으로 잡히지 않게. 돌려준 함수로 되돌린다 */
export async function noMotion(page) {
  await page.evaluate(() => {
    const s = document.createElement('style');
    s.id = '__test-no-motion';
    s.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}';
    document.head.appendChild(s);
  });
  return () => page.evaluate(() => document.getElementById('__test-no-motion')?.remove());
}

/** dev Electron 메인 프로세스 pid (없으면 null) */
export function devPid() {
  try {
    return Number(execFileSync('pgrep', ['-f', DEV_ELECTRON], { encoding: 'utf8' }).trim().split('\n')[0]) || null;
  } catch {
    return null;
  }
}

/**
 * dev 창을 앞으로 — 시도만 한다(성공 여부를 돌려준다). 믿지 말 것:
 * 이 셸이 launchd Background 세션이면 여기서 띄운 dev 는 System Events 에 안 보이고,
 * main 에서 app.focus({ steal: true }) 를 불러도 macOS 가 포커스 뺏기를 막는다(2026-10-21 실측 둘 다 실패).
 * page.bringToFront() 는 OS 가려짐을 못 푼다. → 판정은 visibility() 로 하고, 가려졌으면 사용자에게 창을 앞으로 부탁한다.
 */
export function activate(pid = devPid()) {
  if (!pid) return false;
  try {
    execFileSync(
      'osascript',
      ['-e', `tell application "System Events" to set frontmost of (first process whose unix id is ${pid}) to true`],
      { stdio: 'ignore' },
    );
    return true;
  } catch {
    return false;
  }
}

/** 창 상태 — state 'hidden' 이면 완전히 가려져 RAF·ResizeObserver·xterm 갱신이 멈춘 상태다 */
export const visibility = (page) =>
  page.evaluate(() => ({ state: document.visibilityState, focus: document.hasFocus() }));

/** CDP 스크린샷 — 완전히 가려진 창은 프레임이 안 나와 60초 매달리므로 먼저 판정하고, 그래도 멈추면 15초에 포기한다 */
export async function shot(page, path, { timeout = 15000 } = {}) {
  if ((await visibility(page)).state === 'hidden' && !(activate() && (await sleep(400), (await visibility(page)).state !== 'hidden')))
    throw new Error('창이 완전히 가려졌다 — 사용자에게 dev 창을 앞으로 부탁하거나 realShot·수치 판정으로');
  await Promise.race([
    page.screenshot({ path }),
    sleep(timeout).then(() => { throw new Error('스크린샷 타임아웃 — 창이 가려졌을 수 있다 (realShot 또는 수치 판정으로)'); }),
  ]);
  return path;
}

/**
 * 실제 창 캡처 — CDP 스크린샷은 비브런시(반투명 배경)를 흰색으로 찍는다. 색·질감 확인은 이걸로.
 * CGWindowList 로 dev pid 의 창 번호를 찾아 `screencapture -l` 로 찍는다(화면 기록 권한 필요).
 */
export function realShot(path, pid = devPid()) {
  if (!pid) throw new Error('dev Electron 이 없다');
  const swift = join(tmpdir(), `oneapp-test-wid-${process.pid}.swift`);
  writeFileSync(
    swift,
    `import CoreGraphics
let l = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as! [[String: Any]]
for w in l where (w[kCGWindowOwnerPID as String] as? Int) == ${pid} && (w[kCGWindowLayer as String] as? Int) == 0 {
  print(w[kCGWindowNumber as String]!); break
}`,
  );
  const wid = execFileSync('swift', [swift], { encoding: 'utf8' }).trim();
  if (!wid) throw new Error('dev 창을 화면에서 못 찾음 — 최소화됐거나 다른 Space 에 있다');
  // 다른 창에 덮여 있어도 -l 은 그 창만 찍는다(완전히 가려져 페인트가 멈췄으면 마지막 프레임)
  execFileSync('screencapture', ['-x', '-o', `-l${wid}`, path]);
  return path;
}
