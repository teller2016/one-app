// 터미널 팝아웃 창 — **세션↔창 배정의 정본**. 렌더러(메인 창·팝아웃 창)는
// `terminal:windows` 브로드캐스트(payload 탑재)를 미러할 뿐이다.
//
// 불변식: **한 세션의 pane 은 전 창 통틀어 1개** — 배정이 팝아웃인 세션은 메인 창이
// pane 을 만들지 않고(자리표시자 탭만), 팝아웃 창은 자기 배정 세션만 렌더한다.
// 이 배정 단일 소유가 resize last-claim-wins 의 크기 핑퐁을 원천 차단한다.
//
// 닫힘 의미: 사용자가 창을 닫으면(⌘W 포함) 세션은 **메인 창 탭으로 복귀**(레코드 삭제 =
// 복귀 — 세션 자체는 절대 죽지 않는다). 앱 종료로 닫히는 것은 레코드를 남겨 재시작 시
// 복원한다(tmux 세션이 살아남으므로 창도 따라 살아난다).
import path from 'node:path';
import { app, BrowserWindow, ipcMain, nativeTheme, screen } from 'electron';
import type {
  TerminalDragState,
  TerminalPopoutOpenInput,
  TerminalWindowInfo,
} from '../../../shared/types';
import { termWaitToastKey } from '../../../shared/types';
import { broadcast } from '../../lib/broadcast';
import { getNotifyWindow } from '../notify/notify';
import { IS_DEV_INSTANCE, runtimeFile } from '../../lib/devInstance';
import { readUserJson, writeUserJson } from '../../lib/store';
import {
  clearWindowState,
  inheritWindowSize,
  loadWindowState,
  pruneWindowStates,
  trackWindowState,
} from '../../lib/windowState';
import { sessionLocationLabel } from './location';
import { listSessions, onTerminalExit } from './pty';

// 배정 영속 — 창 bounds 는 windowState(`popout:<id>` 키)가, 배정은 이 sidecar 가 맡는다.
// 개발 인스턴스는 별도 파일(runtimeFile) — 창·세션(tmux 소켓)이 갈라져 있으므로 배정도 가른다.
const FILE = runtimeFile('terminal-windows.json');
type PersistedWindows = Record<string, { sessionIds: string[] }>;

const POPOUT_DEFAULT = { width: 900, height: 600 };
const POPOUT_MIN = { width: 480, height: 320 };
// 마지막으로 닫힌 팝아웃의 크기 — 창 id 는 매번 새로 생겨 개별 키(popout:<id>)만으로는
// 크기가 기억되지 않는다. ⚠️ `popout:` 접두사 금지(pruneWindowStates 가 고아로 지운다)
const POPOUT_LAST_SIZE_KEY = 'popout-last';

type PopoutEntry = {
  win: BrowserWindow | null;
  sessionIds: string[];
  /** open 이 받은 분할 트리(JSON) — 팝아웃 init 이 1회 소비한다(영속 안 함 —
   *  재시작 복원 시엔 팝아웃 렌더러의 localStorage `win:<id>` 레이아웃이 그대로 남아 있다) */
  pendingLayout?: string;
  /** 팝아웃 렌더러가 보고한 화면 세션들 — 입력대기 토스트 게이트·창 타이틀에 쓴다 */
  visibleIds: string[];
};

const popouts = new Map<string, PopoutEntry>();
// 사용자 닫기와 앱 종료를 가른다 — 종료로 닫히는 창은 레코드를 지우면 안 된다(복원 대상)
let quitting = false;

function persist(): void {
  const out: PersistedWindows = {};
  for (const [id, entry] of popouts) out[id] = { sessionIds: entry.sessionIds };
  writeUserJson(FILE, out);
}

function windowInfoList(): TerminalWindowInfo[] {
  return [...popouts].map(([id, e]) => ({ id, sessionIds: [...e.sessionIds] }));
}

