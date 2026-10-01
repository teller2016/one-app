// 앱 아이콘 원본 생성 — assets/icon.png(1024) 를 도형으로 직접 그린다.
// 폰(MO) 홈 화면 아이콘(src/mobile-app/public/icon-192·512.png)도 같은 도형으로 함께 만든다(가장자리까지 채운 정사각).
// Signal 무드(2026-09-30): 흑연 스퀘클 + 2×2 타일, 왼쪽 위 타일만 액센트(인디고)로 켜진다.
// 시안은 리디자인 목업 캔버스의 '앱 아이콘' 보드와 같다.
//
// 외부 이미지 라이브러리 없이 둥근 사각형의 거리(SDF)로 안티앨리어싱해 그린다.
// (qlmanage 로 SVG 를 렌더하면 투명 배경이 흰색으로 채워져 쓸 수 없었다 — 실측)
//
// 실행: node scripts/make-icon.mjs && npm run icon:dev
//   → 이어서 icon.icns 는 iconutil 로 만든다(아래 README 절차 — 이 스크립트 끝에서 안내 출력)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from './lib/png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'assets', 'icon.png');
const MO_PUBLIC = path.join(ROOT, 'src', 'mobile-app', 'public');
const N = 1024;

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// 색 — _base.scss 다크 토큰과 같은 계열
const BG_TOP = hex('#23272d');
const BG_BOT = hex('#0e1013');
const ON_TOP = hex('#a9b4ff');
const ON_BOT = hex('#7183ff');
const OFF = hex('#2c3239');

/** 둥근 사각형(x,y,w,h,r) 의 부호 거리 — 안쪽 음수 */
function sdRoundRect(px, py, x, y, w, h, r) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const qx = Math.abs(px - cx) - (w / 2 - r);
  const qy = Math.abs(py - cy) - (h / 2 - r);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

const cover = (d) => Math.min(Math.max(0.5 - d, 0), 1);

/** 가우시안 블러된 가장자리 근사 (erf) — 그림자용 */
function erf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return x >= 0 ? y : -y;
}

const SQ = { x: 100, y: 100, w: 824, h: 824, r: 190 };
const TILE = 240;
const TILE_R = 64;
const tiles = [
  { x: 248, y: 248, on: true },
  { x: 536, y: 248 },
  { x: 248, y: 536 },
  { x: 536, y: 536 },
];

/**
 * 아이콘 한 장을 그린다 — 도형 좌표는 1024 설계 공간 그대로, 출력 크기·보이는 영역만 바꾼다.
 * @param size 출력 픽셀 크기
 * @param bleed false = 맥 아이콘(투명 여백 + 그림자 + 스퀘클) · true = 폰 홈 화면용 —
 *   스퀘클 안쪽(바탕)을 정사각 끝까지 채운다. 폰(iOS·안드로이드 런처)은 자기 둥근 테두리를 씌우고 투명 여백을 검게
 *   채워서, 맥 아이콘을 그대로 줄이면 작은 아이콘이 테두리 안에 떠 보인다
 */
function render(size, bleed) {
  const px = Buffer.alloc(size * size * 4);
  // 보이는 영역(설계 좌표) — 폰용은 스퀘클 상자만큼
  const x0 = bleed ? SQ.x : 0;
  const span = bleed ? SQ.w : N;
  const unit = size / span; // 출력 픽셀 / 설계 단위 — 안티앨리어싱 폭을 출력 1px 로 맞춘다
  const aa = (d) => cover(d * unit);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = x0 + (x + 0.5) / unit;
      const sy = x0 + (y + 0.5) / unit;
      // 누적 (프리멀티플라이드)
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      const over = (col, al) => {
        r = col[0] * al + r * (1 - al);
        g = col[1] * al + g * (1 - al);
        b = col[2] * al + b * (1 - al);
        a = al + a * (1 - al);
      };

      const t = Math.min(Math.max((sy - SQ.y) / SQ.h, 0), 1);
      if (bleed) {
        // 1~3) 바탕을 끝까지 — 그림자·스퀘클·하이라이트 링은 폰이 씌우는 테두리 몫이라 그리지 않는다
        over(mix(BG_TOP, BG_BOT, t), 1);
      } else {
        // 1) 그림자 — 아래로 10px, σ 14
        const ds = sdRoundRect(sx, sy - 10, SQ.x, SQ.y, SQ.w, SQ.h, SQ.r);
        const sh = 0.5 * (1 - erf(ds / (14 * Math.SQRT2)));
        if (sh > 0.001) over([0, 0, 0], sh * 0.35);

        // 2) 스퀘클 바탕 — 세로 그라데이션
        const d = sdRoundRect(sx, sy, SQ.x, SQ.y, SQ.w, SQ.h, SQ.r);
        const c = aa(d);
        if (c > 0) {
          over(mix(BG_TOP, BG_BOT, t), c);
          // 3) 안쪽 1줄 하이라이트 링 (두께 4, 흰 9%)
          const ring = aa(Math.abs(d + 4) - 2);
          if (ring > 0) over([255, 255, 255], ring * 0.09 * c);
        }
      }

      // 4) 타일
      for (const tl of tiles) {
        const dt = sdRoundRect(sx, sy, tl.x, tl.y, TILE, TILE, TILE_R);
        const ct = aa(dt);
        if (ct <= 0) continue;
        const col = tl.on ? mix(ON_TOP, ON_BOT, (sy - tl.y) / TILE) : OFF;
        over(col, ct);
      }

      const i = (y * size + x) * 4;
      // 스트레이트 알파로 되돌려 기록
      px[i] = a > 0 ? Math.round(r / a) : 0;
      px[i + 1] = a > 0 ? Math.round(g / a) : 0;
      px[i + 2] = a > 0 ? Math.round(b / a) : 0;
      px[i + 3] = Math.round(a * 255);
    }
  }
  return encodePng({ width: size, height: size, px });
}

fs.writeFileSync(OUT, render(N, false));
console.log(`생성: ${path.relative(ROOT, OUT)}`);
// 폰(MO) 홈 화면 아이콘 — manifest·apple-touch-icon 이 가리킨다. ⚠️ 맥 아이콘만 바꾸고 이걸 빼먹어
// 폰엔 옛 아이콘이 두 달 가까이 남았다(2026-10-01 사용자 신고) — 같은 스크립트에서 함께 만든다
for (const size of [192, 512]) {
  const out = path.join(MO_PUBLIC, `icon-${size}.png`);
  fs.writeFileSync(out, render(size, true));
  console.log(`생성: ${path.relative(ROOT, out)}`);
}
console.log('다음: npm run icon:dev  ·  icon.icns 는 iconutil 로 재생성  ·  폰은 홈 화면에서 지우고 다시 추가해야 바뀐다');
