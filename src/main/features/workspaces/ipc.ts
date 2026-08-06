// 터미널 워크스페이스 IPC — 전 채널 데스크톱 전용(ipcMain.handle, MO 비노출).
// 폴더 선택 다이얼로그가 끼고(맥에만 뜸), 워크트리 생성·제거는 임의 경로 인자를
// 받으므로 폰에 열지 않는다 — 폰이 쓰는 것은 changes:* (workspaceId 로만 지정) 뿐.
import { dialog, ipcMain, shell } from 'electron';
import type {
  TerminalPreset,
  WorkspaceSaveInput,
  WorktreeAddInput,
} from '../../../shared/types';
import { runGit } from '../../lib/git';
import {
  addWorktree,
  listBranches,
  listWorktrees,
  removeWorktree,
} from './git';
import {
  deleteWorkspace,
  getWorkspace,
  listPresets,
  listWorkspaces,
  reorderWorkspaces,
  savePresets,
  saveWorkspace,
} from './store';

function requireWorkspace(id: string) {
  const w = getWorkspace(id);
  if (!w) throw new Error('워크스페이스를 찾을 수 없습니다.');
  return w;
}

/** 터미널 워크스페이스 IPC 핸들러 등록 */
export function registerWorkspacesIpc() {
  ipcMain.handle('workspaces:list', () => listWorkspaces());

  // 등록 전에 실제 git 저장소인지 확인 — LNB 에 죽은 항목이 쌓이는 것을 막는다
  ipcMain.handle('workspaces:save', async (_e, input: WorkspaceSaveInput) => {
    const probe = await runGit(
      ['rev-parse', '--is-inside-work-tree'],
      input.repoPath.trim(),
      10_000
    );
    if (probe.code !== 0 || probe.stdout.trim() !== 'true') {
      throw new Error('git 저장소가 아닙니다 — 저장소 루트 폴더를 선택하세요.');
    }
    return saveWorkspace(input);
  });

  ipcMain.handle('workspaces:delete', (_e, id: string) => deleteWorkspace(id));

  // LNB 드래그 순서 변경 — id 배열 그대로 저장 순서가 된다
  ipcMain.handle('workspaces:reorder', (_e, ids: string[]) =>
    reorderWorkspaces(
      Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []
    )
  );

  // 저장소 폴더를 Finder 로 열기 — 경로는 등록된 워크스페이스에서만 해석
  ipcMain.handle('workspaces:reveal', async (_e, id: string) => {
    const err = await shell.openPath(requireWorkspace(id).repoPath);
    return { ok: !err, error: err || undefined };
  });

  // 폴더 선택 다이얼로그 — 워크스페이스 등록·워크트리 위치 선택이 공용으로 쓴다
  ipcMain.handle(
    'workspaces:pick-dir',
    async (_e, title?: string): Promise<{ path?: string }> => {
      const res = await dialog.showOpenDialog({
        title: title || '폴더 선택',
        properties: ['openDirectory', 'createDirectory'],
      });
      return { path: res.canceled ? undefined : res.filePaths[0] };
    }
  );

  ipcMain.handle('workspaces:worktrees', (_e, id: string) =>
    listWorktrees(requireWorkspace(id).repoPath)
  );

  ipcMain.handle('workspaces:worktree-add', (_e, input: WorktreeAddInput) =>
    addWorktree(requireWorkspace(input.workspaceId).repoPath, input)
  );

  // 주 워크트리·등록 안 된 경로 제거 방지 — git 의 워크트리 목록과 대조 후 실행
  ipcMain.handle(
    'workspaces:worktree-remove',
    async (_e, id: string, worktreePath: string, force?: boolean) => {
      const w = requireWorkspace(id);
      const list = await listWorktrees(w.repoPath);
      const target = list.find((t) => t.path === worktreePath);
      if (!target) throw new Error('이 워크스페이스의 워크트리가 아닙니다.');
      if (target.isMain) throw new Error('원본 저장소(주 워크트리)는 제거할 수 없습니다.');
      return removeWorktree(w.repoPath, worktreePath, !!force);
    }
  );

  ipcMain.handle('workspaces:branches', (_e, id: string) =>
    listBranches(requireWorkspace(id).repoPath)
  );

  // 프리셋 — 프리셋 바(⚙ 옆 칩) 목록. 편집 모달이 전체를 통째로 저장한다
  ipcMain.handle('workspaces:presets:get', () => listPresets());
  ipcMain.handle('workspaces:presets:save', (_e, presets: TerminalPreset[]) =>
    savePresets(Array.isArray(presets) ? presets : [])
  );
}
