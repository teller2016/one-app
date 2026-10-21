// 폰 제어 창(scrcpy) 아이콘 — 독 왼쪽에 붙는 제어 창 한가운데와 Dock 타일에 뜨는 폰 모양 그림.
// scrcpy 는 SCRCPY_ICON_DIR 의 그림을 화면 없는 제어 창 가운데에 창 크기에 맞춰 그리고 Dock 아이콘으로도 쓴다
// (main features/mirror/scrcpy.ts 주석). 결과는 PNG 파일이 아니라 base64 TS 모듈로 쓴다 — main 번들에 그대로 실린다.
//
//   npm run icon:mirror   → src/main/features/mirror/controlIcon.ts
//
// ⚠️ 256x256 을 지킬 것 — 1x1 처럼 작으면 Dock 이 확대하며 파란 사각형을 그렸다(2026-09-01 실측).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from './lib/png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'src', 'main', 'features', 'mirror', 'controlIcon.ts');
const N = 256;

// 색 — 제어 창 바탕(검정) 위의 다크 패널 보조 글자색(_base.scss --on-dark-2)
const INK = [0xae, 0xb4, 0xbc];

/** 둥근 사각형(x,y,w,h,r) 의 부호 거리 — 안쪽 음수 (make-icon.mjs 와 같은 식) */
function sdRoundRect(px, py, x, y, w, h, r) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const qx = Math.abs(px - cx) - (w / 2 - r);
  const qy = Math.abs(py - cy) - (h / 2 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

const cover = (d) => Math.min(Math.max(0.5 - d, 0), 1);

// 폰 — 세로 66% · 9:16 근사, 테두리 선 + 아래 홈 막대 (Lucide smartphone 의 비례)
const PHONE = { x: 80, y: 44, w: 96, h: 168, r: 22 };
const STROKE = 12;
const BAR = { x: 112, y: 182, w: 32, h: 8, r: 4 };

const px = Buffer.alloc(N * N * 4);
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    const sx = x + 0.5;
    const sy = y + 0.5;
    // 테두리 = 둥근 사각형 경계에서 안쪽으로 STROKE 두께
    const d = sdRoundRect(sx, sy, PHONE.x, PHONE.y, PHONE.w, PHONE.h, PHONE.r);
    const ring = cover(Math.abs(d + STROKE / 2) - STROKE / 2);
    const bar = cover(sdRoundRect(sx, sy, BAR.x, BAR.y, BAR.w, BAR.h, BAR.r));
    const a = Math.max(ring, bar);
    const i = (y * N + x) * 4;
    px[i] = INK[0];
    px[i + 1] = INK[1];
    px[i + 2] = INK[2];
    px[i + 3] = Math.round(a * 255);
  }
}

const png = encodePng({ width: N, height: N, px });
const ts = `// ⚠️ 생성 파일 — 손으로 고치지 말 것. \`npm run icon:mirror\`(scripts/make-mirror-icon.mjs)로 다시 만든다.
// 폰 제어 창(scrcpy) 가운데·Dock 타일에 뜨는 폰 모양 그림 — 256x256 RGBA PNG (${png.length} 바이트)
export const CONTROL_ICON_PNG = Buffer.from(
  '${png.toString('base64')}',
  'base64',
);
`;
fs.writeFileSync(OUT, ts);
console.log(`✅ ${path.relative(ROOT, OUT)} — ${png.length} 바이트`);
