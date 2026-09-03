// 단독판(One App Lite) 배포 — 버전 올리고 · Windows·macOS 산출물을 만들고 · GitHub Releases 에 올린다.
//
// 팀원에게 주는 링크는 항상 `.../releases/latest` 하나이므로, 한 번 공유하면 다음 배포에도 그대로 유효하다.
//
// 실행:
//   npm run release                    자리는 CHANGELOG `## Unreleased` 의 표기로 정한다
//                                      ([주의]→a · [추가]/[변경]→b · [개선]/[수정]→c)
//   npm run release -- --minor         자리 강제 (--major · --patch 도) — 표기보다 낮으면 경고
//   npm run release -- --version=2.5.0 버전 직접 지정
//   npm run release -- --notes="…"     릴리스 노트 맨 위에 덧붙일 문구 (CHANGELOG 항목이 없을 때는 이것만으로 대신)
//   npm run release -- --dry-run       빌드까지만 하고 업로드 직전에 멈춘다
//   npm run release -- --skip-build    이미 만든 산출물로 업로드만 (dry-run 다음에 이어서)
//   npm run release -- --allow-unsigned  macOS 서명 검증 실패를 경고로만 (기본은 중단)
//
// 릴리스 노트는 **CHANGELOG.md 의 `## Unreleased` 절**이다 — 변경을 만든 커밋이 적어 둔 것을, 여기서
// `## x.y.z — 날짜` 로 찍어 올린다. 비어 있으면 멈춘다(받는 사람에게 무엇이 달라졌는지 말하지 않는 배포를
// 막는다). 항목 표기([추가]·[변경]·[개선]·[수정]·[주의])가 버전 자리의 근거다 — `--version`/`--minor` 등을
// 안 주면 **표기대로 올리고**, 줬는데 표기보다 낮으면 경고한다(판단은 /release 스킬이, 여기는 가드).
//
// ⚠️ 커밋·태그는 이 스크립트가 하지 않는다 — 올라간 package.json·CHANGELOG.md 는 `/commit` 으로 따로 커밋한다.
//    (이 리포는 커밋을 /commit 스킬 경유로만 허용한다)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  applyBump,
  bumpKind,
  bumpTooSmall,
  changelogSection,
  stampUnreleased,
  suggestBump,
  todayStamp,
  unreleasedSection,
  withoutEmptyUnreleased,
} from './lib/changelog.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LITE = path.resolve(HERE, '..');
const PKG_PATH = path.join(LITE, 'package.json');
const CHANGELOG_PATH = path.join(LITE, 'CHANGELOG.md');
const OUT_MAKE = path.join(LITE, 'out', 'make');

/**
 * 배포 리포 — 소스가 아니라 **산출물과 사용 안내만** 두는 public 리포다.
 * ⚠️ 바꾸면 `src/main/update.ts` 의 같은 상수도 함께 바꿀 것 (앱의 새 버전 확인이 이 리포를 본다).
 */
const REPO = 'teller2016/one-app-lite';

/** 앱·실행 파일 이름 (forge.config.ts 의 EXECUTABLE 과 같아야 한다 — 서명 검증에 쓴다) */
const EXECUTABLE = 'OneAppLite';
/** macOS 자가서명 인증서 — 빌드마다 서명이 같아야 받는 사람의 저장된 계정이 유지된다 */
const SIGN_IDENTITY = 'One App Sign';

// ── 인자 ──
const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (name) =>
  argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const dryRun = has('--dry-run');
const skipBuild = has('--skip-build');
const allowUnsigned = has('--allow-unsigned');
const notes = valueOf('notes') ?? '';

const log = (msg) => console.log(`\x1b[36m▸\x1b[0m ${msg}`);
const done = (msg) => console.log(`\x1b[32m✓\x1b[0m ${msg}`);
const die = (msg) => {
  console.error(`\x1b[31m✗ ${msg}\x1b[0m`);
  process.exit(1);
};

/** 하위 명령 — 출력은 그대로 흘려보내고, 실패하면 한국어 안내와 함께 멈춘다 */
const run = (cmd, label) => {
  try {
    execSync(cmd, { cwd: LITE, stdio: 'inherit' });
  } catch {
    die(`${label} 실패 — 위 출력을 확인하세요.`);
  }
};

