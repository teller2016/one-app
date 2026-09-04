// 개발 모드 Dock 아이콘 생성 — assets/icon.png 에 "DEV" 오렌지 밴드를 합성해
// assets/icon-dev.png 를 만든다. 개발 앱과 빌드 앱을 Dock 에서 한눈에 구분하기 위한 것.
//
// 외부 이미지 라이브러리(sharp·jimp 등)를 쓰지 않는다 — 이 한 장을 위해 네이티브
// 의존성을 늘릴 이유가 없고, macOS 기본 도구(sips)는 이미지 합성을 못 한다.
// PNG 디코드·인코드는 `scripts/lib/png.mjs`(단독판 아이콘 생성과 공용)가 맡는다.
//
// 실행: npm run icon:dev  (아이콘 원본을 바꿨을 때만 다시 돌리면 된다)
//
// 단독 배포판(standalone/lite)도 **이 스크립트를 그대로 쓴다** — 색만 다른 같은 아이콘이라
// 밴드 합성 로직을 복제할 이유가 없다. 경로는 인자로 받는다:
//   node ../../scripts/make-dev-icon.mjs --src assets/icon.png --out assets/icon-dev.png
// (인자를 주지 않으면 본체 assets 를 쓴다 — 기존 `npm run icon:dev` 그대로)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from './lib/png.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** `--src`/`--out` 인자 (없으면 본체 assets). 상대경로는 **부른 곳** 기준으로 푼다 */
function argPath(flag, fallback) {
  const i = process.argv.indexOf(flag);
  const v = i >= 0 ? process.argv[i + 1] : undefined;
  return v ? path.resolve(process.cwd(), v) : fallback;
}

const SRC = argPath('--src', path.join(ROOT, 'assets', 'icon.png'));
const OUT = argPath('--out', path.join(ROOT, 'assets', 'icon-dev.png'));

// ── 글자 그리기 ───────────────────────────────────────────────────────────
// 비트맵 폰트 대신 선분·타원호까지의 거리로 그린다 — 정수배 확대에서 생기는
// 계단을 피하고 안티앨리어싱된 획을 얻기 위한 것.

/** 점(px,py)에서 선분(ax,ay)-(bx,by) 까지의 거리 */
function distSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2));
  const dx = wx - t * vx;
  const dy = wy - t * vy;
  return Math.hypot(dx, dy);
}

/**
 * 점에서 타원 호(중심 cx·cy, 반지름 rx·ry)까지의 근사 거리.
 * 타원은 정확한 거리 해가 없어 f/|∇f| (일차 근사)를 쓴다 — 획 두께 수준에서는 충분하다.
 * half='right' 면 오른쪽 절반만 (D 의 곡선부).
 */
function distEllipse(px, py, cx, cy, rx, ry, half) {
  if (half === 'right' && px < cx) {
    // 반원 구간 밖 — 위/아래 끝점에서의 거리로 이어붙인다
    return Math.min(Math.hypot(px - cx, py - (cy - ry)), Math.hypot(px - cx, py - (cy + ry)));
  }
  const nx = (px - cx) / rx;
  const ny = (py - cy) / ry;
  const f = nx * nx + ny * ny - 1;
  const gx = (2 * (px - cx)) / (rx * rx);
  const gy = (2 * (py - cy)) / (ry * ry);
  const g = Math.hypot(gx, gy);
  return g === 0 ? Infinity : Math.abs(f) / g;
}

/**
 * 글자 하나의 커버리지 함수를 만든다 — (x,y) → 0..1.
 * 좌표는 글자 박스 기준(x: 0..w, y: 0..h).
 */
