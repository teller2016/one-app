// 새 세션 계정 싣기 규칙 테스트 — launchCommand.ts 의 순수 함수만 다룬다.
import { describe, expect, it } from 'vitest';
import { accountAgentOf, withClaudeAccount } from './launchCommand';

const DIR = '/Users/me/.claude';
const ENV = `CLAUDE_CONFIG_DIR='${DIR}'`;

describe('accountAgentOf', () => {
  it('첫 낱말이 맨 claude·femc 일 때만', () => {
    expect(accountAgentOf('claude')).toBe('claude');
    expect(accountAgentOf('  femc doctor')).toBe('femc');
    expect(accountAgentOf('command claude')).toBeNull();
    expect(accountAgentOf("CLAUDE_CONFIG_DIR='/x' command femc run")).toBeNull();
    expect(accountAgentOf('claudex')).toBeNull();
    expect(accountAgentOf('npm run dev')).toBeNull();
  });
});

describe('withClaudeAccount', () => {
  it('claude — 계정을 싣고 셸 함수처럼 권한 생략을 붙인다(이미 있으면 한 번만)', () => {
    expect(withClaudeAccount('claude', { configDir: DIR })).toBe(`${ENV} command claude --dangerously-skip-permissions`);
    expect(withClaudeAccount('claude --dangerously-skip-permissions', { configDir: DIR })).toBe(
      `${ENV} command claude --dangerously-skip-permissions`,
    );
    expect(withClaudeAccount('claude --model haiku', { configDir: DIR })).toBe(
      `${ENV} command claude --dangerously-skip-permissions --model haiku`,
    );
  });

  it('femc — 인자 없음·플래그 시작은 run 으로(메뉴를 건너뛴다) + 아는 스택', () => {
    expect(withClaudeAccount('femc', { configDir: DIR, stack: 'vue' })).toBe(`${ENV} command femc run --stack 'vue'`);
    expect(withClaudeAccount('femc', { configDir: DIR, stack: null })).toBe(`${ENV} command femc run`);
    expect(withClaudeAccount('femc --add-dir /tmp', { configDir: DIR, stack: 'react' })).toBe(
      `${ENV} command femc run --add-dir /tmp --stack 'react'`,
    );
  });

  it('femc — 명령에 스택이 있으면 덧붙이지 않는다 · 하위 명령은 그대로(스택도 안 붙인다)', () => {
    expect(withClaudeAccount('femc run --stack jsp', { configDir: DIR, stack: 'vue' })).toBe(`${ENV} command femc run --stack jsp`);
    expect(withClaudeAccount('femc doctor', { configDir: DIR, stack: 'vue' })).toBe(`${ENV} command femc doctor`);
  });

  it('바꿀 명령이 아니면 그대로', () => {
    for (const c of ['npm run dev', "CLAUDE_CONFIG_DIR='/x' command claude --resume abc", 'command femc run']) {
      expect(withClaudeAccount(c, { configDir: DIR, stack: 'vue' })).toBe(c);
    }
  });

  it('계정 경로의 공백·따옴표는 인용한다', () => {
    expect(withClaudeAccount('claude', { configDir: "/Users/me/my 'claude'" })).toBe(
      `CLAUDE_CONFIG_DIR='/Users/me/my '\\''claude'\\''' command claude --dangerously-skip-permissions`,
    );
  });
});
