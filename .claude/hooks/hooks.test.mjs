// 가드 훅 판정 케이스 — 우회(막아야 하는데 통과)와 오탐(통과해야 하는데 막힘)을 고정한다.
// 새 구멍이나 오탐을 발견하면 여기에 한 줄 추가하고 고친다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { decide as buildGuard } from './require-build-skill.mjs';
import { decide as commitGuard } from './require-commit-skill.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hook-test-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

/** 현재 턴 = 사용자 발화 하나 (+ 선택적으로 스킬 호출) 인 transcript 를 만든다 */
function transcript(userText, skill) {
  const lines = [
    { type: 'assistant', message: { content: [{ type: 'text', text: '이전 응답' }] } },
    { type: 'user', message: { content: userText } },
  ];
  if (skill) {
    lines.push({
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'Skill', input: { skill } }] },
    });
  }
  const file = path.join(dir, `${Math.random().toString(36).slice(2)}.jsonl`);
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return file;
}

const run = (guard, command, { user = '아무 요청', skill } = {}) =>
  guard({
    tool_name: 'Bash',
    tool_input: { command },
    transcript_path: transcript(user, skill),
  });

describe('빌드·배포 가드', () => {
  it.each([
    'npm run make',
    'npm run package',
    'yarn make',
    'npx electron-forge make',
    'cd standalone/lite && npm run release',
    // 2026-09-29 우회 실측 — 전역 옵션이 run 앞에 끼는 형태
    'npm --prefix standalone/lite run release',
    'npm --prefix=standalone/lite run make',
    'pnpm -C standalone/lite run make',
    // 따옴표 안이지만 셸이 실행하는 명령
    'bash -c "npm run make"',
    "zsh -lc 'cd standalone/lite && npm run release'",
    'rm -rf "/Applications/One App.app"',
  ])('막는다: %s', (command) => {
    expect(run(buildGuard, command)).toBeTruthy();
  });

  it.each([
    'npm start',
    'npm test',
    'npm run lint',
    'npm --prefix standalone/lite run typecheck',
    'grep -n "npm run release" standalone/lite/scripts/release.mjs',
    'git commit -m "npm run make 설명"',
    'echo "bash -c \'npm run make\' 는 막힌다"',
    'codesign -dv "/Applications/One App.app"',
  ])('통과시킨다: %s', (command) => {
    expect(run(buildGuard, command)).toBeNull();
  });

  it('스킬을 쓴 턴이면 통과시킨다', () => {
    expect(run(buildGuard, 'npm run make', { skill: 'build' })).toBeNull();
    expect(run(buildGuard, 'npm --prefix standalone/lite run release', { skill: 'release' })).toBeNull();
    // 배포는 /build 로는 안 된다
    expect(run(buildGuard, 'npm run release', { skill: 'build' })).toBeTruthy();
  });
});

describe('커밋·푸시 가드', () => {
  it.each([
    'git commit -m "x"',
    'git -C . commit -m x',
    'git -c user.name=x commit',
    'bash -c "git commit -m x"',
    'cd sub && git commit -am x',
  ])('커밋을 막는다: %s', (command) => {
    expect(run(commitGuard, command)).toBeTruthy();
  });

  it.each([
    // 2026-09-29 오탐 실측 — 따옴표 안에 적기만 한 경우
    "for c in 'x git commit y'; do :; done",
    'node -e "console.log(\'git commit\')"',
    'git log --grep "commit"',
    'grep -rn "git commit" .claude',
  ])('언급만 한 것은 통과시킨다: %s', (command) => {
    expect(run(commitGuard, command)).toBeNull();
  });

  it('/commit 스킬을 쓴 턴이면 커밋을 통과시킨다', () => {
    expect(run(commitGuard, 'git commit -m x', { skill: 'commit' })).toBeNull();
  });

  it('푸시는 이번 턴에 요청했을 때만', () => {
    expect(run(commitGuard, 'git push', { user: '푸시해줘' })).toBeNull();
    expect(run(commitGuard, 'git push', { user: '정리만 해줘' })).toBeTruthy();
    expect(run(commitGuard, 'git push', { user: '커밋만 하고 푸시하지 마' })).toBeTruthy();
    expect(run(commitGuard, 'git push', { user: "don't push yet" })).toBeTruthy();
  });
});
