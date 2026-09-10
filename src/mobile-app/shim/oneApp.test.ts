// MO 셸의 `window.oneApp` 대역(SPEC)이 실제 화면·main 과 어긋나지 않는지 — 루트 `npm test` 가 돈다.
//
// ⚠️ SPEC 은 수동 표라 preload 에 메서드가 늘어도 타입·빌드 어디서도 잡히지 않았다. 2026-09-10 감사에서
// 폰의 Jira [보고]·[+ 티켓]·PR [새 PR]·메일 [인증코드] 네 곳이 `undefined is not a function` 으로
// 탭 전체가 오류 카드였다(전부 8월 셸 이후 PC 가 추가한 메서드). 세 방향으로 막는다:
//   ① 폰 셸에서 도달하는 렌더러 소스가 부르는 `window.oneApp.X.Y` 는 SPEC 에 있어야 한다
//   ② SPEC 의 호출 채널은 main 에 `handleShared` 로 등록돼 있어야 한다(= MO 화이트리스트 선언)
//   ③ SPEC 의 구독 채널은 main 이 `broadcast()` 로 내보내야 한다(`webContents.send` 는 폰에 안 닿는다)
//
// 한계: `const api = window.oneApp; api.workspaces.list()` 처럼 별칭을 거친 호출은 보지 못한다.
// 그런 화면은 폰에서 진입점을 숨기고(`mo.scss`) 아래 DESKTOP_ONLY 에 이유를 적는다.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SHIM_EXTRAS, SPEC, type SpecNode } from './oneApp';

const ROOT = process.cwd(); // vitest 는 리포 루트에서 돈다 (`npm test`)
const ENTRY = path.join(ROOT, 'src/mobile-app/main.tsx');

/**
 * 폰에서 부르지 않는 것이 **의도**인 호출 경로(접두 일치). 항목마다 왜 폰에서 안 불리는지 적는다 —
 * 이유가 사라지면(그 화면이 폰에 마운트되면) 항목을 지우고 SPEC·main 을 열어야 한다.
 */
const DESKTOP_ONLY: Record<string, string> = {
  terminal: 'JiraSection 이 `window.oneApp?.terminal` 옵셔널 가드로 부른다 — 폰에서는 undefined 로 빠져 femc 세션 칩만 없다',
  'settings.setTheme': 'lib/theme.ts — 환경설정 세그먼트에서만 호출한다(폰에는 환경설정이 없다)',
  'mail.openWeb': 'MailWidget(사이드바 위젯) 전용 — 폰은 MailModal 만 마운트한다',
  'mail.saveAuthCodeAccount': 'AltAccountsCard(환경설정) 전용 — 등록·삭제는 비밀번호를 받는 쓰기라 폰에 열지 않는다',
  'mail.removeAuthCodeAccount': 'AltAccountsCard(환경설정) 전용 — 위와 같음',
  'jira.prepareWork': 'StartWorkModal — 맥에 femc 세션을 만드는 흐름. 진입 버튼을 mo.scss(.jira__work/.jira-view__work)가 숨긴다',
  'jira.workAccounts': 'StartWorkModal — 위와 같음',
  approval: 'OvertimeModal(야근 결재) — 상신 흐름이라 mo.scss(.sbw__overtime)가 진입 버튼을 숨긴다',
};

/** SPEC 에 선언해 두되 main 이 **의도적으로** 열지 않는 채널 — 브리지가 거절 문구를 돌려주게 하려는 선언 */
const CLOSED_ON_PURPOSE = new Set(['deploy:projects:save', 'deploy:projects:delete']);

// ── 폰 셸의 import 도달 그래프 ──

const SRC_EXT = ['.ts', '.tsx'];

function resolveImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null; // 외부 패키지
  if (/\.(scss|css|svg|png|jpe?g|woff2?)$/.test(spec) || spec.includes('?')) return null;
  const base = path.resolve(path.dirname(fromFile), spec);
  const candidates = [
    base,
    ...SRC_EXT.map((e) => base + e),
    ...SRC_EXT.map((e) => path.join(base, `index${e}`)),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

// `from '...'` (import·export-from, 여러 줄 포함) 과 `import('...')` (lazy)
const IMPORT_RE = /(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g;

function reachFrom(entry: string): string[] {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(IMPORT_RE)) {
      const next = resolveImport(file, m[1]);
      if (next && !seen.has(next)) queue.push(next);
    }
  }
  return [...seen];
}

// ── window.oneApp 호출 경로 수집 ──

// `window.oneApp.jira.report\n  .getPrefs(` 처럼 줄이 바뀌어도, `?.` 옵셔널 체인이어도 잡는다
const CALL_RE =
  /window\s*\.\s*oneApp(?:\s*\??\.\s*([A-Za-z_]\w*))(?:\s*\??\.\s*([A-Za-z_]\w*))?(?:\s*\??\.\s*([A-Za-z_]\w*))?/g;

/** 호출 경로가 SPEC(또는 최상위 부가 멤버)에 있는가 — 경로 끝이 네임스페이스여도(별칭 대입) 통과 */
function specHas(segments: string[]): boolean {
  if (segments.length === 1 && (SHIM_EXTRAS as readonly string[]).includes(segments[0])) return true;
  let node: SpecNode | undefined = SPEC[segments[0]];
  for (const seg of segments.slice(1)) {
    if (!node || 'ch' in node || 'ev' in node) return false;
    node = (node as Record<string, SpecNode>)[seg];
  }
  return node !== undefined;
}

function isDesktopOnly(segments: string[]): boolean {
  const joined = segments.join('.');
  return Object.keys(DESKTOP_ONLY).some((k) => joined === k || joined.startsWith(`${k}.`));
}

