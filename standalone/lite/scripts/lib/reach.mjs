// lite 에 "실리는" 파일 집계 — 세 엔트리(main·preload·renderer)에서 import 를 끝까지 따라간다.
//
// 이 앱은 본체(../../src)를 `@one/*` alias 로 직접 import 하므로 "본체의 어느 파일이 lite 에
// 실리는가" 는 사람이 외울 것이 아니라 import 그래프에서 나와야 한다. 두 곳이 이 결과를 쓴다:
//   - scripts/reach.test.ts  — 값으로 import 하는 외부 패키지가 허용 목록 밖으로 새지 않는지
//     (본체 파일이 react-markdown·ws 같은 것을 import 하면 TS·Vite 모두 루트 node_modules 를
//     따라 올라가 해석하므로 **아무 경고 없이** lite 번들에 들어간다)
//   - /commit 스킬 — 변경 파일이 lite 에 실리는지 판단해 CHANGELOG·lite typecheck 를 챙긴다
//
// 정적 import · `export … from` · 부수효과 import · 동적 import() · SCSS `@use`/`@forward` 를 본다.
// 타입만 가져오는 import 도 **파일 도달**에는 넣지만(계약 변경도 lite 에 영향) 외부 패키지 집계에서는
// 값 import 와 구분한다(`import type` 은 번들에 남지 않는다).
import fs from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LITE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const REPO_ROOT = path.resolve(LITE_ROOT, '../..');
const ONE_SRC = path.join(REPO_ROOT, 'src');

/** lite 의 세 엔트리 — forge.config.ts 의 build/renderer 엔트리와 같다 */
export const ENTRIES = ['src/main/main.ts', 'src/preload/preload.ts', 'src/renderer/renderer.tsx'];

// `import [type] <무엇> from '<spec>'` · `export [type] <무엇> from '<spec>'` — 여러 줄 `{ … }` 포함.
// <무엇> 을 명시적으로 제한해 `export function …` 본문 속 `from` 에 걸리지 않게 한다.
const RE_STATIC =
  /^[ \t]*(import|export)\s+(type\s+)?(\*(?:\s+as\s+[\w$]+)?|\{[^}]*\}|[\w$]+(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+[\w$]+))?)\s*from\s*['"]([^'"]+)['"]/gm;
const RE_SIDE_EFFECT = /^[ \t]*import\s*['"]([^'"]+)['"]/gm;
const RE_DYNAMIC = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
const RE_SCSS = /^[ \t]*@(?:use|forward)\s+['"]([^'"]+)['"]/gm;

const TS_EXTS = ['', '.ts', '.tsx', '.d.ts', '/index.ts', '/index.tsx'];
const ASSET_EXT = /\.(png|jpe?g|gif|svg|webp|woff2?|ttf|otf|json)$/i;
const NODE_BUILTINS = new Set(builtinModules);

/** `{ type A, type B }` 처럼 지정자 전부가 type 이면 타입 전용 import */
function allTypeSpecifiers(clause) {
  const m = /\{([^}]*)\}/.exec(clause);
  if (!m) return false;
  const specs = m[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return specs.length > 0 && specs.every((s) => /^type\s+/.test(s));
}

/** bare 지정자 → 패키지 이름 (`react-dom/client` → `react-dom`, `@scope/x/y` → `@scope/x`, node 내장 → `node:*`) */
export function packageOf(spec) {
  if (spec.startsWith('node:')) return 'node:*';
  const pkg = spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/');
  return NODE_BUILTINS.has(pkg) ? 'node:*' : pkg;
}

