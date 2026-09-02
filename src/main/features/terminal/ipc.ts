import { execFile } from 'node:child_process';
import { app, ipcMain, shell } from 'electron';
import type {
  TerminalCreateInput,
  TerminalNotifyLevel,
  TerminalSessionInfo,
} from '../../../shared/types';
import { TERMINAL_AGENT_NAMES, termWaitToastKey } from '../../../shared/types';
import { broadcast } from '../../lib/broadcast';
import { setWaitingBadge } from '../../lib/dockBadge';
import { sleep } from '../../lib/util';
import { notifyToast, sendToast } from '../notify/notify';
import { EDITOR_NAME, findEditorApp, openWithApp } from '../workspaces/editor';
import { listAgents } from './agents';
import { sessionLocation, sessionLocationLabel } from './location';
import {
  initTerminalWindows,
  isVisibleInPopout,
  registerTerminalWindowsIpc,
} from './windows';
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

/** 터미널 관련 IPC 핸들러 등록 */
export function registerTerminalIpc() {
  // 데스크톱 attach 추적 — pane 이 떠 있는 세션에만 terminal:data 를 방송한다.
  // 없으면 다른 섹션(Jira 등)에 있어 리스너가 0개여도 세션당 최대 62 msg/s 를
  // 계속 직렬화·전송했다(2026-08-07 성능 감사). MO(WS)는 server.ts 가 소켓별
  // attachedId 로 자체 필터하므로 이 게이트와 무관하다.
  // ⚠️ 창(sender)별로 나눠 들어야 한다 — 전역 Set 하나면 창 하나의 파괴·리로드
  // 정리가 다른 창(팝아웃)이 attach 한 세션의 방송까지 끊는다.
  const attachedBySender = new Map<Electron.WebContents, Set<string>>();
  const isDesktopAttached = (id: string): boolean => {
    for (const ids of attachedBySender.values()) if (ids.has(id)) return true;
    return false;
  };

  ipcMain.handle('terminal:list', () => listSessions());
  ipcMain.handle('terminal:create', (_e, opts: TerminalCreateInput) =>
    createSession(opts ?? {})
  );
  ipcMain.handle('terminal:attach', (e, id: string, cols: number, rows: number) => {
    // 죽은 sender 엔트리 청소 — 아래 'destroyed' 가 정본이지만 Map 은 강한 참조라
    // 그 이벤트가 한 번이라도 유실되면 WebContents 가 영영 남는다(창 파괴 경로가
    // close 를 건너뛰는 일이 실제로 있었다 — windows.ts 의 'closed' 주석 참고).
    // attach 는 pane 이 뜰 때만 오는 저빈도 경로라 여기서 훑는 비용이 없다.
    for (const sender of [...attachedBySender.keys()])
      if (sender.isDestroyed()) attachedBySender.delete(sender);
    let ids = attachedBySender.get(e.sender);
    if (!ids) {
      ids = new Set();
      attachedBySender.set(e.sender, ids);
      // 렌더러 리로드·창 파괴 시 detach 가 안 오므로 sender 수명에 묶어 정리한다
      // — 단 그 sender 의 몫만. 파괴는 엔트리째, 리로드는 내용만 비운다(재attach 대비)
      const sender = e.sender;
      sender.once('destroyed', () => attachedBySender.delete(sender));
      sender.on('did-navigate', () => attachedBySender.get(sender)?.clear());
    }
    ids.add(id);
    return attachSession(id, cols, rows);
  });
  ipcMain.on('terminal:detach', (e, id: string) => {
    attachedBySender.get(e.sender)?.delete(id);
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
  // 세션이 속한 **워크트리**를 IDE 로 — 탭 우클릭 메뉴·팝아웃 헤더가 쓴다.
  // 팝아웃은 워크트리 선택이 없고 서로 다른 워크트리의 세션이 한 창에 섞일 수 있어
  // 대상을 세션 단위로 해석한다. 경로는 sessionLocation 이 git 워크트리 목록과 대조한
  // 것만 쓴다(workspaces:open-editor 와 같은 규칙 — 임의 경로 실행 방지). 등록 밖
  // 세션(홈 등)은 열 대상이 없어 거부한다.
  ipcMain.handle('terminal:open-editor', async (_e, id: string) => {
    const s = listSessions().find((x) => x.id === id);
    if (!s) return { ok: false, error: '세션을 찾을 수 없습니다.' };
    const editor = findEditorApp();
    if (!editor) return { ok: false, error: `${EDITOR_NAME} 가 설치되어 있지 않습니다.` };
    const loc = await sessionLocation(s.cwd);
    if (!loc) return { ok: false, error: '등록된 워크트리 안의 세션이 아닙니다.' };
    return openWithApp(editor, loc.wtPath);
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
    if (isDesktopAttached(id)) broadcast('terminal:data', { id, data, seq });
  });
  onTerminalExit((id, exitCode) => {
    for (const ids of attachedBySender.values()) ids.delete(id);
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
        dedupeKey: termWaitToastKey(info.id),
      };
      // 팝아웃 창이 그 세션을 **포커스 상태로** 보고 있으면 토스트를 생략한다 —
      // 메인 창의 렌더러 판정(AppToastBridge 의 isSessionOnScreen)과 짝을 이루는
      // main 쪽 게이트다(팝아웃의 가시 세션은 메인 렌더러가 모른다).
      // ⚠️ 알럿(OS 알림)은 이 게이트를 통과시킨다 — 메인 창도 '보고 있어도 alert 는
      // 나간다'가 규칙인데, 여기서 통째로 return 하면 **팝아웃 세션만 alert 를 잃어**
      // 뒤에 둔 창의 완료를 영영 모른다(2026-09-01 수정).
      if (level === 'alert') void notifyToast(payload);
      else if (!isVisibleInPopout(info.id)) sendToast(payload);
    })();
  });

  // 켜두고 종료했으면 자동 시작 — 자리 비움 시나리오상 재시작 후에도 MO 접속이 살아야 한다.
  // ⚠️ Tailscale 데몬은 로그인 직후 이 앱보다 늦게 올라올 수 있고, 그 사이에는 평문 노출을
  // 막기 위해 시작이 거부된다(사유는 `server.ts` 의 바인딩 주석). 한 번만 시도하면 그 경우
  // 사용자가 접속 모달에서 손으로 켜야 하므로, 올라올 시간을 주며 몇 번 더 시도한다.
  if (getServerEnabled()) {
    void app.whenReady().then(async () => {
      for (const wait of [0, 3_000, 8_000, 20_000]) {
        if (wait) await sleep(wait);
        const status = await startServer();
        // 떴거나, 기다려도 안 풀리는 사유(포트 충돌 등)면 그만둔다
        if (status.running || !status.needsTailscale) return;
      }
    });
  }

  // 팝아웃 창 — 세션↔창 배정 레지스트리 + 창 IPC (열기·포커스·이동·드래그 중계)
  registerTerminalWindowsIpc();

  // tmux 백엔드면 이전 실행의 영속 세션을 재접속 복원 (미설치면 no-op).
  // 팝아웃 창 복원은 **세션 복원 완료 후에만** — 세션 생존 판정이 빈 목록으로 돌면
  // 저장된 창 배정을 오파기한다(렌더러 sessionsReady 게이트와 같은 교훈).
  // 복원 실패 시 팝아웃도 만들지 않는다 — sidecar 가 남아 다음 시작에 다시 시도한다.
  void restoreSessions()
    .then(() => initTerminalWindows())
    .catch((e) => console.error('[terminal] 세션 복원 실패:', e));
}
