// 세션 안 명령 읽기 테스트 — processes.ts 의 순수 함수만 다룬다.
import { describe, expect, it } from 'vitest';
import { foregroundCommands, parsePs } from './processes';

// pane 셸 100 아래: 프리셋(zsh -ic → npm → node) / 다른 pane 200: 셸만 / 300: claude
const PS = `
  100     1 /bin/zsh -ic trap 'true' INT; npm run dev; exec /bin/zsh -il
  101   100 npm run dev
  102   101 node /Users/me/app/node_modules/.bin/vite
  200     1 -zsh
  300     1 /bin/zsh -ic trap 'true' INT; CLAUDE_CONFIG_DIR=/Users/me/.claude command claude; exec /bin/zsh -il
  301   300 claude --dangerously-skip-permissions
  400     1 -zsh
  401   400 /bin/zsh -il
  402   401 pnpm dev
`;

describe('foregroundCommands', () => {
  const rows = parsePs(PS);

  it('셸 바로 아래의 명령만 — 그 명령의 자식(node vite)은 싣지 않는다', () => {
    expect(foregroundCommands(rows, 100)).toEqual(['npm run dev']);
  });

  it('셸만 있으면 빈 배열', () => {
    expect(foregroundCommands(rows, 200)).toEqual([]);
  });

  it('claude 탭은 claude 실행 인자', () => {
    expect(foregroundCommands(rows, 300)).toEqual(['claude --dangerously-skip-permissions']);
  });

  it('셸 안의 셸은 건너뛰고 내려간다', () => {
    expect(foregroundCommands(rows, 400)).toEqual(['pnpm dev']);
  });

  it('긴 인자는 자른다', () => {
    const long = parsePs(`  1 0 -zsh\n  2 1 node ${'x'.repeat(300)}`);
    expect(foregroundCommands(long, 1)[0].length).toBeLessThanOrEqual(161);
  });
});
