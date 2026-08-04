// 변경사항 IPC — 전 채널 handleShared: 등록 자체가 MO(폰) 화이트리스트 선언이다.
// ⚠️ 클라이언트는 경로를 직접 넘길 수 없다 — projectId(레지스트리)/sessionId(터미널 세션)만
// 받아 main 이 경로를 해석한다 (폰에 열리는 채널이라 임의 디렉터리에서 git 이 돌면 안 됨).
import type { ChangesDiffFile, ChangesTarget } from '../../../shared/types';
import { handleShared } from '../../lib/moIpc';
import { getProject } from '../projects/store';
import { listSessions } from '../terminal/pty';
import { getChangesDiff, getChangesStatus, pushChanges } from './git';

function resolveTarget(target: ChangesTarget | undefined): string {
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
  handleShared('changes:status', (target: ChangesTarget) =>
    getChangesStatus(resolveTarget(target))
  );
  handleShared('changes:diff', (target: ChangesTarget, file: ChangesDiffFile) =>
    getChangesDiff(resolveTarget(target), file)
  );
  handleShared('changes:push', (target: ChangesTarget) =>
    pushChanges(resolveTarget(target))
  );
}
