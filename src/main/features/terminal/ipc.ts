import { execFile } from 'node:child_process';
import path from 'node:path';
import { app, ipcMain, shell } from 'electron';
import type {
  TerminalCreateInput,
  TerminalNotifyLevel,
  TerminalSessionInfo,
} from '../../../shared/types';
import { TERMINAL_AGENT_NAMES } from '../../../shared/types';
import { broadcast } from '../../lib/broadcast';
import { setWaitingBadge } from '../../lib/dockBadge';
import { notifyToast, sendToast } from '../notify/notify';
import { worktreePaths } from '../workspaces/git';
import { listWorkspaces } from '../workspaces/store';
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
  renameSession,
  resizeSession,
  restoreSessions,
  scrollSession,
  scrollSessionToBottom,
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

// 독(Dock) 뱃지 — 입력대기 세션 수. 0 이면 반드시 비워 잔존을 막는다.
// 실제 setBadge 는 lib/dockBadge.ts 가 전담한다(개발 인스턴스의 'DEV' 표식과 한 자리를 나눠 쓴다)
function updateDockBadge(sessions: TerminalSessionInfo[]) {
  setWaitingBadge(sessions.filter((s) => s.status === 'waiting').length);
}

// 세션 위치 라벨 캐시 — cwd 는 세션 수명 동안 불변이라 waiting 마다 git 을 돌리지 않는다
const locationLabels = new Map<string, string | null>();

/**
 * 세션 cwd 가 속한 "작업 영역 · 워크트리" 라벨 (입력대기 알림용).
 * 워크스페이스별 `git worktree list`(경량 — 상태 조회 없음)로 경로를 대조하고,
 * 등록된 워크스페이스 밖(홈 등)이면 null — 호출부가 라벨 없이 표시한다.
 */
async function sessionLocationLabel(cwd: string): Promise<string | null> {
  const cached = locationLabels.get(cwd);
  if (cached !== undefined) return cached;
  let best: { ws: string; wtPath: string } | null = null;
  for (const ws of listWorkspaces()) {
    try {
      const paths = await worktreePaths(ws.repoPath);
      for (const p of paths) {
        if (cwd !== p && !cwd.startsWith(p + '/')) continue;
        // 중첩 매치(주 워크트리 폴더 안의 워크트리)는 더 깊은 경로가 정답
        if (!best || p.length > best.wtPath.length) best = { ws: ws.name, wtPath: p };
      }
    } catch {
      // git 실패(저장소 삭제 등)는 라벨 생략 사유일 뿐 — 알림은 그대로 나간다
    }
  }
  const label = best ? `${best.ws} · ${path.basename(best.wtPath)}` : null;
  locationLabels.set(cwd, label);
  return label;
}

/** 터미널 관련 IPC 핸들러 등록 */
export function registerTerminalIpc() {
  // 데스크톱 attach 추적 — pane 이 떠 있는 세션에만 terminal:data 를 방송한다.
  // 없으면 다른 섹션(Jira 등)에 있어 리스너가 0개여도 세션당 최대 62 msg/s 를
  // 계속 직렬화·전송했다(2026-08-07 성능 감사). MO(WS)는 server.ts 가 소켓별
  // attachedId 로 자체 필터하므로 이 게이트와 무관하다.
  const desktopAttached = new Set<string>();
  const trackedSenders = new WeakSet<Electron.WebContents>();

  ipcMain.handle('terminal:list', () => listSessions());
  ipcMain.handle('terminal:create', (_e, opts: TerminalCreateInput) =>
    createSession(opts ?? {})
  );
  ipcMain.handle('terminal:attach', (e, id: string, cols: number, rows: number) => {
    desktopAttached.add(id);
    // 렌더러 리로드·창 파괴 시 detach 가 안 오므로 sender 수명에 묶어 정리한다
    if (!trackedSenders.has(e.sender)) {
      trackedSenders.add(e.sender);
      const clear = () => desktopAttached.clear();
      e.sender.once('destroyed', clear);
      e.sender.on('did-navigate', clear);
    }
    return attachSession(id, cols, rows);
  });
  ipcMain.on('terminal:detach', (_e, id: string) => {
    desktopAttached.delete(id);
  });
  // 세션 이름 변경 — 목록 갱신은 onSessionsChanged 브로드캐스트가 담당
  ipcMain.handle('terminal:rename', (_e, id: string, title: string) => {
    renameSession(id, title);
    return { ok: true };
  });
  ipcMain.handle('terminal:kill', (_e, id: string) => {
    killSession(id);
    return { ok: true };
  });
  // 세션 위치를 Finder 로 — app:openExternal 은 http(s) 만 허용하므로 별도 채널이다.
  // 경로를 렌더러에서 받지 않고 세션 id 로만 해석한다(임의 경로 열기 방지).
  ipcMain.handle('terminal:reveal-cwd', async (_e, id: string) => {
    const s = listSessions().find((x) => x.id === id);
    if (!s) return { ok: false };
    const error = await shell.openPath(s.cwd);
    return { ok: !error, error: error || undefined };
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
  // 휠 스크롤은 tmux copy-mode 로 위임한다 — tmux 클라이언트가 대체 화면으로 붙어
  // xterm 뷰포트엔 스크롤할 것이 없다(자세한 배경은 pty.scrollSession 주석).
  // invoke 인 이유는 결과(위로 올라가 있는지)로 [맨 아래로] 버튼을 켜기 때문이다.
  ipcMain.handle('terminal:scroll', (_e, id: string, lines: number) =>
    scrollSession(id, lines)
  );
  ipcMain.handle('terminal:scroll-bottom', (_e, id: string) =>
    scrollSessionToBottom(id)
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

  // 세션 이벤트를 모든 창에 push (모바일 WS 는 server.ts 가 별도 구독).
  // 출력은 데스크톱 pane 이 attach 한 세션만 — 안 보는 출력은 보내지 않는다.
  onTerminalData((id, data, seq) => {
    if (desktopAttached.has(id)) broadcast('terminal:data', { id, data, seq });
  });
  onTerminalExit((id, exitCode) => {
    desktopAttached.delete(id);
    broadcast('terminal:exit', { id, exitCode });
  });
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
    // 시스템 경고음(shell.beep) 대신 전용 알림음 — 다른 앱 경고음과 구분된다
    if (level === 'sound')
      execFile('afplay', ['/System/Library/Sounds/Blow.aiff'], () => {
        // 재생 실패는 무시 — 소리가 안 나도 뱃지·토스트는 그대로 동작한다
      });
    // 토스트는 강도와 무관한 기본 표시 — [이동]이 그 세션까지 포커스한다.
    // sticky 지만 dedupeKey 로 세션당 1장만 유지되고, 이미 보고 있는 세션이면
    // 렌더러(AppToastBridge)가 생략한다. 백그라운드 알럿 폴백은 alert 단계에서만.
    void (async () => {
      const location = await sessionLocationLabel(info.cwd);
      const payload = {
        // 어느 작업 영역의 어느 워크트리인지를 제목에 싣는다 (2026-08-14 사용자 요청)
        title: location ? `입력 대기 — ${location}` : '입력 대기',
        message: `'${info.title}' 세션의 ${TERMINAL_AGENT_NAMES[info.agentId]} 가 입력을 기다립니다.`,
        variant: 'info' as const,
        sticky: true,
        section: 'terminal',
        terminalSession: { sessionId: info.id, cwd: info.cwd },
        dedupeKey: `term-wait:${info.id}`,
      };
      if (level === 'alert') void notifyToast(payload);
      else sendToast(payload);
    })();
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
