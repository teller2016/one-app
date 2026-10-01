// 채팅 보기의 이미지 첨부 — 붙여넣은 이미지를 임시 폴더에 PNG 등으로 저장해 **경로**를 돌려준다.
// 보낼 때 그 경로를 claude 입력란에 한 장씩 붙여넣으면 claude 가 `[Image #N]` 으로 바꿔 첨부한다
// (2026-10-01 실측 — 경로 여러 개를 한 번에 붙이면 맨 앞 하나만 바뀌어 **한 장씩 따로** 붙인다. chat.ts sendChatText).
// 예전엔 ⌘V 순간 claude 에 Ctrl+V 를 보냈는데, 그러면 이미지가 claude 입력란에만 있어 채팅 쪽에서 낱장 칩·삭제·
// 보기 전환 뒤 유지가 불가능했다(사용자 신고 3건).
import { app } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** 이미지로 볼 확장자 — claude 가 붙여넣은 경로를 이미지로 바꾸는 종류 */
export const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp)$/i;

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/** 한 장 상한 — 스크린샷 원본(레티나 전체 화면)도 넉넉히 들어가되 폭주는 막는다 */
const MAX_BYTES = 30 * 1024 * 1024;
/** 하루 지난 첨부는 다음 저장 때 지운다 — 보낸 뒤엔 claude 가 이미 읽었다 */
const KEEP_MS = 24 * 60 * 60 * 1000;

const dir = () => path.join(app.getPath('temp'), 'one-app-chat-images');

function sweep(d: string) {
  try {
    const now = Date.now();
    for (const name of fs.readdirSync(d)) {
      const f = path.join(d, name);
      if (now - fs.statSync(f).mtimeMs > KEEP_MS) fs.rmSync(f, { force: true });
    }
  } catch {
    // 정리는 덤 — 실패해도 저장은 계속한다
  }
}

/** 붙여넣은 이미지 저장 → 경로. 형식이 이미지가 아니거나 너무 크면 null */
export function saveChatImage(data: Uint8Array, mime: string): string | null {
  const ext = EXT_BY_MIME[mime];
  if (!ext || !(data instanceof Uint8Array) || !data.byteLength || data.byteLength > MAX_BYTES) return null;
  const d = dir();
  fs.mkdirSync(d, { recursive: true });
  sweep(d);
  const f = path.join(d, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`);
  fs.writeFileSync(f, data);
  return f;
}

/** 우리가 저장한 첨부인가 — 폰(WS)에서 온 경로는 이것만 허용한다(임의 파일을 claude 에 읽히지 않게) */
export function isChatImagePath(p: string): boolean {
  const d = dir() + path.sep;
  return path.resolve(p).startsWith(d);
}
