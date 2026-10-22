// Claude 계정(프로필 폴더) — `~/.zshrc` 의 claude()·femc() 셸 함수가 실행 때마다 묻던 Personal/Team 선택을 앱이 대신 정할 때 쓴다.
// 그 함수는 고른 계정을 `CLAUDE_CONFIG_DIR` 로 넘길 뿐이라, 앱은 `command claude`·`command femc` 로 함수를 건너뛰고 같은 값을 직접 넘긴다.
// Jira [작업]·루트 세션의 femc 명령(jira/work.ts), 터미널 새 세션의 claude·femc(terminal/launch.ts)가 같은 폴더 규칙을 쓴다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { JiraWorkAccount, JiraWorkAccountInfo } from '../../shared/types';

/** 셸 함수의 선택지와 같은 폴더 — Personal 은 기존 로그인 그대로, Team 은 최초 1회 /login */
const ACCOUNT_DIRS: Record<JiraWorkAccount, string> = {
  personal: '.claude',
  team: '.claude-team',
};

export const claudeAccountDir = (account: JiraWorkAccount): string => path.join(os.homedir(), ACCOUNT_DIRS[account]);

/**
 * 고를 수 있는 Claude 계정 — 프로필 폴더가 있는 것만. 어느 계정인지 헷갈리지 않게
 * 그 안의 `.claude.json` 에서 로그인 이메일을 읽어 함께 준다(없으면 미로그인).
 */
export function listClaudeAccounts(): JiraWorkAccountInfo[] {
  const labels: Record<JiraWorkAccount, string> = { personal: 'Personal', team: 'Team' };
  const out: JiraWorkAccountInfo[] = [];
  for (const id of ['personal', 'team'] as JiraWorkAccount[]) {
    const dir = claudeAccountDir(id);
    if (!fs.existsSync(dir)) continue;
    let email: string | undefined;
    try {
      const raw = fs.readFileSync(path.join(dir, '.claude.json'), 'utf8');
      const parsed = JSON.parse(raw) as { oauthAccount?: { emailAddress?: string } };
      email = parsed.oauthAccount?.emailAddress;
    } catch {
      /* 미로그인·손상 — 라벨만 보여준다 */
    }
    out.push({ id, label: labels[id], dir, email });
  }
  return out;
}
