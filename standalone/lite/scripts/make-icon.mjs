// 단독판(One App Lite) 아이콘 생성 — 본체 `assets/icon.png` 의 **색만 바꿔** 만든다.
// 모양이 같아야 같은 계열 앱으로 읽히고, 색이 달라야 Dock·탐색기에서 구분된다.
//
// 산출물 3개 (전부 이 폴더의 assets/ 에 커밋한다 — 빌드할 때 다시 만들 필요가 없다)
//   icon.png   Dock·미리보기용 원본 (1024)
//   icon.icns  macOS 패키징 (forge packagerConfig.icon)
//   icon.ico   Windows 패키징 (같은 설정이 확장자만 바꿔 찾는다)
//
// 실행: npm run icon   (본체 아이콘을 바꿨거나 색을 바꿀 때만)
//   색 바꾸기: npm run icon -- --hue=285   (0~359, 기본 135 = 애플 시스템 그린)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
// PNG 코덱은 본체 스크립트와 공용 — 아이콘 한 장 때문에 이미지 라이브러리를 넣지 않는다
import { decodePng, encodePng } from '../../../scripts/lib/png.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LITE = path.resolve(HERE, '..');
const REPO = path.resolve(LITE, '../..');
const SRC = path.join(REPO, 'assets', 'icon.png');
const OUT_DIR = path.join(LITE, 'assets');
const OUT_PNG = path.join(OUT_DIR, 'icon.png');

/**
 * 목표 색상(HSL 의 H, 도) — 기본 135 = 애플 시스템 그린(#34c759).
 * 본체는 액센트 블루(약 212도)라 Dock 에서 한눈에 갈린다. DEV 밴드가 쓰는 오렌지는
 * '개발 중' 신호라 피한다.
 */
const TARGET_HUE = Number(
  process.argv.find((a) => a.startsWith('--hue='))?.slice('--hue='.length) ?? 135,
);

/** 색을 돌릴 최소 채도 — 흰 본체·회색 타일(채도 0 근처)은 건드리지 않는다 */
const SAT_MIN = 0.12;
/** 원본 색상(평균 hue) 판정에 쓸 최소 채도 — 경계의 흐린 픽셀에 끌려가지 않게 높게 잡는다 */
const SAT_STRONG = 0.25;

// ── HSL 변환 (0..255 ↔ h:0..360, s·l:0..1) ──

function rgbToHsl(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  h *= 60;
  return { h: (h + 360) % 360, s, l };
}

function hslToRgb(h, s, l) {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hk = ((h % 360) + 360) % 360 / 360;
  const conv = (t) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return [
    Math.round(conv(hk + 1 / 3) * 255),
    Math.round(conv(hk) * 255),
    Math.round(conv(hk - 1 / 3) * 255),
  ];
}

// ── 색 바꾸기 ──

/** 상대 휘도 (sRGB 계수) — 사람이 느끼는 밝기의 근사 */
const luma = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/**
 * hue·s 를 고정한 채 원본과 **같은 휘도**가 되는 명도(L)를 찾는다.
 *
 * ⚠️ 이 보정을 빼면 안 된다 — HSL 의 h 만 돌리면 s·l 이 같아도 초록·노랑 계열은
 * 훨씬 밝게 보여(휘도 계수가 파랑의 10배) 아이콘이 형광색처럼 뜬다(2026-09-03 실측:
 * 블루 #1C82E5 휘도 0.45 → 같은 s·l 의 그린 휘도 0.68).
 * 고정 h·s 에서 휘도는 L 에 대해 단조증가라 이분법으로 안전하게 찾는다.
 */
function matchLuma(h, s, targetLuma) {
  let lo = 0;
  let hi = 1;
  let rgb = hslToRgb(h, s, 0.5);
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    rgb = hslToRgb(h, s, mid);
    if (luma(rgb[0], rgb[1], rgb[2]) < targetLuma) lo = mid;
    else hi = mid;
  }
  return rgb;
}

/**
 * 채도가 있는 픽셀의 hue 를 평균이 목표 색상에 오도록 **한 덩어리로 회전**하고,
 * 픽셀별 휘도는 원본 그대로 유지한다.
 *
 * 개별 픽셀을 목표 색으로 덮지 않는 이유: 원본 타일은 위→아래 그라데이션이라
 * hue·명암의 미세한 차이가 있고, 그걸 지우면 평면적으로 보인다.
 */
