// 재부팅 복원 규칙 테스트 — resumeCommand.ts 의 순수 함수만 다룬다.
// 실행 인자 예시는 2026-10-06 실측(`ps -o args=`) 그대로다.
import { describe, expect, it } from 'vitest';
import type { PersistedResume } from './sessions-store';
import { detectLauncher, resumeCommand } from './resumeCommand';

const FEMC_ARGS =
  '/Users/me/.local/bin/claude --agent metacommerce-orchestrator' +
  ' --plugin-dir /Users/me/.femc/generations/g-0fb94b87-d3e3/stacks/vue/plugin' +
  ' --settings /Users/me/.femc/generations/g-0fb94b87-d3e3/stacks/vue/settings.json' +
  ' /dev SSB-9 티켓을 작업해줘 --add-dir /Users/me/Library/Application Support/One App/jira-work/SSB-9' +
  ' --tools Read,Write --dangerously-skip-permissions';

const base: PersistedResume = {
  launcher: 'claude',
  sessionId: '6f1c2a90-1111-2222-3333-444455556666',
  configDir: '/Users/me/.claude',
  cwd: '/Users/me/coding/app',
  file: '/Users/me/.claude/projects/-Users-me-coding-app/6f1c2a90-1111-2222-3333-444455556666.jsonl',
  skipPermissions: true,
};

describe('detectLauncher', () => {
  it('사용자 셸 함수로 띄운 claude — 권한 확인 생략 옵션을 잇는다', () => {
    expect(detectLauncher('claude --dangerously-skip-permissions --dangerously-skip-permissions')).toEqual({
      launcher: 'claude',
      skipPermissions: true,
    });
  });

  it('옵션 없이 띄운 claude', () => {
    expect(detectLauncher('/Users/me/.local/bin/claude')).toEqual({ launcher: 'claude', skipPermissions: false });
  });

  it('femc 가 띄운 claude — 플러그인 경로로 가리고 스택을 읽는다', () => {
    expect(detectLauncher(FEMC_ARGS)).toEqual({ launcher: 'femc', stack: 'vue' });
  });

  it('스택 경로가 없는 femc 세대 — 스택 없이 femc', () => {
    expect(detectLauncher('claude --plugin-dir /Users/me/.femc/plugin --settings /Users/me/.femc/settings.json')).toEqual({
      launcher: 'femc',
    });
  });

  it('프롬프트 본문에 .femc 경로가 섞여도 claude 로 본다 — 플래그 값 자리만 본다', () => {
    expect(detectLauncher('claude --dangerously-skip-permissions ~/.femc/generations 폴더 좀 봐줘').launcher).toBe(
      'claude'
    );
  });
});

describe('resumeCommand', () => {
  const same = { sessionCwd: base.cwd, hasTranscript: true };

  it('claude — 계정 선택 함수를 건너뛰고 그 대화를 바로 연다', () => {
    expect(resumeCommand(base, same)).toBe(
      "CLAUDE_CONFIG_DIR='/Users/me/.claude' command claude --dangerously-skip-permissions" +
        " --resume '6f1c2a90-1111-2222-3333-444455556666'"
    );
  });

  it('권한 확인을 켜 둔 claude 는 그대로 켜 둔다', () => {
    expect(resumeCommand({ ...base, skipPermissions: false }, same)).not.toContain('--dangerously-skip-permissions');
  });

  it('femc — 메뉴로 빠지지 않게 `femc run`, 스택 고정, 업데이트 확인 생략', () => {
    const r: PersistedResume = { ...base, launcher: 'femc', stack: 'vue', configDir: '/Users/me/.claude-team' };
    expect(resumeCommand(r, same)).toBe(
      "CLAUDE_CONFIG_DIR='/Users/me/.claude-team' FEMC_SKIP_UPDATE_CHECK=1 command femc run --stack 'vue'" +
        " --resume '6f1c2a90-1111-2222-3333-444455556666'"
    );
  });

  it('대화 파일이 없으면(메시지 전) 재개 없이 새로 띄운다', () => {
    const cmd = resumeCommand(base, { ...same, hasTranscript: false });
    expect(cmd).toBe("CLAUDE_CONFIG_DIR='/Users/me/.claude' command claude --dangerously-skip-permissions");
  });

  it('claude 를 다른 폴더에서 띄웠으면 그리로 옮겨서 재개한다', () => {
    const cmd = resumeCommand(base, { ...same, sessionCwd: '/Users/me' });
    expect(cmd.startsWith("cd '/Users/me/coding/app' && CLAUDE_CONFIG_DIR=")).toBe(true);
  });

  it('경로의 작은따옴표·공백이 셸에서 깨지지 않는다', () => {
    const cmd = resumeCommand({ ...base, cwd: "/Users/me/My App's" }, { ...same, sessionCwd: '/Users/me' });
    expect(cmd.startsWith("cd '/Users/me/My App'\\''s' && ")).toBe(true);
  });
});
