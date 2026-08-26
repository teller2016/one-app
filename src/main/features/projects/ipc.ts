import { dialog, ipcMain } from 'electron';
import type { SaveProjectInput } from '../../../shared/types';
import { handleShared } from '../../lib/moIpc';
import { deleteProject, listProjects, saveProject } from './store';

/** 프로젝트 레지스트리 IPC 핸들러 등록 */
export function registerProjectsIpc() {
  // 조회만 MO 공유 (PR 의 '빠른 PR' 이 프로젝트 목록을 참조한다)
  handleShared('projects:get', () => listProjects());
  // ⚠️ 쓰기는 MO 에 열지 않는다 — 프로젝트 등록/삭제는 로컬 경로를 다루는 데스크톱 전용
  // 작업이고(경로 선택 다이얼로그가 맥에만 뜬다), 폰 화면에는 편집 진입점이 없다.
  ipcMain.handle('projects:save', (_e, input: SaveProjectInput) =>
    saveProject(input),
  );
  ipcMain.handle('projects:delete', (_e, id: string) => deleteProject(id));

  // 로컬 경로 폴더 선택 다이얼로그 — **맥에 네이티브 창이 뜨므로 MO 에 열지 않는다**
  // (폰에서 호출하면 맥에만 모달이 떠서 폰은 영원히 대기한다)
  ipcMain.handle('projects:pick-dir', async (): Promise<{ path?: string }> => {
    const res = await dialog.showOpenDialog({
      title: '프로젝트 로컬 경로 선택',
      properties: ['openDirectory'],
    });
    return { path: res.canceled ? undefined : res.filePaths[0] };
  });
}
