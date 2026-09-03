#!/usr/bin/env node
/**
 * PreToolUse(Bash) 가드 — 빌드·설치본 교체를 규칙대로만 하게 강제한다.
 *
 * CLAUDE.md 규칙: **빌드는 사용자가 명시적으로 요청했을 때만** 한다.
 * 빌드는 `/Applications` 설치본을 교체하고, 서명이 빠지면 safeStorage 로 저장한
 * 계정이 전부 날아간다. "확인이 급해서" 같은 이유로 임의 실행하면 안 된다.
 *
 *  - `npm run package` / `npm run make` (yarn·pnpm 포함), `electron-forge package|make`
 *  - `/Applications/One App.app` 을 rm·cp·mv·ditto 로 건드리는 명령(설치본 교체)
 *  → 이번 사용자 턴에서 `/build` 스킬이 호출됐을 때만 허용.
 *
 * 단독 배포판(One App Lite)의 `npm run release` 도 같은 방식으로 막는다 — 빌드에 더해
 * **GitHub public 릴리스 업로드**까지 하므로 되돌리기가 더 어렵다. `/release` 스킬 경유만 허용.
 *
 * ⚠️ 읽기 전용 확인(codesign -dv·--verify, defaults read)은 막지 않는다 —
 *    빌드 결과를 검증하는 정상 경로다.
 *
 * 판정 방식은 `require-commit-skill.mjs` 와 같다(transcript 의 현재 턴 조회).
 * **한쪽 판정 로직을 고치면 다른 쪽도 함께 볼 것.**
 *
 * 탈출구: 명령 앞에 `SKIP_BUILD_GUARD=1` 을 붙이면 검사를 건너뛴다.
 * 오류가 나면 항상 통과시킨다(fail-open) — 훅 문제로 작업이 막히지 않게.
 */

import fs from 'node:fs';

/** 빌드 명령 — 산출물을 만드는 것만. `npm test`·`npm start` 는 대상이 아니다 */
const BUILD_COMMANDS = [
  /\b(?:npm|yarn|pnpm)\s+(?:run\s+)?(?:package|make)\b/,
  /\belectron-forge\s+(?:package|make)\b/,
];

/** 단독 배포판 배포 — 빌드 + GitHub public 릴리스 업로드 (`/release` 스킬 경유만) */
const RELEASE_COMMANDS = [
  /\b(?:npm|yarn|pnpm)\s+(?:run\s+)?release\b/,
  /\bscripts\/release\.mjs\b/,
];

/**
 * 읽기 전용 검사는 막지 않는다 — `node --check scripts/release.mjs`(문법 검사)는 배포가 아니다.
 * (codesign 의 `-dv`·`--verify` 를 막지 않는 것과 같은 원칙)
 */
const READ_ONLY = /\bnode\s+(?:--check|-c)\b/;

/**
 * 설치본 교체 — `/Applications/One App.app` 을 **바꾸는** 동사만 본다.
 * 경로 표기가 여러 가지라(따옴표·백슬래시 이스케이프) 느슨하게 맞춘다.
 */
const APP_PATH = String.raw`\/Applications\/One[\\ _]*App\.app`;
const APP_MUTATE = new RegExp(
  String.raw`\b(?:rm|mv|cp|ditto|rsync|unzip|tar)\b[^\n;|&]*` + APP_PATH,
);

function readTranscript(path) {
  const entries = [];
  for (const line of fs.readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // 쓰는 중 잘린 마지막 줄 등은 무시
    }
  }
  return entries;
}

/**
 * 실제 사용자 입력인가.
 * ⚠️ `isMeta: true` 는 시스템 주입(스킬 본문·로컬 커맨드 caveat 등)이라 반드시 제외한다.
 *    포함하면 스킬 본문이 "새 사용자 턴"으로 잡혀 앞선 Skill 호출을 놓친다.
 */
function isUserText(entry) {
  if (entry?.type !== 'user' || entry.isSidechain || entry.isMeta) return false;
  const content = entry.message?.content;
  if (typeof content === 'string') return true;
  if (Array.isArray(content)) return content.every((block) => block?.type !== 'tool_result');
  return false;
}

