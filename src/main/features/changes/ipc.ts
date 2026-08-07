// 변경사항 IPC — 전 채널 handleShared: 등록 자체가 MO(폰) 화이트리스트 선언이다.
// ⚠️ 클라이언트는 경로를 직접 넘길 수 없다 — projectId(레지스트리)/sessionId(터미널 세션)/
// workspaceId+worktreePath(터미널 워크스페이스)만 받아 main 이 경로를 해석한다.
// worktreePath 는 git 의 실제 워크트리 목록과 대조해 임의 경로를 차단한다.
import type {
  ChangesDiffFile,
  ChangesDiffScope,
  ChangesMode,
  ChangesTarget,
} from '../../../shared/types';
import { handleShared } from '../../lib/moIpc';
import { getProject } from '../projects/store';
import { listSessions } from '../terminal/pty';
import { getWorkspace } from '../workspaces/store';
import { worktreePaths } from '../workspaces/git';
import {
  commitChanges,
  getChangesDiff,
  getChangesStatus,
  getCommitFiles,
  getCommitLog,
  pushChanges,
} from './git';

// 커밋 해시 형식 — 폰에 열리는 채널이라 git 인자로 들어가는 값은 화이트리스트 검증 필수
const HASH_RE = /^[0-9a-f]{4,40}$/i;

/** diff scope 를 화이트리스트로 재구성 — 임의 문자열이 git 인자가 되지 않게 */
function sanitizeScope(scope: ChangesDiffScope | undefined): ChangesDiffScope | undefined {
  if (!scope || typeof scope !== 'object') return undefined;
  const out: ChangesDiffScope = {};
  if (scope.mode === 'branch') out.mode = 'branch';
  if (typeof scope.commit === 'string' && HASH_RE.test(scope.commit))
    out.commit = scope.commit;
  if (scope.full === true) out.full = true;
  return out.mode || out.commit || out.full ? out : undefined;
}

async function resolveTarget(target: ChangesTarget | undefined): Promise<string> {
  if (target?.workspaceId) {
    const w = getWorkspace(target.workspaceId);
    if (w) {
      if (!target.worktreePath) return w.repoPath;
      // 워크트리 경로 검증 — 등록된 저장소의 실제 워크트리만 허용 (MO 에 열리는 채널)
      const paths = await worktreePaths(w.repoPath);
      if (paths.includes(target.worktreePath)) return target.worktreePath;
      throw new Error('이 워크스페이스의 워크트리가 아닙니다.');
    }
  }
  if (target?.projectId) {
    const p = getProject(target.projectId);
    if (p) return p.localPath;
  }
  if (target?.sessionId) {
    const s = listSessions().find((s) => s.id === target.sessionId);
    if (s) return s.cwd;
  }
  throw new Error('대상 프로젝트를 찾을 수 없습니다.');
}

/** 변경사항 IPC 핸들러 등록 */
export function registerChangesIpc() {
  handleShared('changes:status', async (target: ChangesTarget, mode?: ChangesMode) =>
    getChangesStatus(await resolveTarget(target), mode === 'branch' ? 'branch' : 'work')
  );
  handleShared(
    'changes:diff',
    async (target: ChangesTarget, file: ChangesDiffFile, scope?: ChangesDiffScope) =>
      getChangesDiff(await resolveTarget(target), file, sanitizeScope(scope))
  );
  handleShared('changes:log', async (target: ChangesTarget) =>
    getCommitLog(await resolveTarget(target))
  );
  handleShared('changes:commit-files', async (target: ChangesTarget, hash: string) => {
    if (typeof hash !== 'string' || !HASH_RE.test(hash)) {
      return { ok: false, error: '잘못된 커밋 해시입니다.' };
    }
    return getCommitFiles(await resolveTarget(target), hash);
  });
  handleShared('changes:commit', async (target: ChangesTarget, message: string) =>
    commitChanges(await resolveTarget(target), String(message ?? ''))
  );
  handleShared('changes:push', async (target: ChangesTarget) =>
    pushChanges(await resolveTarget(target))
  );
}