function broadcastWindows(): void {
  // terminal:sessions 관례 — payload(전체 목록)를 실어 렌더러 재조회를 없앤다
  broadcast('terminal:windows', windowInfoList());
}

/** 사용자 닫기(또는 빈 창 자동 닫기) 뒷정리 — 레코드 삭제 = 세션들의 메인 복귀 */
function removePopout(id: string): void {
  if (!popouts.delete(id)) return;
  persist();
  // 다음 팝아웃이 물려받을 크기로 남긴다 — 창 id 가 매번 새로 생기므로 개별 키만
  // 지우면 사용자가 조정한 크기가 매번 900×600 으로 되돌아간다
  inheritWindowSize(`popout:${id}`, POPOUT_LAST_SIZE_KEY);
  clearWindowState(`popout:${id}`);
  broadcastWindows();
}

/** 빈 창 닫기 — close 핸들러(removePopout)가 레코드·windowState 를 정리한다.
 *  창이 이미 파괴됐으면(닫힘 이벤트 유실) 레코드만 직접 걷어낸다. */
function closeEmptyWindow(id: string): void {
  const entry = popouts.get(id);
  if (entry?.win && !entry.win.isDestroyed()) entry.win.close();
  else removePopout(id);
}

/**
 * 배정에서 세션들을 걷어낸다 — **모든 배정 변경이 거치는 한 곳**.
 * ⚠️ 비게 된 창을 닫지 않으면 세션 0개인 빈 팝아웃이 화면에 남는다(2026-09-01:
 * open 경로에만 이 정리가 빠져 있어, 팝아웃의 마지막 세션·그룹을 다시 창 밖으로
 * 끌면 빈 창이 그대로 떠 있었다 — 그 창의 안내문은 '자동으로 닫힙니다'인데도).
 * 닫기 자체는 호출부가 정한다 — moveSession 은 방금 세션을 넣은 대상 창을 빼야 한다.
 */
function detachFromAll(sessionIds: readonly string[]): {
  changed: boolean;
  emptied: string[];
} {
  let changed = false;
  const emptied: string[] = [];
  for (const [id, entry] of popouts) {
    const next = entry.sessionIds.filter((s) => !sessionIds.includes(s));
    if (next.length === entry.sessionIds.length) continue;
    entry.sessionIds = next;
    changed = true;
    if (next.length === 0) emptied.push(id);
  }
  return { changed, emptied };
}

/** 창 타이틀 — "워크스페이스 · 워크트리" (등록 밖이면 폴더명). 포커스 세션 변경 시 갱신 */
async function updateTitle(id: string): Promise<void> {
  const entry = popouts.get(id);
  if (!entry?.win || entry.win.isDestroyed()) return;
  const sid = entry.visibleIds[0] ?? entry.sessionIds[0];
  const s = sid ? listSessions().find((x) => x.id === sid) : undefined;
  const label = s ? ((await sessionLocationLabel(s.cwd)) ?? path.basename(s.cwd)) : '터미널';
  if (entry.win && !entry.win.isDestroyed())
    entry.win.setTitle(IS_DEV_INSTANCE ? `${label} — DEV` : label);
}

