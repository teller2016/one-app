import { dialog, ipcMain } from 'electron';
import type { SaveProjectInput } from '../../../shared/types';
import { deleteProject, listProjects, saveProject } from './store';

/** 프로젝트 레지스트리 IPC 핸들러 등록 */
export function registerProjectsIpc() {
  ipcMain.handle('projects:get', () => listProjects());
  ipcMain.handle('projects:save', (_e, input: SaveProjectInput) =>
    saveProject(input),
  );
  ipcMain.handle('projects:delete', (_e, id: string) => deleteProject(id));

  // 로컬 경로 폴더 선택 다이얼로그
  ipcMain.handle('projects:pick-dir', async (): Promise<{ path?: string }> => {
    const res = await dialog.showOpenDialog({
      title: '프로젝트 로컬 경로 선택',
      properties: ['openDirectory'],
    });
    return { path: res.canceled ? undefined : res.filePaths[0] };
  });
}
