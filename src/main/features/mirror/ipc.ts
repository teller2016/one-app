import { BrowserWindow, ipcMain } from 'electron';
import type { MirrorMode } from '../../../shared/types';
import {
  getMirrorStatus,
  onMirrorChanged,
  startMirror,
  stopMirror,
} from './scrcpy';

/** 미러링(scrcpy) 관련 IPC 핸들러 등록 */
export function registerMirrorIpc() {
  ipcMain.handle('mirror:status', () => getMirrorStatus());
  ipcMain.handle('mirror:start', (_e, mode: MirrorMode) => startMirror(mode));
  ipcMain.handle('mirror:stop', () => stopMirror());

  // 프로세스 시작/종료(미러 창 닫힘 포함)를 모든 창에 push — 위젯이 다시 조회
  onMirrorChanged(() => {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send('mirror:changed');
    }
  });
}
