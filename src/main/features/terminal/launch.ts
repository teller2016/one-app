// 새 세션 실행 준비 — 명령 첫 낱말이 맨 claude·femc 면 환경설정의 기본 계정과 아는 femc 스택을 실어
// 셸 함수의 계정 선택(·femc 메뉴·스택 선택 창)을 건너뛴다. 규칙은 launchCommand.ts(순수 + 테스트).
// createSession 은 동기다(독 셸·루트처럼 바로 id 가 필요한 호출이 있다) — 사용자가 여는 새 세션 경로
// (데스크톱 [+]·프리셋 `terminal:create` · 폰 `create` · 루트 run_preset)가 이걸 먼저 거친다.
import os from 'node:os';
import type { TerminalCreateInput } from '../../../shared/types';
import { claudeAccountDir } from '../../lib/claudeAccount';
import { getProject } from '../projects/store';
import { agentCommand } from './agents';
import { femcStackFor } from './femcStack';
import { accountAgentOf, withClaudeAccount } from './launchCommand';
import { getClaudeAccount } from './store';

/** 계정을 실은 생성 입력 — 바꿀 명령이 아니거나 준비가 실패하면 받은 그대로(세션은 예전처럼 뜨고 셸 함수가 묻는다). 던지지 않는다 */
export async function withLaunchAccount(opts: TerminalCreateInput): Promise<TerminalCreateInput> {
  try {
    const raw = opts.command?.trim() || agentCommand(opts.agentId ?? 'shell');
    if (!raw) return opts;
    const agent = accountAgentOf(raw);
    if (!agent) return opts;
    const cwd = (opts.projectId ? getProject(opts.projectId)?.localPath : undefined) ?? opts.cwd ?? os.homedir();
    // 스택을 못 정해도 세션은 띄운다 — femc 가 선택 창으로 묻는다(예전과 같다)
    const stack = agent === 'femc' ? await femcStackFor(cwd).catch(() => null) : null;
    return { ...opts, command: withClaudeAccount(raw, { configDir: claudeAccountDir(getClaudeAccount()), stack }) };
  } catch (err) {
    console.error('[terminal] 새 세션 계정 준비 실패 — 원래 명령으로 띄운다:', err);
    return opts;
  }
}