// ── 0. gh CLI 확인 ──
// 릴리스 생성·업로드를 gh 가 전부 한다. 빌드를 다 하고 나서 인증이 없다고 멈추면 시간이 아까우므로 먼저 본다.
if (!dryRun) {
  try {
    execFileSync('gh', ['auth', 'status'], { stdio: 'ignore' });
  } catch {
    die(
      'GitHub CLI(gh) 로 로그인되어 있지 않습니다 — `brew install gh && gh auth login` 후 다시 실행하세요.',
    );
  }
}

// ── 1. 타입 검사 (본체 코드까지 따라가며 검사한다) ──
if (!skipBuild) {
  log('타입 검사 (본체 코드 포함)…');
  run('npm run typecheck', '타입 검사');
  done('타입 검사 통과');
}

// ── 2. 버전 결정 ──
const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
const current = pkg.version;

/** semver 한 칸 올리기 — 프리릴리스·빌드 메타데이터는 쓰지 않는다(사내 배포라 x.y.z 로 충분) */
const bump = (version, kind) => {
  if (!/^\d+\.\d+\.\d+$/.test(version))
    die(`package.json 의 version 형식이 x.y.z 가 아닙니다: ${version}`);
  return applyBump(version, kind);
};

const explicit = valueOf('version');
if (explicit && !/^\d+\.\d+\.\d+$/.test(explicit))
  die(`--version 은 x.y.z 형식이어야 합니다: ${explicit}`);

// 릴리스 노트 후보 — 이미 이번 버전 절이 있으면(재시도·skip-build) 그것, 아니면 Unreleased
let changelog = fs.existsSync(CHANGELOG_PATH) ? fs.readFileSync(CHANGELOG_PATH, 'utf8') : '';
const pending = unreleasedSection(changelog);

const forcedKind = has('--major') ? 'major' : has('--minor') ? 'minor' : has('--patch') ? 'patch' : undefined;
const version = skipBuild
  ? current // 이미 그 버전으로 빌드된 산출물을 올리는 경우다
  : (explicit ??
    // 자리를 안 정해 줬으면 Unreleased 의 표기로 정한다 — 항목이 없으면 patch(어차피 아래에서 멈춘다)
    bump(current, forcedKind ?? (pending ? suggestBump(pending) : 'patch')));
const tag = `v${version}`;

// 이미 올라간 버전을 덮어쓰면 받은 사람과 버전이 어긋난다 — 먼저 막는다.
if (!dryRun) {
  let exists = true;
  try {
    execFileSync('gh', ['release', 'view', tag, '--repo', REPO], { stdio: 'ignore' });
  } catch {
    exists = false; // 없는 릴리스 = 정상 경로
  }
  if (exists)
    die(
      `${REPO} 에 이미 ${tag} 릴리스가 있습니다 — 버전을 올리거나(--minor) 기존 릴리스를 지우세요.`,
    );
}

// ── 2-1. 릴리스 노트 = CHANGELOG 의 Unreleased → 이번 버전으로 찍기 ──
// 재시도(--skip-build)나 손으로 미리 찍어 둔 경우엔 이번 버전 절이 이미 있다 — 그러면 그것을 쓴다.
let section = changelogSection(changelog, version);
if (!section && pending) {
  const stamped = stampUnreleased(changelog, version, todayStamp());
  if (dryRun) {
    log(`dry-run: CHANGELOG 의 Unreleased 를 "## ${version}" 으로 찍을 예정 (파일은 그대로 둔다)`);
  } else {
    fs.writeFileSync(CHANGELOG_PATH, stamped);
    changelog = stamped;
    done(`CHANGELOG: Unreleased → ${version} (${todayStamp()})`);
  }
  section = pending;
}
if (!section && !notes)
  die(
    'CHANGELOG.md 의 "## Unreleased" 가 비어 있습니다 — 받는 사람에게 무엇이 달라졌는지 적고 다시 실행하세요.\n' +
      '  (형식은 CHANGELOG.md 머리말. 임시로 건너뛰려면 --notes="…" 를 주세요)',
  );
