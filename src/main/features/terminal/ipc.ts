import { app, ipcMain } from 'electron';
import type { TerminalCreateInput } from '../../../shared/types';
import { broadcast } from '../../lib/broadcast';
import {
  attachSession,
  createSession,
  killSession,
  listSessions,
  onPtyResized,
  onSessionsChanged,
  onTerminalData,
  onTerminalExit,
  resizeSession,
  writeSession,
} from './pty';
import {
  getServerStatus,
  onServerChanged,
  startServer,
  stopServer,
} from './server';
import { getServerEnabled, regenerateToken, setServerEnabled } from './store';

/** 터미널 관련 IPC 핸들러 등록 */
export function registerTerminalIpc() {
  ipcMain.handle('terminal:list', () => listSessions());
  ipcMain.handle('terminal:create', (_e, opts: TerminalCreateInput) =>
    createSession(opts ?? {})
  );
  ipcMain.handle('terminal:attach', (_e, id: string, cols: number, rows: number) =>
    attachSession(id, cols, rows)
  );
  ipcMain.handle('terminal:kill', (_e, id: string) => {
    killSession(id);
    return { ok: true };
  });

  // 키 입력·리사이즈는 fire-and-forget(send) — invoke 왕복 비용 제거
  ipcMain.on('terminal:write', (_e, id: string, data: string) =>
    writeSession(id, data)
  );
  ipcMain.on('terminal:resize', (_e, id: string, cols: number, rows: number) =>
    resizeSession(id, cols, rows)
  );

  // MO(모바일) 접속 서버 — 토글은 저장까지 겸한다 (앱 재시작 후에도 유지)
  ipcMain.handle('terminal:server:status', () => getServerStatus());
  ipcMain.handle('terminal:server:set', async (_e, enabled: boolean) => {
    setServerEnabled(enabled);
    if (enabled) return startServer();
    await stopServer();
    return getServerStatus();
  });
  ipcMain.handle('terminal:server:regen-token', () => {
    regenerateToken();
    return getServerStatus(); // 새 토큰이 반영된 URL 목록
  });

  // 세션 이벤트를 모든 창에 push (모바일 WS 는 server.ts 가 별도 구독)
  onTerminalData((id, data, seq) => broadcast('terminal:data', { id, data, seq }));
  onTerminalExit((id, exitCode) => broadcast('terminal:exit', { id, exitCode }));
  onSessionsChanged(() => broadcast('terminal:sessions'));
  onPtyResized((id, cols, rows) =>
    broadcast('terminal:resized', { id, cols, rows })
  );
  onServerChanged(() => broadcast('terminal:server:changed'));

  // 켜두고 종료했으면 자동 시작 — 자리 비움 시나리오상 재시작 후에도 MO 접속이 살아야 한다
  if (getServerEnabled()) {
    void app.whenReady().then(() => startServer());
  }
}