/** 엔트리의 사람이 읽는 텍스트만 이어붙인다 */
function plainText(entry) {
  const content = entry?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((block) => block?.type === 'text')
      .map((block) => block.text ?? '')
      .join('\n');
  }
  return '';
}

/** 마지막 assistant 응답 이후의 사용자 발화부터 끝까지 = 현재 턴 */
function currentTurn(entries) {
  let anchor = entries.length - 1;
  while (anchor >= 0 && !isUserText(entries[anchor])) anchor--;
  if (anchor < 0) return entries;

  let start = anchor;
  for (let k = anchor - 1; k >= 0; k--) {
    if (entries[k]?.type === 'assistant') break;
    if (isUserText(entries[k])) start = k;
  }
  return entries.slice(start);
}

/** 이 턴에 허용 스킬(`names` 중 하나)이 사용됐는가 */
function usedSkill(turn, names) {
  for (const entry of turn) {
    const content = entry?.message?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block?.type !== 'tool_use' || block.name !== 'Skill') continue;
        const skill = String(block.input?.skill ?? '').toLowerCase();
        // 플러그인 스킬은 `plugin:build` 형태로 온다
        if (names.some((name) => skill === name || skill.endsWith(`:${name}`))) return true;
      }
    }
    // 사용자가 `/build` 를 직접 입력한 경우 (주입된 스킬 본문은 제외)
    if (
      !entry?.isMeta &&
      names.some((name) =>
        new RegExp(`<command-name>/?${name}</command-name>`).test(plainText(entry)),
      )
    ) {
      return true;
    }
  }
  return false;
}

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

function main() {
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  if (input.tool_name !== 'Bash') return;

  const command = String(input.tool_input?.command ?? '');
  if (!command) return;
  if (/\bSKIP_BUILD_GUARD=1\b/.test(command)) return; // 수동 탈출구

  const wantsRelease =
    !READ_ONLY.test(command) && RELEASE_COMMANDS.some((re) => re.test(command));
  const wantsBuild = BUILD_COMMANDS.some((re) => re.test(command));
  const wantsReplace = APP_MUTATE.test(command);
  if (!wantsBuild && !wantsRelease && !wantsReplace) return;

  if (!input.transcript_path || !fs.existsSync(input.transcript_path)) return; // 판정 불가 → 통과
  const turn = currentTurn(readTranscript(input.transcript_path));

  // 배포는 `/release` 만. 빌드는 `/build` 와 `/release` 둘 다 허용한다(배포가 빌드를 포함한다).
  if (usedSkill(turn, wantsRelease ? ['release'] : ['build', 'release'])) return;

  if (wantsRelease) {
    deny(
      '단독 배포판(One App Lite)을 배포하는 명령이다. 이 프로젝트는 배포를 ' +
        '**사용자가 명시적으로 요청했을 때만**(/release 스킬 경유) 허용한다 — ' +
        'GitHub public 릴리스로 올라가면 팀원이 곧바로 받아 가므로 되돌리기 어렵다. ' +
        'Skill 도구로 `release` 스킬을 먼저 호출하고 그 절차(변경점 정리 → 버전 확인 → 승인)를 따를 것. ' +
        '사용자가 배포를 요청하지 않았다면 배포하지 말고 "배포할까요?" 라고 묻기만 할 것.',
    );
  }

  deny(
    (wantsReplace && !wantsBuild
      ? '/Applications 설치본을 교체하는 명령이다. '
      : '빌드 명령이다. ') +
      '이 프로젝트는 빌드를 **사용자가 명시적으로 요청했을 때만**(/build 스킬 경유, 단독판 배포는 /release) 허용한다 — ' +
      '빌드는 /Applications 설치본을 교체하고 서명이 빠지면 저장된 계정이 날아간다. ' +
      '동작 확인이 필요하면 개발 인스턴스(npm start)에서 볼 것: 렌더러·SCSS 는 HMR 로 즉시, ' +
      'main/preload 변경은 npm start 재실행. ' +
      '사용자가 빌드를 요청하지 않았다면 빌드하지 말고 "빌드에 반영할까요?" 라고 묻기만 할 것.',
  );
}

try {
  main();
} catch {
  // fail-open: 가드가 오작동해도 작업을 막지 않는다
}
