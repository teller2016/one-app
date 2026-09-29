#!/usr/bin/env node
/**
 * PreToolUse(Bash) 가드 — 커밋·푸시를 규칙대로만 하게 강제한다.
 *
 *  - `git commit` : 이번 사용자 턴에서 `/commit` 스킬이 호출됐을 때만 허용.
 *  - `git push`   : 이번 사용자 턴에서 사용자가 푸시를 명시했을 때만 허용.
 *
 * 판정 근거는 transcript(JSONL) — 조회는 `lib/transcript.mjs`, 판정 케이스는 `hooks.test.mjs`. 훅 입력 JSON 의 `transcript_path` 를 읽어
 * "마지막 assistant 응답 이후의 사용자 발화" 부터 현재까지를 한 턴으로 보고,
 * 그 구간에 스킬 호출 흔적(`Skill(commit)` 또는 `/commit`)이 있는지 확인한다.
 *
 * 탈출구: 명령 앞에 `SKIP_COMMIT_GUARD=1` 을 붙이면 검사를 건너뛴다.
 * 오류가 나면 항상 통과시킨다(fail-open) — 훅 문제로 작업이 막히지 않게.
 */

import { activeSegments, harmlessMatcher, stripQuoted } from './lib/command.mjs';
import { isUserText, loadCurrentTurn, plainText, runGuardIfMain, usedSkill } from './lib/transcript.mjs';

/** git 전역 플래그 중 뒤에 값 토큰을 하나 더 받는 것들 */
const VALUE_FLAGS = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--exec-path',
  '--super-prefix',
]);

const COMMIT_SUBCOMMANDS = new Set(['commit', 'ci']);
const PUSH_SUBCOMMANDS = new Set(['push']);

/** 사용자 발화에서 "푸시해라" 의도로 볼 표현 */
const PUSH_INTENT = /푸시|푸쉬|push/i;

/**
 * 셸 명령에서 실행되는 git 서브커맨드들을 뽑아낸다.
 *
 * ⚠️ 조각 분리·따옴표·heredoc 처리는 **`lib/command.mjs` 공용 전처리**에 맡긴다 —
 *    직접 `split` 하면 heredoc 안에 적은 `git commit` 이나 커밋 메시지 속 문자열을
 *    실행되는 명령으로 오인한다(2026-09-03 실측).
 * ⚠️ 무해 목록에 `git` 을 넣지 않는다 — 여기서는 git 이 검사 대상이다.
 */
const HARMLESS_SEGMENT = harmlessMatcher();

function gitSubcommands(command) {
  const found = [];
  for (const segment of activeSegments(command, HARMLESS_SEGMENT)) {
    // 따옴표 안은 인자(커밋 메시지·for 목록 등)일 뿐이다 — `bash -c "…"` 는 activeSegments 가 이미 풀었다.
    // ⚠️ 비우지 않으면 `for c in 'x git commit'` 같은 언급만으로 차단된다(2026-09-29 실측).
    const tokens = stripQuoted(segment).trim().split(/\s+/).filter(Boolean);
    for (let i = 0; i < tokens.length; i++) {
      const bare = tokens[i].replace(/^['"]|['"]$/g, '');
      if (bare !== 'git' && !bare.endsWith('/git')) continue;

      // git 뒤의 전역 플래그(와 그 값)를 건너뛰고 첫 서브커맨드를 찾는다
      let j = i + 1;
      while (j < tokens.length) {
        const token = tokens[j];
        if (VALUE_FLAGS.has(token)) {
          j += 2;
          continue;
        }
        if (token.startsWith('-') || token.includes('=')) {
          j += 1;
          continue;
        }
        break;
      }
      if (j < tokens.length) found.push(tokens[j].replace(/^['"]|['"]$/g, '').toLowerCase());
      i = j;
    }
  }
  return found;
}

/**
 * 이 턴의 사용자 발화에 푸시 의도가 있는가.
 * "푸시하지 마"·"push 는 말고" 같은 **부정 표현은 지우고** 본다 — 안 그러면 금지 발화가 허용으로 읽힌다.
 */
const PUSH_NEGATION =
  /(?:푸시|푸쉬|push)\s*(?:는|은)?\s*(?:하지|말|금지|안\s*해|안\s*함|노노|ㄴㄴ)|(?:don'?t|do\s+not|no)\s+push/gi;

function userAskedForPush(turn) {
  return turn
    .filter(isUserText)
    .some((entry) => PUSH_INTENT.test(plainText(entry).replace(PUSH_NEGATION, '')));
}

/** 훅 입력을 판정한다 — 막아야 하면 거부 사유, 아니면 null */
export function decide(input) {
  if (input.tool_name !== 'Bash') return null;

  const command = String(input.tool_input?.command ?? '');
  if (!command) return null;
  if (/\bSKIP_COMMIT_GUARD=1\b/.test(command)) return null; // 수동 탈출구

  const subcommands = gitSubcommands(command);
  const wantsCommit = subcommands.some((sub) => COMMIT_SUBCOMMANDS.has(sub));
  const wantsPush = subcommands.some((sub) => PUSH_SUBCOMMANDS.has(sub));
  if (!wantsCommit && !wantsPush) return null;

  const turn = loadCurrentTurn(input.transcript_path);
  if (!turn) return null; // 판정 불가 → 통과

  if (wantsCommit && !usedSkill(turn, ['commit'])) {
    return (
      '이 프로젝트는 커밋을 /commit 스킬 경유로만 허용한다. ' +
      'Skill 도구로 `commit` 스킬을 먼저 호출하고, 그 절차(민감파일 점검 → tsc → git add -A → 한국어 conventional commit)를 따라 커밋할 것. ' +
      '사용자가 커밋을 요청하지 않았다면 커밋하지 말고 "커밋할까요?" 라고 묻기만 할 것.'
    );
  }

  if (wantsPush && !userAskedForPush(turn)) {
    return (
      '푸시는 사용자가 이번 턴에 명시적으로 요청했을 때만 허용한다. ' +
      '요청이 없었으므로 푸시하지 말고 사용자에게 푸시 여부를 물어볼 것.'
    );
  }
  return null;
}

runGuardIfMain(import.meta.url, decide);
