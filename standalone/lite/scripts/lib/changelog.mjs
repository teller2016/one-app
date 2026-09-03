// CHANGELOG.md 읽기 — 배포 스크립트(release.mjs)가 릴리스 노트를 뽑고 버전 자리를 검증하는 데 쓴다.
// 형식(CHANGELOG.md 머리말과 같다):
//   ## 2.1.0 — 2026-09-03
//   - [추가] …
//   - [개선] …

const HEADER = /^## (\d+\.\d+\.\d+)\b/;

/** `## x.y.z` 절의 본문(불릿들)을 돌려준다 — 없으면 undefined */
export function changelogSection(text, version) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => HEADER.exec(l)?.[1] === version);
  if (start < 0) return undefined;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (HEADER.test(lines[i])) {
      end = i;
      break;
    }
  }
  const body = lines.slice(start + 1, end).join('\n').trim();
  return body || undefined;
}

/** 파일 맨 위 항목의 버전 — "다음 릴리스 항목을 이미 적었는가" 판단용 */
export function latestVersion(text) {
  for (const line of text.split('\n')) {
    const v = HEADER.exec(line)?.[1];
    if (v) return v;
  }
  return undefined;
}

/**
 * 항목 표기로 올릴 자리를 정한다 — CHANGELOG.md 머리말의 규칙 그대로.
 *   [주의] → major · [추가]/[변경] → minor · 그 외([개선]/[수정]) → patch
 */
export function suggestBump(sectionBody) {
  if (/\[주의\]/.test(sectionBody)) return 'major';
  if (/\[(추가|변경)\]/.test(sectionBody)) return 'minor';
  return 'patch';
}

/** 두 버전 사이에서 실제로 올라간 자리 — 같으면 undefined */
export function bumpKind(from, to) {
  const a = from.split('.').map(Number);
  const b = to.split('.').map(Number);
  if (b[0] !== a[0]) return 'major';
  if (b[1] !== a[1]) return 'minor';
  if (b[2] !== a[2]) return 'patch';
  return undefined;
}

const RANK = { patch: 0, minor: 1, major: 2 };
/** 제안보다 낮게 올렸는가 (예: [추가]가 있는데 patch) */
export const bumpTooSmall = (actual, suggested) => RANK[actual] < RANK[suggested];