/** 호출 경로를 SPEC 깊이에 맞춰 자른다 — `prs.getConfig().then` 의 `then` 같은 꼬리를 떼기 위함 */
function trimToSpecDepth(segments: string[]): string[] {
  let node: SpecNode | undefined = SPEC[segments[0]];
  if (!node) return segments.slice(0, isDesktopOnly(segments) ? segments.length : 2);
  for (let i = 1; i < segments.length; i++) {
    if ('ch' in node || 'ev' in node) return segments.slice(0, i);
    node = (node as Record<string, SpecNode>)[segments[i]];
    if (!node) return segments.slice(0, i + 1);
  }
  return segments;
}

// ── main 쪽 등록 수집 ──

function listMainSources(): string[] {
  const dir = path.join(ROOT, 'src/main');
  return fs
    .readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => path.join(dir, f));
}

function collectPattern(files: string[], re: RegExp): Set<string> {
  const out = new Set<string>();
  for (const f of files) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(re)) out.add(m[1]);
  }
  return out;
}

/** SPEC 의 잎을 전부 나열 — [경로, 채널, 종류] */
function specLeaves(): { path: string; channel: string; kind: 'ch' | 'ev' }[] {
  const out: { path: string; channel: string; kind: 'ch' | 'ev' }[] = [];
  const walk = (node: SpecNode, prefix: string) => {
    if ('ch' in node && typeof node.ch === 'string') return out.push({ path: prefix, channel: node.ch, kind: 'ch' });
    if ('ev' in node && typeof node.ev === 'string') return out.push({ path: prefix, channel: node.ev, kind: 'ev' });
    for (const [k, v] of Object.entries(node)) walk(v as SpecNode, prefix ? `${prefix}.${k}` : k);
  };
  walk(SPEC, '');
  return out;
}

const reached = reachFrom(ENTRY);
const mainFiles = listMainSources();

describe('MO shim 채널 표(SPEC)', () => {
  it('폰 셸이 렌더러 기능 화면에 실제로 닿는다 (그래프가 비어 있으면 워커가 깨진 것)', () => {
    const rel = reached.map((f) => path.relative(ROOT, f));
    expect(rel.length).toBeGreaterThan(30);
    expect(rel).toContain('src/renderer/features/jira/components/JiraReportPanel.tsx');
    expect(rel).toContain('src/renderer/features/mail/components/AuthCodePanel.tsx');
    expect(rel).toContain('src/renderer/features/prs/components/CreatePrModal.tsx');
  });

  it('① 폰에서 도달하는 화면이 부르는 window.oneApp 경로가 전부 표에 있다', () => {
    const missing = new Map<string, Set<string>>(); // 경로 → 파일들
    for (const file of reached) {
      if (file.startsWith(path.join(ROOT, 'src/mobile-app/shim'))) continue; // 표 자신
      const src = fs.readFileSync(file, 'utf8');
      for (const m of src.matchAll(CALL_RE)) {
        const raw = [m[1], m[2], m[3]].filter((s): s is string => !!s);
        const segments = trimToSpecDepth(raw);
        if (isDesktopOnly(segments) || specHas(segments)) continue;
        const key = segments.join('.');
        if (!missing.has(key)) missing.set(key, new Set());
        missing.get(key)?.add(path.relative(ROOT, file));
      }
    }
    const detail = [...missing]
      .map(([k, files]) => `${k} ← ${[...files].join(', ')}`)
      .join('\n');
    expect(
      missing.size,
      `폰 셸에서 부르는데 shim 표(SPEC)에 없는 메서드 — 폰에서 그 버튼을 누르면 탭이 통째로 죽는다:\n${detail}`,
    ).toBe(0);
  });

  it('② 표의 호출 채널은 main 이 handleShared 로 열어 두었다', () => {
    const shared = collectPattern(mainFiles, /handleShared\(\s*['"]([^'"]+)['"]/g);
    const notOpen = specLeaves()
      .filter((l) => l.kind === 'ch' && !CLOSED_ON_PURPOSE.has(l.channel) && !shared.has(l.channel))
      .map((l) => `${l.path} → ${l.channel}`);
    expect(
      notOpen,
      'shim 표에는 있는데 main 에 handleShared 가 아닌 채널 — 폰에서 "폰에서 쓸 수 없는 기능입니다" 가 뜬다',
    ).toEqual([]);
  });

  it('②′ 의도적으로 닫아 둔 채널 목록이 실제와 맞다 (열었다면 CLOSED_ON_PURPOSE 에서 뺄 것)', () => {
    const shared = collectPattern(mainFiles, /handleShared\(\s*['"]([^'"]+)['"]/g);
    const stale = [...CLOSED_ON_PURPOSE].filter((c) => shared.has(c));
    expect(stale).toEqual([]);
    // 반대로 닫힌 채널은 표에 선언돼 있어야 거절 문구가 나온다(없으면 TypeError)
    const declared = new Set(specLeaves().map((l) => l.channel));
    expect([...CLOSED_ON_PURPOSE].filter((c) => !declared.has(c))).toEqual([]);
  });

  it('③ 표의 구독 채널은 main 이 broadcast() 로 내보낸다', () => {
    const broadcasted = collectPattern(mainFiles, /broadcast\(\s*['"]([^'"]+)['"]/g);
    const silent = specLeaves()
      .filter((l) => l.kind === 'ev' && !broadcasted.has(l.channel))
      .map((l) => `${l.path} → ${l.channel}`);
    expect(
      silent,
      'shim 이 구독하는데 main 이 broadcast 하지 않는 이벤트 — webContents.send 는 폰 소켓에 닿지 않는다',
    ).toEqual([]);
  });
});
