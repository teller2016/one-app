#!/usr/bin/env node
/**
 * PreToolUse(Bash) 가드 — 빌드·설치본 교체를 규칙대로만 하게 강제한다.
 *
 * CLAUDE.md 규칙: **빌드는 사용자가 명시적으로 요청했을 때만** 한다.
 * 빌드는 `/Applications` 설치본을 교체하고, 서명이 빠지면 safeStorage 로 저장한
 * 계정이 전부 날아간다. "확인이 급해서" 같은 이유로 임의 실행하면 안 된다.
 *
 *  - `npm run package` / `npm run make` (yarn·pnpm·`--prefix` 등 전역 옵션·`bash -c` 포함), `electron-forge package|make`
 *  - `/Applications/One App.app` 을 rm·cp·mv·ditto 로 건드리는 명령(설치본 교체)
 *  → 이번 사용자 턴에서 `/build` 스킬이 호출됐을 때만 허용.
 *
 * 단독 배포판(One App Lite)의 `npm run release` 도 같은 방식으로 막는다 — 빌드에 더해
 * **GitHub public 릴리스 업로드**까지 하므로 되돌리기가 더 어렵다. `/release` 스킬 경유만 허용.
 *
 * ⚠️ 읽기 전용 확인(codesign -dv·--verify, defaults read)은 막지 않는다 —
 *    빌드 결과를 검증하는 정상 경로다.
 *
 * ⚠️ **판정은 "실행되는 조각의 첫 단어"로 한다** — 명령 문자열에 패턴이 들어 있다고 막지 않는다.
 *    그렇게 했더니 릴리스 스크립트를 `grep` 하거나 커밋 메시지에 명령을 적기만 해도 차단됐다
 *    (2026-09-03 실측 2건). `activeSegments`(`bash -c` 는 풀어서) → `stripQuoted` 순으로 걸러낸다.
 *
 * 판정 방식은 `require-commit-skill.mjs` 와 같다 — transcript 의 현재 턴 조회는 `lib/transcript.mjs`,
 * 명령 조각 분리는 `lib/command.mjs` 가 맡는다. 판정 케이스는 `hooks.test.mjs`(루트 `npm test`)에 있다.
 *
 * 탈출구: 명령 앞에 `SKIP_BUILD_GUARD=1` 을 붙이면 검사를 건너뛴다.
 * 오류가 나면 항상 통과시킨다(fail-open) — 훅 문제로 작업이 막히지 않게.
 */

import { activeSegments, harmlessMatcher, stripQuoted } from './lib/command.mjs';
import { loadCurrentTurn, runGuardIfMain, usedSkill } from './lib/transcript.mjs';

/** 빌드 스크립트 — 산출물을 만드는 것만. `npm test`·`npm start` 는 대상이 아니다 */
const BUILD_SCRIPTS = new Set(['package', 'make']);
/** 단독 배포판 배포 — 빌드 + GitHub public 릴리스 업로드 (`/release` 스킬 경유만) */
const RELEASE_SCRIPTS = new Set(['release']);

const BUILD_COMMANDS = [/\belectron-forge\s+(?:package|make)\b/];
const RELEASE_COMMANDS = [/\bscripts\/release\.mjs\b/];

/**
 * 패키지 매니저 전역 옵션 중 뒤에 값 토큰을 하나 더 받는 것들.
 * ⚠️ `npm --prefix standalone/lite run release` 처럼 옵션이 `run` 앞에 끼면 예전 정규식
 *    (`npm\s+run\s+release`)이 놓쳤다(2026-09-29 실측) — 그래서 토큰 단위로 건너뛴다.
 */
const PM_VALUE_FLAGS = new Set([
  '--prefix',
  '-C',
  '--dir',
  '--cwd',
  '-w',
  '--workspace',
  '-F',
  '--filter',
  '--userconfig',
]);
const PACKAGE_MANAGER = /^(?:\S*\/)?(?:npm|yarn|pnpm)$/;

/** 조각에서 패키지 매니저로 실행하는 스크립트 이름들을 뽑는다 (`npm [옵션] run [옵션] <이름>`) */
function packageScripts(segment) {
  const names = [];
  const tokens = segment.split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    if (!PACKAGE_MANAGER.test(tokens[i])) continue;
    let j = i + 1;
    const skipOptions = () => {
      while (j < tokens.length && tokens[j].startsWith('-')) {
        j += PM_VALUE_FLAGS.has(tokens[j]) ? 2 : 1;
      }
    };
    skipOptions();
    if (tokens[j] === 'run' || tokens[j] === 'run-script') {
      j += 1;
      skipOptions();
    }
    if (j < tokens.length) names.push(tokens[j]);
    i = j;
  }
  return names;
}

