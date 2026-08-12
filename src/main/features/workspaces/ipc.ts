// 터미널 워크스페이스 IPC — 전 채널 데스크톱 전용(ipcMain.handle, MO 비노출).
// 폴더 선택 다이얼로그가 끼고(맥에만 뜸), 워크트리 생성·제거는 임의 경로 인자를
// 받으므로 폰에 열지 않는다 — 폰이 쓰는 것은 changes:* (workspaceId 로만 지정) 뿐.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
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

// 워크트리를 IDE 로 여는 대상 — 앱 번들을 직접 찾는다(CLI 는 사용자가 PATH 에
// 설치했을 때만 있으므로 기대하지 않는다). 없으면 렌더러가 버튼 자체를 감춘다.
const EDITOR_NAME = 'Antigravity';
const EDITOR_APP = 'Antigravity IDE.app';

function findEditorApp(): string | null {
  for (const dir of ['/Applications', join(homedir(), 'Applications')]) {
    const p = join(dir, EDITOR_APP);
    if (existsSync(p)) return p;
  }
  return null;
}

/** `open -a <앱> <폴더>` — VS Code 계열은 폴더를 창으로 연다 */
function openWithApp(app: string, dir: string) {
  return new Promise<{ ok: boolean; error?: string }>((resolve) => {
    execFile('open', ['-a', app, dir], (err) =>
      resolve({ ok: !err, error: err?.message })
    );
  });
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
      const list = await listWorktrees(w.repoPath);
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
