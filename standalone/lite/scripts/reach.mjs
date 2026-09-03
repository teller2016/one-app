#!/usr/bin/env node
// lite 에 실리는 파일 보기 — 그래프는 lib/reach.mjs.
//
//   npm run reach                 요약: 도달 파일 수 · 값으로 import 하는 외부 패키지
//   npm run reach -- --files      도달 파일 전체 목록 (리포 기준 경로)
//   npm run reach -- --hits <경로>...   준 경로 중 lite 에 실리는 것만 출력 — /commit 이 쓴다
//                                 예) git diff --name-only HEAD | xargs node standalone/lite/scripts/reach.mjs --hits
import { collectReach, hits } from './lib/reach.mjs';

const args = process.argv.slice(2);
const reach = collectReach();

if (args[0] === '--hits') {
  const found = hits(args.slice(1), reach);
  if (found.length === 0) console.log('lite 에 실리는 변경 파일 없음');
  else {
    console.log(`lite 에 실리는 변경 파일 ${found.length}개:`);
    for (const f of found) console.log(`  ${f}`);
  }
} else if (args[0] === '--files') {
  for (const f of reach.files) console.log(f);
} else {
  const lite = reach.files.length - reach.bodyFiles.length;
  console.log(`도달 파일 ${reach.files.length}개 — 본체 ${reach.bodyFiles.length} · lite ${lite}`);
  console.log('\n값으로 import 하는 외부 패키지:');
  for (const [pkg, files] of Object.entries(reach.bare)) console.log(`  ${pkg.padEnd(12)} ${files.length}개 파일`);
  const typeOnly = Object.keys(reach.typeOnlyBare).filter((p) => !(p in reach.bare));
  if (typeOnly.length) console.log(`타입만: ${typeOnly.join(', ')}`);
  console.log('\n본체 기능별:');
  const byKey = {};
  for (const f of reach.bodyFiles) {
    const seg = f.split('/');
    const key = seg[2] === 'features' ? seg.slice(1, 4).join('/') : seg.slice(1, 3).join('/');
    byKey[key] = (byKey[key] ?? 0) + 1;
  }
  for (const [k, n] of Object.entries(byKey).sort()) console.log(`  ${k.padEnd(36)} ${n}`);
}
if (reach.unresolved.length) {
  console.error('\n⚠️ 해석 못 한 import:');
  for (const u of reach.unresolved) console.error(`  ${u.spec}  ← ${u.from}`);
  process.exitCode = 1;
}