function glyph(ch, w, h, stroke) {
  const s = stroke / 2;
  const aa = 1.0; // 안티앨리어싱 폭(px)
  const cover = (d) => Math.max(0, Math.min(1, (s - d) / aa + 0.5));

  if (ch === 'D') {
    // 왼쪽 세로획 + 오른쪽 반타원. 위·아래 가로획은 반타원이 이어받는다.
    const stemX = s;
    const rx = w - stemX - s;
    const ry = h / 2 - s;
    return (x, y) => {
      const dStem = distSegment(x, y, stemX, s, stemX, h - s);
      const dArc = distEllipse(x, y, stemX, h / 2, rx, ry, 'right');
      return Math.max(cover(dStem), cover(dArc));
    };
  }
  if (ch === 'E') {
    return (x, y) => {
      const d = Math.min(
        distSegment(x, y, s, s, s, h - s), // 세로
        distSegment(x, y, s, s, w - s, s), // 위
        distSegment(x, y, s, h / 2, w - s * 1.6, h / 2), // 가운데(살짝 짧게)
        distSegment(x, y, s, h - s, w - s, h - s) // 아래
      );
      return cover(d);
    };
  }
  if (ch === 'V') {
    return (x, y) => {
      const d = Math.min(
        distSegment(x, y, s, s, w / 2, h - s),
        distSegment(x, y, w - s, s, w / 2, h - s)
      );
      return cover(d);
    };
  }
  throw new Error(`정의되지 않은 글자: ${ch}`);
}

// ── 합성 ──────────────────────────────────────────────────────────────────

/** src 위에 색(r,g,b)을 alpha 로 올린다 (일반 source-over) */
function blend(px, i, r, g, b, a) {
  if (a <= 0) return;
  const inv = 1 - a;
  px[i] = Math.round(r * a + px[i] * inv);
  px[i + 1] = Math.round(g * a + px[i + 1] * inv);
  px[i + 2] = Math.round(b * a + px[i + 2] * inv);
  px[i + 3] = Math.max(px[i + 3], Math.round(a * 255));
}

function main() {
  const { width, height, px } = decodePng(fs.readFileSync(SRC));

  // 아이콘 본체(스퀘어클)의 실제 경계를 알파에서 찾는다 — 바깥 그림자는 알파가 낮다.
  // 밴드를 이 경계 안쪽에만 그려야 둥근 모서리를 벗어나지 않는다.
  const SOLID = 230; // 본체로 볼 알파 하한 (그림자 제외)
  let top = height;
  let bottom = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (px[(y * width + x) * 4 + 3] >= SOLID) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        break;
      }
    }
  }
  const bodyH = bottom - top;

  // 밴드: 본체 하단 안쪽 17% — 아이콘의 타일 격자를 가리지 않고 그 아래 여백에 딱 들어간다
  // (더 키우면 아래쪽 타일이 잘려 보인다 — 2026-08-11 실측)
  const bandTop = Math.round(bottom - bodyH * 0.17);
  const bandBottom = bottom;
  const BAND = { r: 0xff, g: 0x95, b: 0x00 }; // 애플 시스템 오렌지 — "개발 중" 신호

  for (let y = bandTop; y <= bandBottom; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      // 원본 알파를 마스크로 쓴다 — 스퀘어클의 둥근 모서리를 그대로 따라간다
      const mask = px[i + 3] / 255;
      if (mask < 0.5) continue;
      blend(px, i, BAND.r, BAND.g, BAND.b, mask);
    }
  }

  // "DEV" — 밴드 세로 중앙에 흰색으로
  const text = 'DEV';
  const bandH = bandBottom - bandTop;
  const chH = Math.round(bandH * 0.5);
  const chW = Math.round(chH * 0.72);
  const gap = Math.round(chW * 0.34);
  const stroke = Math.max(2, Math.round(chH * 0.19));
  const totalW = text.length * chW + (text.length - 1) * gap;
  const startX = Math.round((width - totalW) / 2);
  const startY = Math.round(bandTop + (bandH - chH) / 2);

  text.split('').forEach((ch, idx) => {
    const fn = glyph(ch, chW, chH, stroke);
    const ox = startX + idx * (chW + gap);
    for (let y = 0; y < chH; y++) {
      for (let x = 0; x < chW; x++) {
        const a = fn(x + 0.5, y + 0.5);
        if (a <= 0) continue;
        const i = ((startY + y) * width + (ox + x)) * 4;
        blend(px, i, 255, 255, 255, a);
      }
    }
  });

  fs.writeFileSync(OUT, encodePng({ width, height, px }));
   
  console.log(
    `[icon] ${path.relative(process.cwd(), OUT)} 생성 — 본체 y=${top}..${bottom}, 밴드 y=${bandTop}..${bandBottom}`
  );
}

main();
