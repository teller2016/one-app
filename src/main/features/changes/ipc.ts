// 변경사항 IPC — 전 채널 handleShared: 등록 자체가 MO(폰) 화이트리스트 선언이다.
// ⚠️ 클라이언트는 경로를 직접 넘길 수 없다 — projectId(레지스트리)/sessionId(터미널 세션)/
// workspaceId+worktreePath(터미널 워크스페이스)만 받아 main 이 경로를 해석한다.
// worktreePath 는 git 의 실제 워크트리 목록과 대조해 임의 경로를 차단한다.
import type {
  ChangesDiffFile,
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
  pushChanges,
} from './git';

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
  handleShared('changes:status', async (target: ChangesTarget) =>
    getChangesStatus(await resolveTarget(target))
  );
  handleShared('changes:diff', async (target: ChangesTarget, file: ChangesDiffFile) =>
    getChangesDiff(await resolveTarget(target), file)
  );
  handleShared('changes:commit', async (target: ChangesTarget, message: string) =>
    commitChanges(await resolveTarget(target), String(message ?? ''))
  );
  handleShared('changes:push', async (target: ChangesTarget) =>
    pushChanges(await resolveTarget(target))
  );
}
