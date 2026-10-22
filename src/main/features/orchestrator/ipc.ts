// 루트 세션(오케스트레이터) IPC — ⌘P '루트 세션 열기' + MCP 서버 시작.
// 폰(MO)에는 열지 않는다(ipcMain.handle — handleShared 아님).
import { ipcMain } from 'electron';
import { whenSecretsReady } from '../../lib/store';
import { openRootSession } from './root';
import { startOrchestratorServer } from './server';
import { getRootSessionId } from './store';

export function registerOrchestratorIpc(): void {
  ipcMain.handle('orchestrator:open-root', () => openRootSession());
  // 지금 루트 세션 id(없으면 null) — 터미널 LNB 고정 칸이 처음 그릴 때 묻고, 이후엔 'orchestrator:root' 방송을 듣는다
  ipcMain.handle('orchestrator:root', () => getRootSessionId());
  // 서버는 키체인 첫 접근(warmUpSecrets)이 끝난 뒤에 — 기동 경로에서 토큰을 읽으면 프롬프트가 main 을 멈춘다.
  // 루트 claude 는 tmux 안에서 앱 재시작을 넘어 살아 있으니 앱이 켜지면 곧바로 받을 수 있어야 한다.
  void whenSecretsReady()
    .then(() => startOrchestratorServer())
    .then((st) => {
      if (st.error) console.warn('[orchestrator] 서버 시작 실패:', st.error);
    });
}
