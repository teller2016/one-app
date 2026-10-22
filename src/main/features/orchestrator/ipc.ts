// 루트 세션(오케스트레이터) IPC — ⌘P '루트 세션 열기' + MCP 서버 시작 + 작업 원장·승인 창·탭 순서.
// 폰(MO)에는 열지 않는다(ipcMain.handle — handleShared 아님).
import { ipcMain } from 'electron';
import type { OrchestratorConfirmPicks } from '../../../shared/types';
import { whenSecretsReady } from '../../lib/store';
import { whenSessionsRestored } from '../terminal';
import { answerConfirm, listConfirms } from './approve';
import { openRootSession } from './root';
import { registerRootShortcut, startRootLife } from './rootLife';
import { startOrchestratorServer } from './server';
import { getRootSessionId } from './store';
import { listTasks, startTaskWatcher } from './tasks';
import { setTabOrders } from './toolKit';

/** 렌더러가 보낸 고른 값 — 모양이 다르면 버린다(승인 자체는 그대로) */
function parsePicks(v: unknown): OrchestratorConfirmPicks | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const { items, choices } = v as { items?: unknown; choices?: unknown };
  const out: OrchestratorConfirmPicks = { items: [], choices: {} };
  if (Array.isArray(items)) out.items = items.filter((x): x is string => typeof x === 'string');
  if (choices && typeof choices === 'object') {
    for (const [k, val] of Object.entries(choices as Record<string, unknown>)) if (typeof val === 'string') out.choices[k] = val;
  }
  return out;
}

export function registerOrchestratorIpc(): void {
  ipcMain.handle('orchestrator:open-root', () => openRootSession());
  // 지금 루트 세션 id(없으면 null) — 터미널 LNB 고정 칸이 처음 그릴 때 묻고, 이후엔 'orchestrator:root' 방송을 듣는다
  ipcMain.handle('orchestrator:root', () => getRootSessionId());
  // 작업 원장 — 워커 탭의 '루트' 표시가 처음 그릴 때 묻고, 이후엔 'orchestrator:tasks' 방송을 듣는다
  ipcMain.handle('orchestrator:tasks', () => listTasks());
  // 무인 연쇄 가드의 승인 창 — 렌더러가 새로 떴을 때 기다리던 요청도 받고, [실행]/[취소]로 답한다
  ipcMain.handle('orchestrator:confirm:list', () => listConfirms());
  ipcMain.handle('orchestrator:confirm:answer', (_e, id: unknown, approved: unknown, picks: unknown) =>
    typeof id === 'string' && typeof approved === 'boolean' ? answerConfirm(id, approved, parsePicks(picks)) : false,
  );
  // 탭 순서(워크트리 경로 → 세션 id) — list_sessions 의 tab_index 용. 렌더러가 바뀔 때마다 보낸다
  ipcMain.on('orchestrator:tab-orders', (_e, orders: unknown) => setTabOrders(orders));
  // ⌘0 — 창이 생기기 전에 건다(browser-window-created)
  registerRootShortcut();

  // 서버는 키체인 첫 접근(warmUpSecrets)이 끝난 뒤에 — 기동 경로에서 토큰을 읽으면 프롬프트가 main 을 멈춘다.
  // 루트 claude 는 tmux 안에서 앱 재시작을 넘어 살아 있으니 앱이 켜지면 곧바로 받을 수 있어야 한다.
  const serverReady = whenSecretsReady()
    .then(() => startOrchestratorServer())
    .then((st) => {
      if (st.error) console.warn('[orchestrator] 서버 시작 실패:', st.error);
    });
  // 세션 복원 뒤에(복원 전엔 모든 세션이 닫힌 것처럼 보인다) — 남은 열린 일의 감시, 그리고 서버까지 뜨면 루트 자동 시작
  void whenSessionsRestored().then(() => {
    startTaskWatcher();
    return serverReady.then(() => startRootLife());
  });
}