function createPopoutWindow(id: string, at?: { x: number; y: number }): void {
  const entry = popouts.get(id);
  if (!entry || entry.win) return;
  const stateKey = `popout:${id}`;
  const saved = loadWindowState(stateKey, {
    defaults: POPOUT_DEFAULT,
    min: POPOUT_MIN,
    fallbackKey: POPOUT_LAST_SIZE_KEY, // 이 창의 기억이 없으면 마지막 팝아웃 크기
  });

  // 드롭 좌표가 오면 그 자리를 창 중심으로 — 화면 밖으로 나가지 않게 workArea 로 클램프
  let x = saved.x;
  let y = saved.y;
  if (at) {
    const area = screen.getDisplayNearestPoint(at).workArea;
    x = Math.round(
      Math.min(Math.max(at.x - saved.width / 2, area.x), area.x + area.width - saved.width)
    );
    y = Math.round(
      Math.min(Math.max(at.y - 20, area.y), area.y + area.height - saved.height)
    );
  }

  const win = new BrowserWindow({
    width: saved.width,
    height: saved.height,
    x,
    y,
    minWidth: POPOUT_MIN.width,
    minHeight: POPOUT_MIN.height,
    title: IS_DEV_INSTANCE ? '터미널 — DEV' : '터미널',
    // 메인 창과 같은 신호등 통합 — 단 vibrancy 는 없다: 전면이 불투명 터미널 패널이라
    // 재질이 보일 면적이 없고, 대신 backgroundColor 를 칠해 로드 전 플래시를 막는다
    // (--bg 토큰과 동기화 — _base.scss 참고)
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 20, y: 16 },
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#f5f5f7',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // 메인 창(main.ts)과 동일 — 기본값이지만 명시해 프로세스 격리가 조용히 풀리는 것을 막는다
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  entry.win = win;

  // ⚠️ trackWindowState 를 close 정리보다 먼저 등록 — close 시 '마지막 상태 저장'이
  // 아래 clearWindowState(사용자 닫기)보다 앞서 돌아야 저장→삭제 순서가 성립한다
  trackWindowState(win, stateKey);

  // index.html 의 <title>One App</title> 이 창 제목을 덮지 않게 상시 차단 —
  // 제목은 main 이 setTitle 로만 관리한다(레포 라벨)
  win.on('page-title-updated', (e) => e.preventDefault());

  // 렌더러의 새 창 요청은 앱 안에 만들지 않는다 (main.ts 와 동일)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  win.on('close', () => {
    if (quitting) return; // 앱 종료 — 레코드 유지(재시작 복원)
    removePopout(id); // 사용자 닫기 — 세션 메인 복귀. pane 회수는 sender destroyed 가 한다
  });
  win.on('closed', () => {
    const e = popouts.get(id);
    if (e) e.win = null;
    // ⚠️ **`close` 만 믿지 말 것** — 창이 강제 파괴되는 경로(devtools/CDP 로 닫기,
    // 렌더러 크래시 등)에서는 `close` 가 생략되고 `closed` 만 온다(2026-09-01 E2E 실측:
    // 창은 사라졌는데 배정이 남아 세션이 없는 창에 갇혔고, 재시작하면 닫은 창이
    // 되살아났다). `closed` 는 어느 경로로 파괴되든 반드시 오므로 여기서 한 번 더
    // 정리한다 — 위 `close` 에서 이미 지웠으면 removePopout 이 no-op 이다.
    if (!quitting) removePopout(id);
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    void win.loadURL(
      `${MAIN_WINDOW_VITE_DEV_SERVER_URL}?popout=${encodeURIComponent(id)}`
    );
  } else {
    void win.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
      { query: { popout: id } }
    );
  }
  void updateTitle(id);
}

function focusPopout(id: string): boolean {
  const entry = popouts.get(id);
  if (!entry?.win || entry.win.isDestroyed()) return false;
  if (entry.win.isMinimized()) entry.win.restore();
  entry.win.show();
  entry.win.focus();
  app.focus({ steal: true });
  return true;
}

/** 세션이 어느 팝아웃에 배정돼 있는가 — 없으면 null (= 메인 창 소속) */
export function popoutIdOfSession(sessionId: string): string | null {
  for (const [id, entry] of popouts)
    if (entry.sessionIds.includes(sessionId)) return id;
  return null;
}

/** 입력대기 토스트 게이트 — 그 세션이 팝아웃 화면에 올라와 있는가(포커스 불요) */
export function isVisibleInPopout(sessionId: string): boolean {
  for (const entry of popouts.values())
    if (entry.win && !entry.win.isDestroyed() && entry.visibleIds.includes(sessionId))
      return true;
  return false;
}

