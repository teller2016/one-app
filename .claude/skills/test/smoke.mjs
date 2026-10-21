// /test 스모크 — 섹션을 열어 렌더 예외(.err-box)·콘솔 에러를 센다.
// 사용법: node .claude/skills/test/smoke.mjs --only 포트,Jira [--reload] [--shot <경로>]
//         node .claude/skills/test/smoke.mjs --all          ← "전체 스모크" 지시가 있을 때만
// ⚠️ 읽기와 화면 전환만 한다. 끝나면 원래 보던 섹션으로 돌려놓는다(사용자가 그 dev 를 쓰고 있을 수 있다).
import * as t from './lib.mjs';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i < 0 ? null : (args[i + 1] ?? '');
};
const only = opt('--only');
const shotPath = opt('--shot');
if (!only && !args.includes('--all')) {
  console.error('대상을 정할 것: --only 섹션1,섹션2 (기본) 또는 --all (전체 스모크 지시가 있을 때만)');
  process.exit(1);
}

const { browser, page, log } = await t.attach({ deadlineSec: 180 });
console.log('대상 페이지:', page.url());

// 리스너는 붙은 뒤 것만 받는다 — 초기 로딩 콘솔까지 보려면 --reload (보던 화면 상태가 날아간다)
if (args.includes('--reload')) await page.reload({ waitUntil: 'domcontentloaded' });
await t.ready(page);
if (args.includes('--reload')) await t.sleep(2500); // 초기 조회가 한 바퀴 돌 시간

const startSection = await page.evaluate(
  () => document.querySelector('.sidebar__item--active .sidebar__item-label')?.textContent.trim() ?? null,
);
const all = await t.allSections(page);
const visible = await t.visibleSections(page);
const hidden = all.filter((l) => !visible.includes(l));
console.log(`섹션 ${all.length}개${hidden.length ? ` (사이드바에서 숨김: ${hidden.join(', ')} → 팔레트로 연다)` : ''}`);

const targets = only ? only.split(',').map((s) => s.trim()).filter(Boolean) : all;
const unknown = targets.filter((l) => !all.includes(l));
if (unknown.length) {
  console.error(`없는 섹션: ${unknown.join(', ')} — 있는 것: ${all.join(' / ')}`);
  await browser.disconnect();
  process.exit(1);
}

let bad = 0;
for (const [i, label] of targets.entries()) {
  const m = log.mark();
  const { via, errBox } = await t.gotoSection(page, label, { settle: 1200 });
  const errs = t.errors(log, m);
  if (errBox || errs.length) bad++;
  console.log(`  [${i + 1}/${targets.length}] ${label}${via === 'palette' ? ' (팔레트)' : ''} — errBox:${errBox ?? '없음'} 콘솔에러:${errs.length}`);
  for (const e of errs) console.log(`      ${e.kind}: ${e.text.slice(0, 300)}`);
}

// 레이아웃은 눈이 아니라 수치로 — left + width === innerWidth 면 정상
const layout = await page.evaluate(() => {
  const r = document.querySelector('.main')?.getBoundingClientRect();
  return r ? { left: Math.round(r.left), width: Math.round(r.width), inner: innerWidth } : null;
});
console.log('레이아웃:', JSON.stringify(layout), layout && layout.left + layout.width === layout.inner ? '✅' : '⚠️ 확인 필요');

const warns = log.all.filter((l) => l.kind === 'warn' || l.kind === 'warning');
if (warns.length) {
  console.log(`\n--- warning ${warns.length}건 (중복 합침) ---`);
  const seen = new Map();
  for (const w of warns) seen.set(w.text.slice(0, 220), (seen.get(w.text.slice(0, 220)) ?? 0) + 1);
  for (const [txt, n] of seen) console.log(`  (${n}회) ${txt}`);
}

if (shotPath) console.log('스크린샷:', await t.shot(page, shotPath).catch((e) => `실패 — ${e.message}`));

if (startSection && startSection !== targets.at(-1)) await t.gotoSection(page, startSection, { settle: 200 });
console.log(bad === 0 ? `\n✅ ${targets.length}개 섹션 이상 없음` : `\n⚠️ 문제 있는 섹션 ${bad}개`);
await browser.disconnect();
