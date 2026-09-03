// PNG 디코드·인코드 — 아이콘 생성 스크립트들의 공용 코덱.
//
// 외부 이미지 라이브러리(sharp·jimp 등)를 쓰지 않는다 — 아이콘 몇 장을 위해 네이티브
// 의존성을 늘릴 이유가 없고, macOS 기본 도구(sips)는 합성·색 변환을 못 한다.
// Node 내장 zlib 만으로 처리한다.
//
// 지원 범위는 이 프로젝트의 아이콘 형식(8bit RGBA·비인터레이스)뿐이다 —
// 원본을 다른 형식으로 교체하면 decodePng 가 명시적으로 실패한다.
import zlib from 'node:zlib';

// ── PNG 디코드 ────────────────────────────────────────────────────────────
// 지원 범위는 이 프로젝트의 아이콘 형식(8bit RGBA·비인터레이스)뿐이다.
// 원본을 다른 형식으로 교체하면 여기서 명시적으로 실패한다.

export function decodePng(buf) {
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!SIG.every((b, i) => buf[i] === b)) throw new Error('PNG 시그니처가 아닙니다');

  let width = 0;
  let height = 0;
  const idat = [];
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const [depth, color, , , interlace] = [data[8], data[9], data[10], data[11], data[12]];
      if (depth !== 8 || color !== 6 || interlace !== 0) {
        throw new Error(`8bit RGBA·비인터레이스 PNG 만 지원합니다 (depth=${depth} color=${color} interlace=${interlace})`);
      }
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = 4;
  const stride = width * bpp;
  const px = Buffer.alloc(stride * height);

  // 스캔라인 필터 해제 (PNG 명세 9.2) — 각 줄 맨 앞 1바이트가 필터 타입
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = px.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0; // 왼쪽
      const b = prev ? prev[x] : 0; // 위
      const c = prev && x >= bpp ? prev[x - bpp] : 0; // 왼쪽 위
      const v = line[x];
      let out;
      switch (filter) {
        case 0: out = v; break;
        case 1: out = v + a; break;
        case 2: out = v + b; break;
        case 3: out = v + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          out = v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`알 수 없는 필터 타입: ${filter}`);
      }
      cur[x] = out & 0xff;
    }
  }
  return { width, height, px };
}

// ── PNG 인코드 ────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

export function encodePng({ width, height, px }) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  // 10·11·12 = compression·filter·interlace 전부 0(기본)

  const stride = width * 4;
  // 필터는 전부 None — 압축률이 조금 낮아지지만(아이콘 한 장이라 무의미) 단순하고 안전하다
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    px.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
