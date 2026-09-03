// CHANGELOG.md 읽기·찍기 — 배포 스크립트(release.mjs)가 릴리스 노트를 뽑고 버전 자리를 검증하는 데 쓴다.
//
// 흐름(Keep a Changelog 방식):
//   변경을 만드는 커밋 → `## Unreleased` 아래에 한 줄 (/commit 절차)
//   배포(/release)     → `## Unreleased` 를 `## x.y.z — 날짜` 로 **찍고**, 빈 Unreleased 를 위에 새로 둔다
//
// 형식(CHANGELOG.md 머리말과 같다):
//   ## Unreleased
//
//   ## 2.1.0 — 2026-09-03
//   - [추가] …

const VERSION_HEADER = /^## (\d+\.\d+\.\d+)\b/;
const UNRELEASED_HEADER = /^## Unreleased\b/;
const isHeader = (line) => VERSION_HEADER.test(line) || UNRELEASED_HEADER.test(line);

/** `start` 줄(헤더)부터 다음 헤더 전까지의 본문 — 비어 있으면 undefined */
function sectionAt(lines, start) {
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (isHeader(lines[i])) {
      end = i;
      break;
    }
  }
  const body = lines.slice(start + 1, end).join('\n').trim();
  return body || undefined;
}

/** `## x.y.z` 절의 본문(불릿들) — 없으면 undefined */
export function changelogSection(text, version) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => VERSION_HEADER.exec(l)?.[1] === version);
  return start < 0 ? undefined : sectionAt(lines, start);
}

/** `## Unreleased` 절의 본문 — 아직 배포 안 된 변경. 비어 있거나 절이 없으면 undefined */
export function unreleasedSection(text) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => UNRELEASED_HEADER.test(l));
  return start < 0 ? undefined : sectionAt(lines, start);
}

/** 파일 맨 위 **버전** 항목 — Unreleased 는 세지 않는다 */
export function latestVersion(text) {
  for (const line of text.split('\n')) {
    const v = VERSION_HEADER.exec(line)?.[1];
    if (v) return v;
  }
  return undefined;
}

/**
 * `## Unreleased` 를 `## <version> — <date>` 로 바꾸고, 그 위에 빈 `## Unreleased` 를 새로 둔다.
 * 본문(불릿)은 그대로 새 버전 절의 것이 된다. Unreleased 절이 없으면 던진다.
 */
export function stampUnreleased(text, version, date) {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => UNRELEASED_HEADER.test(l));
  if (i < 0) throw new Error('CHANGELOG.md 에 "## Unreleased" 절이 없습니다');
  lines.splice(i, 1, '## Unreleased', '', `## ${version} — ${date}`);
  return lines.join('\n');
}

/** 배포 리포에 올릴 때 — **비어 있는** Unreleased 헤더는 빼서 읽는 사람에게 노이즈를 주지 않는다 */
export function withoutEmptyUnreleased(text) {
  if (unreleasedSection(text)) return text; // 내용이 있으면 그대로(배포 안 된 것이 있다는 사실도 정보다)
  const lines = text.split('\n');
  const i = lines.findIndex((l) => UNRELEASED_HEADER.test(l));
  if (i < 0) return text;
  let j = i + 1;
  while (j < lines.length && !lines[j].trim()) j += 1; // 헤더 뒤 빈 줄까지
  lines.splice(i, j - i);
  return lines.join('\n');
}

/** 오늘 날짜 `YYYY-MM-DD` (로컬) */
export const todayStamp = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

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

/** 제안한 자리를 실제 버전에 적용 — /release 가 `--version` 없이 부를 때 스크립트가 쓴다 */
export function applyBump(version, kind) {
  const [major, minor, patch] = version.split('.').map(Number);
  if (kind === 'major') return `${major + 1}.0.0`;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

const RANK = { patch: 0, minor: 1, major: 2 };
/** 제안보다 낮게 올렸는가 (예: [추가]가 있는데 patch) */
export const bumpTooSmall = (actual, suggested) => RANK[actual] < RANK[suggested];