if (section) {
  done(`릴리스 노트 ${section.split('\n').filter((l) => l.trim()).length}줄`);
  const kind = bumpKind(current, version);
  const suggested = suggestBump(section);
  if (kind && bumpTooSmall(kind, suggested))
    console.warn(
      `\x1b[33m⚠ CHANGELOG 표기로는 ${suggested} 를 올려야 하는데 ${kind} 만 올렸습니다 (${current} → ${version}).` +
        ` 규칙: [주의]→major · [추가]/[변경]→minor · 그 외→patch\x1b[0m`,
    );
}

if (version !== current) {
  pkg.version = version;
  fs.writeFileSync(PKG_PATH, `${JSON.stringify(pkg, null, 2)}\n`);
  done(`버전 ${current} → ${version} (package.json)`);
}

// ── 3. 빌드 (맥 한 대에서 Windows·macOS 산출물을 모두 만든다 — zip maker 만 쓰므로 가능) ──
if (!skipBuild) {
  // 이전 버전 산출물이 섞이지 않게 비우고 시작한다
  fs.rmSync(OUT_MAKE, { recursive: true, force: true });
  log('Windows(x64) 빌드…');
  run('npm run make:win', 'Windows 빌드');
  log('macOS 빌드…');
  run('npm run make:mac', 'macOS 빌드');
}

// ── 3-1. macOS 서명 검증 ──
// 자가서명(`One App Sign`)이 빠지면 빌드마다 서명이 달라져 **받는 사람의 저장된 계정이 날아간다**
// (safeStorage 의 키체인 접근이 서명에 묶여 있다 — 본체 2026-07 실사고와 같은 원인).
// 검증은 zip 이 아니라 패키징된 .app 에 대고 한다(zip 안은 볼 수 없다).
if (!skipBuild && process.platform === 'darwin') {
  const outDir = path.join(LITE, 'out');
  const packaged = fs.existsSync(outDir)
    ? fs
        .readdirSync(outDir)
        .filter((name) => name.startsWith(`${EXECUTABLE}-darwin-`))
        .map((name) => path.join(outDir, name, `${EXECUTABLE}.app`))
        .find((app) => fs.existsSync(app))
    : undefined;

  let signed = false;
  if (packaged) {
    try {
      // codesign 은 stderr 로 출력한다
      const info = execSync(`codesign -dv --verbose=2 "${packaged}" 2>&1`, {
        encoding: 'utf8',
      });
      signed = info.includes(`Authority=${SIGN_IDENTITY}`);
    } catch {
      signed = false; // 서명이 아예 없으면 codesign 이 실패한다
    }
  }

  if (signed) done(`macOS 서명 확인 (${SIGN_IDENTITY})`);
  else if (allowUnsigned)
    console.warn(
      `\x1b[33m⚠ macOS 산출물이 "${SIGN_IDENTITY}" 로 서명되지 않았습니다 — 받는 사람이 다음 버전에서 계정을 다시 입력해야 합니다.\x1b[0m`,
    );
  else
    die(
      `macOS 산출물이 "${SIGN_IDENTITY}" 로 서명되지 않았습니다.\n` +
        '  이대로 배포하면 다음 버전에서 받는 사람의 저장된 계정이 전부 사라집니다.\n' +
        `  인증서 확인: security find-identity -v -p codesigning | grep "${SIGN_IDENTITY}"\n` +
        '  그래도 강행하려면 --allow-unsigned 를 붙이세요.',
    );
}

// ── 4. 산출물 수집 ──
/** out/make 아래를 재귀로 훑어 이번 버전 zip 만 고른다 (플랫폼별 경로가 arch 에 따라 달라진다) */
const collectZips = (dir) => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectZips(full);
    return entry.name.endsWith(`-${version}.zip`) ? [full] : [];
  });
};

const zips = collectZips(OUT_MAKE);
if (zips.length === 0)
  die(
    `업로드할 산출물이 없습니다 (out/make 에서 *-${version}.zip 을 찾지 못했습니다).` +
      (skipBuild ? ' --skip-build 없이 다시 실행하세요.' : ''),
  );

const mb = (file) => (fs.statSync(file).size / 1024 / 1024).toFixed(0);
for (const zip of zips) done(`${path.basename(zip)} (${mb(zip)}MB)`);