/** 배정 변경 공용 경로 — 모든 팝아웃에서 제거 후 (팝아웃 대상이면) 추가 */
function moveSession(sessionId: string, to: string): { ok: boolean; error?: string } {
  const target = to === 'main' ? null : popouts.get(to);
  if (to !== 'main' && !target) return { ok: false, error: '창이 이미 닫혔습니다.' };
  const { emptied } = detachFromAll([sessionId]);
  if (target) {
    target.sessionIds.push(sessionId);
    void updateTitle(to);
  }
  // 빈 창은 닫는다 — close 핸들러(removePopout)가 레코드·windowState 를 정리한다
  for (const id of emptied) {
    if (id === to) continue; // 방금 넣은 창이 비었을 리 없지만 방어
    closeEmptyWindow(id);
  }
  persist();
  broadcastWindows();
  return { ok: true };
}

/** 팝아웃 창 IPC 등록 — registerTerminalIpc() 가 부른다 */
export function registerTerminalWindowsIpc(): void {
  app.on('before-quit', () => {
    quitting = true;
  });

  // 세션이 죽으면 배정에서도 걷어낸다 — 마지막 세션이 죽은 창은 자동으로 닫힌다
  onTerminalExit((sessionId) => {
    const { changed, emptied } = detachFromAll([sessionId]);
    for (const id of emptied) closeEmptyWindow(id);
    if (changed) {
      persist();
      broadcastWindows();
    }
  });

  ipcMain.handle('terminal:windows:list', () => windowInfoList());

  ipcMain.handle('terminal:windows:open', (_e, input: TerminalPopoutOpenInput) => {
    const alive = new Set(listSessions().map((s) => s.id));
    const ids = input.sessionIds.filter((id) => alive.has(id));
    if (ids.length === 0) return { ok: false as const, error: '살아 있는 세션이 없습니다.' };

    // 오발 방지 히트테스트 — 드롭 지점이 앱의 다른 창 위면 분리가 아니라 놓친 드롭이다
    if (typeof input.x === 'number' && typeof input.y === 'number') {
      const over = BrowserWindow.getAllWindows().some((w) => {
        if (w.isDestroyed() || !w.isVisible() || w.isMinimized()) return false;
        const b = w.getBounds();
        return (
          input.x! >= b.x &&
          input.x! <= b.x + b.width &&
          input.y! >= b.y &&
          input.y! <= b.y + b.height
        );
      });
      if (over) return { ok: false as const, error: 'over-window' };
    }

    // 다른 팝아웃에 있던 세션이면 먼저 걷어낸다 (배정 단일 소유) —
    // ⚠️ 그 결과 빈 창이 되면 반드시 닫는다. 팝아웃의 마지막 세션(그룹째 포함)을
    // 다시 창 밖으로 끄는 경로라, 안 닫으면 세션 없는 창이 그대로 남는다.
    const { emptied } = detachFromAll(ids);
    for (const id of emptied) closeEmptyWindow(id);

    const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    popouts.set(id, {
      win: null,
      sessionIds: ids,
      pendingLayout: input.layout,
      visibleIds: [],
    });
    persist();
    broadcastWindows();
    createPopoutWindow(
      id,
      typeof input.x === 'number' && typeof input.y === 'number'
        ? { x: input.x, y: input.y }
        : undefined
    );
    return { ok: true as const, id };
  });

  ipcMain.handle('terminal:windows:focus', (_e, id: string) => ({
    handled: focusPopout(id),
  }));

  // 토스트 [이동]·자리표시자 클릭 공용 — 세션이 팝아웃에 있으면 그 창을 포커스
  ipcMain.handle('terminal:windows:focus-session', (_e, sessionId: string) => {
    const id = popoutIdOfSession(sessionId);
    return { handled: !!id && focusPopout(id) };
  });

  ipcMain.handle(
    'terminal:windows:move-session',
    (_e, args: { sessionId: string; to: string }) => {
      const res = moveSession(args.sessionId, args.to);
      // 크로스 윈도우 드롭은 소스 탭이 언마운트돼 dragend 가 유실될 수 있다 —
      // 배정 변경이 곧 드래그의 끝이므로 무조건 드래그 상태를 회수시킨다
      broadcast('terminal:dragState', null);
      return res;
    }
  );

  // 팝아웃 부팅 1회 — 배정 세션 + (있으면) 최초 분할 트리. layout 은 소비 후 폐기
  ipcMain.handle('terminal:windows:init', (_e, id: string) => {
    const entry = popouts.get(id);
    if (!entry) return { sessionIds: [] as string[] };
    const layout = entry.pendingLayout;
    entry.pendingLayout = undefined;
    return { sessionIds: [...entry.sessionIds], layout };
  });

  // 팝아웃 렌더러의 화면 세션 보고 — 알림 게이트(isVisibleInPopout)·창 타이틀 갱신
  ipcMain.on(
    'terminal:windows:visible',
    (_e, args: { windowId: string; ids: string[] }) => {
      const entry = popouts.get(args.windowId);
      if (!entry) return;
      const prev = entry.visibleIds;
      entry.visibleIds = args.ids;
      // 팝아웃 화면에 새로 올라온 세션 — 메인 창에 떠 있던 sticky 입력대기 토스트를
      // 거둔다(TerminalSection 이 자기 화면 세션에 하는 dismiss 와 같은 의미)
      const notifyWin = getNotifyWindow();
      if (notifyWin) {
        for (const id of args.ids) {
          if (!prev.includes(id))
            notifyWin.webContents.send('app:toast:dismiss', termWaitToastKey(id));
        }
      }
      void updateTitle(args.windowId);
    }
  );

  // 창 간 드래그 중계 — 소스 창의 dragstart/dragend 를 전 창에 미러한다
  ipcMain.on('terminal:drag', (_e, state: TerminalDragState) => {
    broadcast('terminal:dragState', state ?? null);
  });

  // 팝아웃 → 메인 창 '이 세션을 거기서 열어라' — 되돌리기(↩)가 세션을 메인 창의
  // **다른 워크트리 화면**에 떨궈 눈에 안 보이는 것을 막는다(탭바 드롭 adoptSession 이
  // 렌더러 안에서 하는 focusReq 와 같은 의미 — 창이 다르니 main 을 거친다).
  ipcMain.handle('terminal:windows:reveal-in-main', (_e, sessionId: string) => {
    const win = getNotifyWindow();
    const s = listSessions().find((x) => x.id === sessionId);
    if (!win || !s) return { handled: false };
    win.webContents.send('terminal:reveal', { sessionId, cwd: s.cwd });
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    app.focus({ steal: true });
    return { handled: true };
  });

  // 팝아웃 창 레포 라벨 — 렌더러 헤더 표시용 (알림 제목과 같은 sessionLocationLabel)
  ipcMain.handle('terminal:location-label', async (_e, sessionId: string) => {
    const s = listSessions().find((x) => x.id === sessionId);
    return s ? await sessionLocationLabel(s.cwd) : null;
  });
}

/**
 * 재시작 복원 — sidecar 의 배정을 세션 생존과 대조해 창을 되살린다.
 * ⚠️ 반드시 restoreSessions() **완료 후** 호출할 것(ipc.ts) — 복원 전 빈 세션 목록으로
 * 대조하면 저장된 배정을 통째로 오파기한다.
 */
export function initTerminalWindows(): void {
  const saved = readUserJson<PersistedWindows>(FILE, {});
  const alive = new Set(listSessions().map((s) => s.id));
  for (const [id, rec] of Object.entries(saved)) {
    const ids = (rec.sessionIds ?? []).filter((sid) => alive.has(sid));
    if (ids.length === 0) {
      clearWindowState(`popout:${id}`);
      continue; // 세션이 전부 죽은 창은 되살리지 않는다
    }
    popouts.set(id, { win: null, sessionIds: ids, visibleIds: [] });
    createPopoutWindow(id);
  }
  persist(); // 죽은 세션·빈 창을 걷어낸 결과로 굳힌다
  pruneWindowStates((key) => popouts.has(key.slice('popout:'.length)));
  if (popouts.size > 0) broadcastWindows();
}