function recolor({ width, height, px }) {
  // 원본의 대표 색상 — 원형 평균(hue 는 각도라 산술 평균이 성립하지 않는다)
  let sx = 0;
  let sy = 0;
  let strong = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) continue;
    const { h, s } = rgbToHsl(px[i], px[i + 1], px[i + 2]);
    if (s < SAT_STRONG) continue;
    const rad = (h * Math.PI) / 180;
    sx += Math.cos(rad);
    sy += Math.sin(rad);
    strong++;
  }
  if (strong === 0) throw new Error('원본에서 채도 있는 픽셀을 찾지 못했습니다.');
  const meanHue = ((Math.atan2(sy, sx) * 180) / Math.PI + 360) % 360;
  const delta = TARGET_HUE - meanHue;

  // 같은 색이 수십만 번 나오므로(그라데이션이라도 색 수는 적다) 변환 결과를 캐시한다 —
  // 픽셀마다 이분법을 14번 돌리는 비용이 사실상 사라진다
  const cache = new Map();
  let changed = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue;
    const key = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
    let out = cache.get(key);
    if (out === undefined) {
      const { h, s } = rgbToHsl(px[i], px[i + 1], px[i + 2]);
      out =
        s < SAT_MIN // 흰 본체·회색 타일은 그대로
          ? null
          : matchLuma(h + delta, s, luma(px[i], px[i + 1], px[i + 2]));
      cache.set(key, out);
    }
    if (out === null) continue;
    px[i] = out[0];
    px[i + 1] = out[1];
    px[i + 2] = out[2];
    changed++;
  }
  return { width, height, px, meanHue, delta, changed, colors: cache.size };
}

// ── macOS/Windows 아이콘 컨테이너 ──

const has = (bin) => {
  try {
    execFileSync('which', [bin], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

/** sips 로 크기별 PNG 를 뽑아 파일 경로를 돌려준다 */
function resize(srcPng, size, outPath) {
  execFileSync('sips', ['-z', String(size), String(size), srcPng, '--out', outPath], {
    stdio: 'ignore',
  });
  return outPath;
}

/** iconutil 로 .icns — macOS 표준 iconset 이름 규칙을 따른다 */
function buildIcns(srcPng, tmp) {
  const set = path.join(tmp, 'icon.iconset');
  fs.mkdirSync(set, { recursive: true });
  const entries = [
    [16, 'icon_16x16.png'],
    [32, 'icon_16x16@2x.png'],
    [32, 'icon_32x32.png'],
    [64, 'icon_32x32@2x.png'],
    [128, 'icon_128x128.png'],
    [256, 'icon_128x128@2x.png'],
    [256, 'icon_256x256.png'],
    [512, 'icon_256x256@2x.png'],
    [512, 'icon_512x512.png'],
    [1024, 'icon_512x512@2x.png'],
  ];
  for (const [size, name] of entries) resize(srcPng, size, path.join(set, name));
  const out = path.join(OUT_DIR, 'icon.icns');
  execFileSync('iconutil', ['-c', 'icns', set, '-o', out], { stdio: 'inherit' });
  return out;
}

/**
 * .ico 직접 조립 — 각 크기의 **PNG 를 그대로 담는다**(Vista+ 가 지원하는 형식).
 * BMP 로 넣으려면 상하 반전·AND 마스크까지 만들어야 해서, PNG 埋め込み이 훨씬 안전하다.
 */
function buildIco(srcPng, tmp) {
  const sizes = [16, 32, 48, 64, 128, 256];
  const images = sizes.map((s) =>
    fs.readFileSync(resize(srcPng, s, path.join(tmp, `ico-${s}.png`))),
  );
  const count = sizes.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = 아이콘
  header.writeUInt16LE(count, 4);

  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  sizes.forEach((size, i) => {
    const at = i * 16;
    dir[at] = size >= 256 ? 0 : size; // 256 은 0 으로 표기한다
    dir[at + 1] = size >= 256 ? 0 : size;
    dir[at + 2] = 0; // 팔레트 색 수 (트루컬러는 0)
    dir[at + 3] = 0; // reserved
    dir.writeUInt16LE(1, at + 4); // 색 평면
    dir.writeUInt16LE(32, at + 6); // 픽셀당 비트
    dir.writeUInt32LE(images[i].length, at + 8);
    dir.writeUInt32LE(offset, at + 12);
    offset += images[i].length;
  });

  const out = path.join(OUT_DIR, 'icon.ico');
  fs.writeFileSync(out, Buffer.concat([header, dir, ...images]));
  return out;
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const result = recolor(decodePng(fs.readFileSync(SRC)));
  fs.writeFileSync(OUT_PNG, encodePng(result));
  console.log(
    `[icon] ${path.relative(REPO, OUT_PNG)} 생성 — 원본 hue ${result.meanHue.toFixed(0)}° → ${TARGET_HUE}° (회전 ${result.delta.toFixed(0)}°, ${result.changed}px / 색 ${result.colors}종, 휘도 유지)`,
  );

  if (!has('sips') || !has('iconutil')) {
    console.warn('[icon] sips·iconutil 이 없어 .icns/.ico 는 만들지 못했습니다 (macOS 에서 실행하세요).');
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lite-icon-'));
  try {
    console.log(`[icon] ${path.relative(REPO, buildIcns(OUT_PNG, tmp))} 생성`);
    console.log(`[icon] ${path.relative(REPO, buildIco(OUT_PNG, tmp))} 생성`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main();