function resolveTs(spec, fromFile) {
  let base;
  if (spec.startsWith('@one/')) base = path.join(ONE_SRC, spec.slice('@one/'.length));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
  else return null;
  for (const ext of TS_EXTS) {
    const p = base + ext;
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return null;
}

/** sass 규칙 — `name` → `_name.scss` · `name.scss` · `name/_index.scss` · `name/index.scss` */
function resolveScss(spec, fromFile) {
  if (spec.startsWith('sass:')) return null; // 내장 모듈
  const base = path.resolve(path.dirname(fromFile), spec);
  const dir = path.dirname(base);
  const name = path.basename(base).replace(/\.scss$/, '');
  for (const p of [
    path.join(dir, `_${name}.scss`),
    path.join(dir, `${name}.scss`),
    path.join(base, '_index.scss'),
    path.join(base, 'index.scss'),
  ]) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * @returns {{
 *   files: string[];                       // 도달한 파일 전부 (리포 기준 상대 경로, 정렬)
 *   bodyFiles: string[];                   // 그중 본체 src/ 것
 *   bare: Record<string, string[]>;        // 값으로 import 하는 외부 패키지 → 그렇게 하는 파일들
 *   typeOnlyBare: Record<string, string[]>;// 타입만 가져오는 외부 패키지
 *   unresolved: { spec: string; from: string }[];
 * }}
 */
export function collectReach() {
  const seen = new Set();
  const bare = new Map();
  const typeOnlyBare = new Map();
  const unresolved = [];
  const rel = (f) => path.relative(REPO_ROOT, f).split(path.sep).join('/');

  const noteBare = (spec, from, typeOnly) => {
    const map = typeOnly ? typeOnlyBare : bare;
    const pkg = packageOf(spec);
    if (!map.has(pkg)) map.set(pkg, new Set());
    map.get(pkg).add(rel(from));
  };

  const visit = (spec, from, typeOnly) => {
    if (spec.endsWith('.scss') || spec.endsWith('.css')) {
      const r = spec.startsWith('.') ? path.resolve(path.dirname(from), spec) : null;
      if (r && fs.existsSync(r)) walkScss(r);
      else unresolved.push({ spec, from: rel(from) });
      return;
    }
    if (ASSET_EXT.test(spec)) return;
    const r = resolveTs(spec, from);
    if (r) walkTs(r);
    else if (spec.startsWith('.') || spec.startsWith('@one/')) unresolved.push({ spec, from: rel(from) });
    else noteBare(spec, from, typeOnly);
  };

  function walkTs(file) {
    if (seen.has(file)) return;
    seen.add(file);
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(RE_STATIC)) {
      const typeOnly = !!m[2] || allTypeSpecifiers(m[3]);
      visit(m[4], file, typeOnly);
    }
    for (const m of src.matchAll(RE_SIDE_EFFECT)) visit(m[1], file, false);
    for (const m of src.matchAll(RE_DYNAMIC)) visit(m[1], file, false);
  }

  function walkScss(file) {
    if (seen.has(file)) return;
    seen.add(file);
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(RE_SCSS)) {
      const r = resolveScss(m[1], file);
      if (r) walkScss(r);
      else if (!m[1].startsWith('sass:')) unresolved.push({ spec: m[1], from: rel(file) });
    }
  }

  for (const e of ENTRIES) walkTs(path.join(LITE_ROOT, e));

  const toObj = (map) =>
    Object.fromEntries([...map].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, [...v].sort()]));
  const files = [...seen].map(rel).sort();
  return {
    files,
    bodyFiles: files.filter((f) => f.startsWith('src/')),
    bare: toObj(bare),
    typeOnlyBare: toObj(typeOnlyBare),
    unresolved,
  };
}

/**
 * 주어진 경로(리포 기준 또는 절대) 중 lite 에 실리는 것만 — /commit 이 변경 파일을 걸러낼 때 쓴다.
 * lite 자체 소스(`standalone/lite/src/**`)는 그래프와 무관하게 실리는 것으로 본다 — `global.d.ts`·
 * `forge.env.d.ts` 같은 선언 파일은 아무도 import 하지 않아 그래프에 안 잡히기 때문.
 */
export function hits(paths, reach = collectReach()) {
  const set = new Set(reach.files);
  return paths
    .map((p) => (path.isAbsolute(p) ? path.relative(REPO_ROOT, p) : p).split(path.sep).join('/'))
    .filter((p) => set.has(p) || p.startsWith('standalone/lite/src/'));
}
