#!/usr/bin/env node
/**
 * PreToolUse(Bash) 가드 — 커밋·푸시를 규칙대로만 하게 강제한다.
 *
 *  - `git commit` : 이번 사용자 턴에서 `/commit` 스킬이 호출됐을 때만 허용.
 *  - `git push`   : 이번 사용자 턴에서 사용자가 푸시를 명시했을 때만 허용.
 *
 * 판정 근거는 transcript(JSONL). 훅 입력 JSON 의 `transcript_path` 를 읽어
 * "마지막 assistant 응답 이후의 사용자 발화" 부터 현재까지를 한 턴으로 보고,
 * 그 구간에 스킬 호출 흔적(`Skill(commit)` 또는 `/commit`)이 있는지 확인한다.
 *
 * 탈출구: 명령 앞에 `SKIP_COMMIT_GUARD=1` 을 붙이면 검사를 건너뛴다.
 * 오류가 나면 항상 통과시킨다(fail-open) — 훅 문제로 작업이 막히지 않게.
 */

import fs from 'node:fs';
import { activeSegments, harmlessMatcher } from './lib/command.mjs';

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
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
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

/** 이 턴에 /commit 스킬이 사용됐는가 */
function usedCommitSkill(turn) {
  for (const entry of turn) {
    const content = entry?.message?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block?.type !== 'tool_use' || block.name !== 'Skill') continue;
        const skill = String(block.input?.skill ?? '').toLowerCase();
        if (skill === 'commit' || skill.endsWith(':commit')) return true;
      }
    }
    // 사용자가 `/commit` 을 직접 입력한 경우 (주입된 스킬 본문은 제외)
    if (!entry?.isMeta && /<command-name>\/?commit<\/command-name>/.test(plainText(entry))) {
      return true;
    }
  }
  return false;
}

/** 이 턴의 사용자 발화에 푸시 의도가 있는가 */
function userAskedForPush(turn) {
  return turn.filter(isUserText).some((entry) => PUSH_INTENT.test(plainText(entry)));
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
  if (/\bSKIP_COMMIT_GUARD=1\b/.test(command)) return; // 수동 탈출구

  const subcommands = gitSubcommands(command);
  const wantsCommit = subcommands.some((sub) => COMMIT_SUBCOMMANDS.has(sub));
  const wantsPush = subcommands.some((sub) => PUSH_SUBCOMMANDS.has(sub));
  if (!wantsCommit && !wantsPush) return;

  if (!input.transcript_path || !fs.existsSync(input.transcript_path)) return; // 판정 불가 → 통과
  const turn = currentTurn(readTranscript(input.transcript_path));

  if (wantsCommit && !usedCommitSkill(turn)) {
    deny(
      '이 프로젝트는 커밋을 /commit 스킬 경유로만 허용한다. ' +
        'Skill 도구로 `commit` 스킬을 먼저 호출하고, 그 절차(민감파일 점검 → tsc → git add -A → 한국어 conventional commit)를 따라 커밋할 것. ' +
        '사용자가 커밋을 요청하지 않았다면 커밋하지 말고 "커밋할까요?" 라고 묻기만 할 것.',
    );
  }

  if (wantsPush && !userAskedForPush(turn)) {
    deny(
      '푸시는 사용자가 이번 턴에 명시적으로 요청했을 때만 허용한다. ' +
        '요청이 없었으므로 푸시하지 말고 사용자에게 푸시 여부를 물어볼 것.',
    );
  }
}

try {
  main();
} catch {
  // fail-open: 가드가 오작동해도 작업을 막지 않는다
}
