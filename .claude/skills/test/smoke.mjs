// /test 스모크 — 개발 인스턴스에 붙어 콘솔 에러를 수집하고 전 섹션을 순회한다.
// 사용법: node .claude/skills/test/smoke.mjs [스크린샷경로]
// ⚠️ 읽기와 화면 전환만 한다. 상태를 바꾸는 IPC 는 부르지 않는다(userData 를 빌드 앱과 공유하므로).
import puppeteer from '/Users/sbjung/coding/one-app/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const PORT = 9333;
const shotPath = process.argv[2] ?? null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.connect({
  browserURL: `http://127.0.0.1:${PORT}`,
  defaultViewport: null,
});

const pages = await browser.pages();
const page =
  pages.find((p) => p.url().startsWith('http://localhost')) ?? pages[0];
console.log('대상 페이지:', page.url());

const logs = [];
page.on('console', (m) => logs.push({ kind: m.type(), text: m.text() }));
page.on('pageerror', (e) => logs.push({ kind: 'pageerror', text: String(e) }));

// 리스너는 등록 이후 것만 받는다 — 초기 로딩 콘솔까지 보려면 리로드가 필요하다.
await page.reload({ waitUntil: 'domcontentloaded' });

// ⚠️ waitForSelector 는 창이 가려지면 RAF 스로틀로 안 풀린다 → 짧은 evaluate 폴링
const waitFor = async (fn, label, ms = 20000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await page.evaluate(fn).catch(() => false)) return true;
    await sleep(250);
  }
  throw new Error(`타임아웃: ${label}`);
};

await waitFor(() => !!document.querySelector('.sidebar__nav .sidebar__item'), '사이드바 렌더');
await sleep(2500); // 초기 조회가 한 바퀴 돌 시간

const items = await page.evaluate(() =>
  [...document.querySelectorAll('.sidebar__nav .sidebar__item')].map(
    (b) => b.title || b.textContent.trim(),
  ),
);
console.log(`사이드바 ${items.length}개: ${items.join(' / ')}`);

let bad = 0;
for (let i = 0; i < items.length; i++) {
  const before = logs.length;
  await page.evaluate((idx) => {
    document.querySelectorAll('.sidebar__nav .sidebar__item')[idx].click();
  }, i);
  await sleep(1200);
  // .err-box = ErrorBoundary 가 잡은 렌더 예외 → 즉시 이슈
  const errBox = await page.evaluate(() => {
    const el = document.querySelector('.main .err-box');
    return el ? el.textContent.trim().slice(0, 200) : null;
  });
  const errs = logs.slice(before).filter((l) => l.kind === 'error' || l.kind === 'pageerror');
  if (errBox || errs.length) bad++;
  console.log(
    `  [${i + 1}/${items.length}] ${items[i]} — errBox:${errBox ?? '없음'} 콘솔에러:${errs.length}`,
  );
  for (const e of errs) console.log(`      ${e.kind}: ${e.text.slice(0, 300)}`);
}

// 레이아웃은 눈이 아니라 수치로 — left + width === innerWidth 면 정상
const layout = await page.evaluate(() => {
  const r = document.querySelector('.main')?.getBoundingClientRect();
  return r ? { left: Math.round(r.left), width: Math.round(r.width), inner: innerWidth } : null;
});
console.log('레이아웃:', JSON.stringify(layout), layout && layout.left + layout.width === layout.inner ? '✅' : '⚠️ 확인 필요');

console.log('\n=== 콘솔 종류별 (중복 합침) ===');
const byKind = {};
for (const l of logs) (byKind[l.kind] ??= []).push(l.text.slice(0, 220));
for (const [k, v] of Object.entries(byKind)) {
  const seen = new Map();
  for (const t of v) seen.set(t, (seen.get(t) ?? 0) + 1);
  console.log(`--- ${k} (${v.length}) ---`);
  for (const [t, n] of seen) console.log(`  (${n}회) ${t}`);
}

if (shotPath) {
  await page.screenshot({ path: shotPath });
  console.log('스크린샷:', shotPath);
}

console.log(bad === 0 ? '\n✅ 전 섹션 이상 없음' : `\n⚠️ 문제 있는 섹션 ${bad}개`);
await browser.disconnect();