/**
 * 검사 대상이 아닌 조각 — 읽기 전용 도구(공용 목록)에 이 가드만의 두 가지를 더한다.
 *  - `git` : 커밋·로그·diff 어느 것도 산출물을 만들지 않는다 (커밋 가드가 따로 본다)
 *  - `node --check` : 문법 검사일 뿐 실행이 아니다 (codesign `-dv` 를 막지 않는 것과 같은 원칙)
 */
const HARMLESS_SEGMENT = harmlessMatcher(['git', 'node\\s+(?:--check|-c)']);

/**
 * 설치본 교체 — `/Applications/One App.app` 을 **바꾸는** 동사만 본다.
 * 경로 표기가 여러 가지라(따옴표·백슬래시 이스케이프) 느슨하게 맞춘다.
 */
const APP_PATH = String.raw`\/Applications\/One[\\ _]*App\.app`;
const APP_MUTATE = new RegExp(
  String.raw`\b(?:rm|mv|cp|ditto|rsync|unzip|tar)\b[^\n;|&]*` + APP_PATH,
);

/** 훅 입력을 판정한다 — 막아야 하면 거부 사유, 아니면 null */
export function decide(input) {
  if (input.tool_name !== 'Bash') return null;

  const command = String(input.tool_input?.command ?? '');
  if (!command) return null;
  if (/\bSKIP_BUILD_GUARD=1\b/.test(command)) return null; // 수동 탈출구

  // 실제로 실행되는 조각만 남긴다 — 읽기 전용 도구와 git 은 뺀다
  const active = activeSegments(command, HARMLESS_SEGMENT);
  if (!active.length) return null;

  // 빌드·배포는 **실행되는 명령**만 본다 — 따옴표 안에 적힌 것은 인자일 뿐이다
  const execSegments = active.map(stripQuoted);
  const execTarget = execSegments.join('\n');
  const scripts = execSegments.flatMap(packageScripts);
  // ⚠️ 설치본 교체는 경로 인자를 봐야 하므로 따옴표를 **지우지 않는다**
  //    (`/Applications/One App.app` 은 공백 때문에 늘 따옴표로 감싼다 — 지우면 검사가 통째로 뚫린다).
  //    동사(rm·mv·cp·ditto…)로 이미 한정돼 있어 문자열 오탐 위험은 낮다.
  const pathTarget = active.join('\n');

  const wantsRelease =
    scripts.some((name) => RELEASE_SCRIPTS.has(name)) ||
    RELEASE_COMMANDS.some((re) => re.test(execTarget));
  const wantsBuild =
    scripts.some((name) => BUILD_SCRIPTS.has(name)) ||
    BUILD_COMMANDS.some((re) => re.test(execTarget));
  const wantsReplace = APP_MUTATE.test(pathTarget);
  if (!wantsBuild && !wantsRelease && !wantsReplace) return null;

  const turn = loadCurrentTurn(input.transcript_path);
  if (!turn) return null; // 판정 불가 → 통과

  // 배포는 `/release` 만. 빌드는 `/build` 와 `/release` 둘 다 허용한다(배포가 빌드를 포함한다).
  if (usedSkill(turn, wantsRelease ? ['release'] : ['build', 'release'])) return null;

  if (wantsRelease) {
    return (
      '단독 배포판(One App Lite)을 배포하는 명령이다. 이 프로젝트는 배포를 ' +
      '**사용자가 명시적으로 요청했을 때만**(/release 스킬 경유) 허용한다 — ' +
      'GitHub public 릴리스로 올라가면 팀원이 곧바로 받아 가므로 되돌리기 어렵다. ' +
      'Skill 도구로 `release` 스킬을 먼저 호출하고 그 절차(변경점 정리 → 버전 확인 → 승인)를 따를 것. ' +
      '사용자가 배포를 요청하지 않았다면 배포하지 말고 "배포할까요?" 라고 묻기만 할 것.'
    );
  }

  return (
    (wantsReplace && !wantsBuild
      ? '/Applications 설치본을 교체하는 명령이다. '
      : '빌드 명령이다. ') +
    '이 프로젝트는 빌드를 **사용자가 명시적으로 요청했을 때만**(/build 스킬 경유, 단독판 배포는 /release) 허용한다 — ' +
    '빌드는 /Applications 설치본을 교체하고 서명이 빠지면 저장된 계정이 날아간다. ' +
    '동작 확인이 필요하면 개발 인스턴스(npm start)에서 볼 것: 렌더러·SCSS 는 HMR 로 즉시, ' +
    'main/preload 변경은 npm start 재실행. ' +
    '사용자가 빌드를 요청하지 않았다면 빌드하지 말고 "빌드에 반영할까요?" 라고 묻기만 할 것.'
  );
}

runGuardIfMain(import.meta.url, decide);
