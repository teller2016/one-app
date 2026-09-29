/**
 * 가드 훅 공용 — transcript(JSONL)에서 "현재 사용자 턴"을 잘라 스킬 호출 흔적을 찾는다.
 *
 * 쓰는 곳: `require-build-skill.mjs` · `require-commit-skill.mjs`
 * (예전엔 두 훅에 같은 코드가 복사돼 있었다 — 판정을 고치면 여기 한 곳만 고친다)
 */

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export function readTranscript(path) {
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
export function isUserText(entry) {
  if (entry?.type !== 'user' || entry.isSidechain || entry.isMeta) return false;
  const content = entry.message?.content;
  if (typeof content === 'string') return true;
  if (Array.isArray(content)) return content.every((block) => block?.type !== 'tool_result');
  return false;
}

/** 엔트리의 사람이 읽는 텍스트만 이어붙인다 */
export function plainText(entry) {
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
export function currentTurn(entries) {
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
export function usedSkill(turn, names) {
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
    // 사용자가 `/build` 처럼 직접 입력한 경우 (주입된 스킬 본문은 제외)
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

/** transcript 경로에서 현재 턴을 읽는다 — 판정 불가(경로 없음)면 null */
export function loadCurrentTurn(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return null;
  return currentTurn(readTranscript(transcriptPath));
}

/**
 * 훅 진입점 공통 — 직접 실행됐을 때만 stdin JSON 을 `decide` 에 넘기고, 거부 사유가 오면 deny 로 출력한다.
 * 테스트가 훅 파일을 import 할 때는 아무것도 하지 않는다.
 * ⚠️ 경로 비교는 realpath 로 — 경로에 심볼릭 링크가 끼면 문자열 비교가 어긋나 **가드가 소리 없이 꺼진다**.
 */
export function runGuardIfMain(moduleUrl, decide) {
  try {
    if (!process.argv[1]) return;
    if (fs.realpathSync(fileURLToPath(moduleUrl)) !== fs.realpathSync(process.argv[1])) return;
    const input = JSON.parse(fs.readFileSync(0, 'utf8'));
    const reason = decide(input);
    if (!reason) return;
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: reason,
        },
      }),
    );
  } catch {
    // fail-open: 가드가 오작동해도 작업을 막지 않는다
  }
}
