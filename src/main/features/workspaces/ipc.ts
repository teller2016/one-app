// 터미널 워크스페이스 IPC — 전 채널 데스크톱 전용(ipcMain.handle, MO 비노출).
// 폴더 선택 다이얼로그가 끼고(맥에만 뜸), 워크트리 생성·제거는 임의 경로 인자를
// 받으므로 폰에 열지 않는다 — 폰이 쓰는 것은 changes:* (workspaceId 로만 지정) 뿐.
import { dialog, ipcMain, shell } from 'electron';
import type {
  TerminalPreset,
  WorkspaceSaveInput,
  WorktreeAddInput,
} from '../../../shared/types';
import { EDITOR_NAME, findEditorApp, openWithApp } from './editor';
import {
  addWorktree,
  listBranches,
  listWorktrees,
  listWorktreesBrief,
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

  // 폴더 존재 검사는 store(saveWorkspace)가 한다 — git 저장소가 아니어도 등록된다
  // (일반 폴더는 git.ts 가 단일 항목으로 합성해 LNB 에 폴더 행 하나로 보인다)
  ipcMain.handle('workspaces:save', (_e, input: WorkspaceSaveInput) => saveWorkspace(input));

  ipcMain.handle('workspaces:delete', (_e, id: string) => deleteWorkspace(id));

  // LNB 드래그 순서 변경 — id 배열 그대로 저장 순서가 된다
  ipcMain.handle('workspaces:reorder', (_e, ids: string[]) =>
    reorderWorkspaces(
      Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []
    )
  );

  // 워크스페이스 폴더를 Finder 로 열기 — 경로는 등록된 워크스페이스에서만 해석
  ipcMain.handle('workspaces:reveal', async (_e, id: string) => {
    const err = await shell.openPath(requireWorkspace(id).repoPath);
    return { ok: !err, error: err || undefined };
  });

  // IDE 설치 여부 — 렌더러가 탭바의 '열기' 버튼 노출을 이걸로 정한다
  ipcMain.handle('workspaces:editor-info', () => ({
    available: !!findEditorApp(),
    name: EDITOR_NAME,
  }));

  // 워크트리 폴더를 IDE 로 열기 — 제거와 같은 규칙으로 **git 의 워크트리 목록과
  // 대조한 뒤에만** 연다(렌더러가 넘긴 임의 경로를 그대로 실행하지 않는다)
  ipcMain.handle(
    'workspaces:open-editor',
    async (_e, id: string, worktreePath: string) => {
      const app = findEditorApp();
      if (!app) return { ok: false, error: `${EDITOR_NAME} 가 설치되어 있지 않습니다.` };
      const w = requireWorkspace(id);
      // 경로 대조만 하면 되므로 경량 조회 — 상세는 워크트리마다 status·diff 를 돌려
      // 버튼을 누른 뒤 IDE 가 뜨기까지 그만큼 늦어진다
      const list = await listWorktreesBrief(w.repoPath);
      if (!list.some((t) => t.path === worktreePath)) {
        throw new Error('이 워크스페이스의 워크트리가 아닙니다.');
      }
      return openWithApp(app, worktreePath);
    }
  );

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

  // detail=false 면 경량 조회(status·diff 생략) — LNB 가 접힌 워크스페이스에 쓴다.
  // 기본은 상세다: 인자를 안 주는 기존 호출부(MO 트리·워크트리 모달)는 그대로 동작한다.
  ipcMain.handle('workspaces:worktrees', (_e, id: string, detail?: boolean) => {
    const { repoPath } = requireWorkspace(id);
    return detail === false ? listWorktreesBrief(repoPath) : listWorktrees(repoPath);
  });

  ipcMain.handle('workspaces:worktree-add', (_e, input: WorktreeAddInput) =>
    addWorktree(requireWorkspace(input.workspaceId).repoPath, input)
  );

  // 주 워크트리·등록 안 된 경로 제거 방지 — git 의 워크트리 목록과 대조 후 실행
  ipcMain.handle(
    'workspaces:worktree-remove',
    async (_e, id: string, worktreePath: string, force?: boolean) => {
      const w = requireWorkspace(id);
      // 경로·isMain 만 보면 되므로 경량 조회 (dirty 는 호출부가 이미 확인해 force 로 넘긴다)
      const list = await listWorktreesBrief(w.repoPath);
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
