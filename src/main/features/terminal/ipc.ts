import { app, ipcMain, shell } from 'electron';
import type {
  TerminalCreateInput,
  TerminalNotifyLevel,
  TerminalSessionInfo,
} from '../../../shared/types';
import { TERMINAL_AGENT_NAMES } from '../../../shared/types';
import { broadcast } from '../../lib/broadcast';
import { notify } from '../notify/notify';
import { listAgents } from './agents';
import {
  attachSession,
  createSession,
  killSession,
  listSessions,
  onAgentWaiting,
  onPtyResized,
  onSessionsChanged,
  onTerminalData,
  onTerminalExit,
  resizeSession,
  restoreSessions,
  writeSession,
} from './pty';
import { initTmux } from './tmux';
import {
  getServerStatus,
  onServerChanged,
  startServer,
  stopServer,
} from './server';
import {
  getNotifyLevel,
  getServerEnabled,
  regenerateToken,
  setNotifyLevel,
  setServerEnabled,
} from './store';

// 독(Dock) 뱃지 — 입력대기 세션 수. 0 이면 반드시 비워 잔존을 막는다
function updateDockBadge(sessions: TerminalSessionInfo[]) {
  const waiting = sessions.filter((s) => s.status === 'waiting').length;
  app.dock?.setBadge(waiting > 0 ? String(waiting) : '');
}

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
  ipcMain.handle('terminal:agents', () => listAgents());
  // 백엔드 정보 — tmux(영속) 가용 여부. 렌더러가 미설치 힌트 표시에 쓴다
  ipcMain.handle('terminal:backend', async () => ({ tmux: !!(await initTmux()) }));
  ipcMain.handle('terminal:notify-level:get', () => getNotifyLevel());
  ipcMain.handle('terminal:notify-level:set', (_e, level: TerminalNotifyLevel) => {
    setNotifyLevel(level);
    return getNotifyLevel();
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
  // 목록·상태 변경 — payload 를 실어 렌더러의 재조회를 없애고, 독 뱃지도 함께 갱신
  onSessionsChanged(() => {
    const sessions = listSessions();
    broadcast('terminal:sessions', sessions);
    updateDockBadge(sessions);
  });
  onPtyResized((id, cols, rows) =>
    broadcast('terminal:resized', { id, cols, rows })
  );
  onServerChanged(() => broadcast('terminal:server:changed'));

  // 입력대기 알림 — 뱃지(사이드바·독)는 sessions 브로드캐스트가 담당하고, 여기선 강도별 추가 신호만
  onAgentWaiting((info) => {
    const level = getNotifyLevel();
    if (level === 'sound') shell.beep();
    if (level === 'alert') {
      void notify({
        title: '⏳ 입력 대기',
        body: `'${info.title}' 세션의 ${TERMINAL_AGENT_NAMES[info.agentId]} 가 입력을 기다립니다.`,
        section: 'terminal',
      });
    }
  });

  // 켜두고 종료했으면 자동 시작 — 자리 비움 시나리오상 재시작 후에도 MO 접속이 살아야 한다
  if (getServerEnabled()) {
    void app.whenReady().then(() => startServer());
  }

  // tmux 백엔드면 이전 실행의 영속 세션을 재접속 복원 (미설치면 no-op)
  void restoreSessions().catch((e) =>
    console.error('[terminal] 세션 복원 실패:', e)
  );
}