// 두 플랫폼이 다 나왔는지 — 하나만 올리면 그 OS 팀원이 못 받는다
for (const [label, needle] of [
  ['Windows', 'win32'],
  ['macOS', 'darwin'],
])
  if (!zips.some((z) => path.basename(z).includes(needle)))
    console.warn(
      `\x1b[33m⚠ ${label} 산출물이 없습니다 — 그 OS 팀원은 받을 수 없습니다.\x1b[0m`,
    );

// ── 5. 릴리스 본문 ──
const winZip = zips.find((z) => z.includes('win32'));
const macZip = zips.find((z) => z.includes('darwin'));
const body = [
  notes && `${notes}\n`,
  section && `${section}\n`,
  '### 받을 파일',
  winZip && `- **Windows** — \`${path.basename(winZip)}\``,
  macZip && `- **Mac (M1 이상)** — \`${path.basename(macZip)}\``,
  '',
  `설치·사용법은 [README](https://github.com/${REPO}#readme), 전체 변경 이력은 [CHANGELOG](https://github.com/${REPO}/blob/main/CHANGELOG.md) 를 보세요.`,
  '쓰던 분은 앱 상단의 **[지금 업데이트]** 로 받으면 됩니다 — 설정과 계정은 그대로 유지됩니다.',
]
  .filter(Boolean)
  .join('\n');

if (dryRun) {
  console.log('\n\x1b[33m— dry-run: 여기서 멈춥니다 —\x1b[0m');
  console.log(`올릴 곳: ${REPO} / ${tag}\n`);
  console.log(body);
  console.log(
    `\n실제로 올리려면: \x1b[1mnpm run release -- --skip-build${notes ? ` --notes="${notes}"` : ''}\x1b[0m`,
  );
  process.exit(0);
}

// ── 6. 릴리스 생성 + 업로드 ──
log(`${REPO} 에 ${tag} 릴리스 생성…`);
try {
  execFileSync(
    'gh',
    [
      'release',
      'create',
      tag,
      '--repo',
      REPO,
      '--title',
      `One App Lite ${tag}`,
      '--notes',
      body,
      ...zips,
    ],
    { stdio: 'inherit' },
  );
} catch {
  die('릴리스 업로드 실패 — 위 출력을 확인하세요. (산출물은 out/make 에 그대로 있습니다)');
}

// ── 7. CHANGELOG.md 를 배포 리포에도 올린다 (팀원이 전체 이력을 볼 수 있게) — 실패해도 배포는 끝났다
if (changelog) {
  try {
    let sha;
    try {
      sha = execFileSync('gh', ['api', `repos/${REPO}/contents/CHANGELOG.md`, '--jq', '.sha'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      sha = undefined; // 아직 없는 파일 — 새로 만든다
    }
    execFileSync(
      'gh',
      [
        'api',
        '--method',
        'PUT',
        `repos/${REPO}/contents/CHANGELOG.md`,
        '-f',
        `message=docs: 변경 이력 ${tag}`,
        '-f',
        // 빈 Unreleased 헤더는 빼고 올린다 — 읽는 사람에겐 배포된 버전만 의미가 있다
        `content=${Buffer.from(withoutEmptyUnreleased(changelog), 'utf8').toString('base64')}`,
        ...(sha ? ['-f', `sha=${sha}`] : []),
      ],
      { stdio: 'ignore' },
    );
    done('CHANGELOG.md 를 배포 리포에 올렸습니다');
  } catch {
    console.warn('\x1b[33m⚠ CHANGELOG.md 업로드 실패 — 릴리스는 올라갔습니다. 나중에 수동으로 올리세요.\x1b[0m');
  }
}

const url = `https://github.com/${REPO}/releases/latest`;
try {
  execSync('pbcopy', { input: url }); // 공지에 바로 붙여넣을 수 있게
} catch {
  // 클립보드는 부가 기능이라 실패해도 넘어간다
}

console.log(`\n\x1b[32m✓ 배포 완료 — ${tag}\x1b[0m`);
console.log(`  팀원 공유 링크 (클립보드에 복사됨): \x1b[1m${url}\x1b[0m`);
console.log(
  `  package.json(${version})·CHANGELOG.md 를 \x1b[1m/commit\x1b[0m 으로 커밋하세요.`,
);
