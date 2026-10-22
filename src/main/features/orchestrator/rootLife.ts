// 고정 루트 탭의 수명 — 앱 시작 때 자동으로 띄우기 · claude 가 끝났을 때 사용자가 끈 것인지 비정상 종료인지 가르기 ·
// 다시 띄울 대화 id 기록. 1b-2(2026-10-22) 사용자 결정:
//   - 사용자가 끄면(/exit·Ctrl+C 두 번 = 종료 코드 0, 탭 ✕ = 코드 없음) 꺼진 채 — 앱을 다시 켜도 자동으로 띄우지 않는다.
//     ⌘0·LNB '루트' 칸·⌘P 로 켜면 풀린다(root.ts openRootSession).
//   - 비정상 종료(코드 0 아님)는 같은 대화로 다시 띄운다 — 1분에 3번 넘게 죽으면 멈추고 알린다.
//   - 개발 인스턴스는 자동 시작하지 않는다(store devAutoStart 로만 — 테스트용).
// 종료 코드는 루트 명령이 `.exit` 에 적는다(root.ts rootCommand). 탭은 claude 와 함께 닫히므로 onTerminalExit 로 안다.
// ⌘0(어디서든 루트로)도 여기 — 기본 메뉴 '실제 크기'(⌘0)가 렌더러보다 먼저 키를 가져가므로 main 의 before-input-event 로 잡는다.
import { app } from 'electron';
import { IS_DEV_INSTANCE } from '../../lib/devInstance';
import { sleep } from '../../lib/util';
import { sendToast } from '../notify/notify';
import { findClaude, listSessions, onTerminalExit, revealSession } from '../terminal';
import { openRootSession, readRootExit } from './root';
import { devAutoStart, getRootConversation, getRootSessionId, isRootOff, setRootConversation, setRootOff } from './store';

/** 비정상 종료 뒤 다시 띄우기 상한 — 이 시간 안에 이만큼 */
const RESTART_WINDOW_MS = 60_000;
const RESTART_MAX = 3;
/** 다시 띄우기 전 잠깐 — 같은 순간의 원인(키체인·네트워크)이 곧바로 또 죽이지 않게 */
const RESTART_DELAY_MS = 1_500;
/** 대화 id 맞추기 — /clear 하면 바뀐다 */
const SYNC_MS = 20_000;

const restarts: number[] = [];

const rootAlive = (): boolean => {
  const id = getRootSessionId();
  return !!id && listSessions().some((s) => s.id === id);
};

/** 루트 claude 의 지금 대화 id 를 기록 — 다음에 --resume 으로 이어 띄운다 */
async function syncConversation(): Promise<void> {
  const id = getRootSessionId();
  if (!id || !rootAlive()) return;
  const claude = await findClaude(id);
  if (claude && claude.sessionId !== getRootConversation()) setRootConversation(claude.sessionId);
}

async function onRootExit(): Promise<void> {
  const code = readRootExit();
  // 코드 0 = /exit·Ctrl+C 두 번, 코드 없음 = 탭을 닫음(셸째 끝나 적을 틈이 없다) — 사용자가 끈 것
  if (code === null || code === '0') {
    setRootOff(true);
    return;
  }
  const now = Date.now();
  while (restarts.length && now - restarts[0] > RESTART_WINDOW_MS) restarts.shift();
  if (restarts.length >= RESTART_MAX) {
    sendToast({
      title: '루트 세션을 다시 띄우지 않습니다',
      message: `1분 안에 ${RESTART_MAX}번 비정상 종료됐습니다(코드 ${code}). 터미널 '루트' 칸이나 ⌘0 으로 다시 켤 수 있습니다.`,
      variant: 'fail',
      sticky: true,
      section: 'terminal',
      dedupeKey: 'root-crash-loop',
    });
    return;
  }
  restarts.push(now);
  await sleep(RESTART_DELAY_MS);
  if (rootAlive()) return; // 그 사이 사용자가 직접 열었다
  const res = await openRootSession();
  sendToast(
    res.ok
      ? {
          title: '루트 세션을 다시 띄웠습니다',
          message: `비정상 종료(코드 ${code}) — 같은 대화를 이어 갑니다.`,
          variant: 'info',
          terminalSession: { sessionId: res.sessionId, cwd: res.cwd },
          actionLabel: '보기',
          dedupeKey: 'root-restarted',
        }
      : { title: '루트 세션을 다시 띄우지 못했습니다', message: res.error, variant: 'fail', dedupeKey: 'root-restarted' },
  );
}

/** 앱 시작 때 — 꺼 두지 않았으면 띄운다. 앱이 꺼진 사이 사용자가 /exit 했으면 그것도 '끈 것'으로 본다 */
async function autoStart(): Promise<void> {
  if (rootAlive()) return; // tmux 안에서 앱 재시작을 넘어 살아 있다
  if (readRootExit() === '0') setRootOff(true);
  if (isRootOff()) return;
  if (IS_DEV_INSTANCE && !devAutoStart()) return;
  const res = await openRootSession();
  if (!res.ok) console.warn('[orchestrator] 루트 자동 시작 실패:', res.error);
}

/** ⌘0 — 루트를 열고(꺼져 있으면 지난 대화를 이어 띄운다) 그 탭을 앞으로 */
async function openAndReveal(): Promise<void> {
  const res = await openRootSession();
  if (!res.ok) {
    sendToast({ title: '루트 세션을 열지 못했습니다', message: res.error, variant: 'fail', dedupeKey: 'root-open-fail' });
    return;
  }
  revealSession(res.sessionId);
}

/**
 * ⌘0 단축키 — 모든 창(메인·팝아웃·독)에서. ⚠️ 렌더러 keydown 으로는 못 잡는다: 기본 메뉴의 '실제 크기'(⌘0)가 먼저 가져간다
 * (`⌘W`·`⌘+/-` 와 같은 메뉴 선점 — terminal 규칙). before-input-event 는 페이지 keydown·메뉴 단축키보다 먼저 오고,
 * preventDefault 하면 둘 다 막힌다(공식 문서 web-contents). 창이 생기기 전에 등록해야 하므로 앱 시작 때 부른다.
 */
export function registerRootShortcut(): void {
  app.on('browser-window-created', (_e, win) => {
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || input.code !== 'Digit0') return;
      if (!input.meta || input.shift || input.alt || input.control || input.isComposing) return;
      event.preventDefault();
      void openAndReveal().catch((err: unknown) => console.error('[orchestrator] ⌘0 처리 실패:', err));
    });
  });
}

/** 세션 복원·MCP 서버 시작 뒤에 부른다(ipc.ts) */
export function startRootLife(): void {
  onTerminalExit((id) => {
    if (id === getRootSessionId()) void onRootExit().catch((err: unknown) => console.error('[orchestrator] 루트 종료 처리 실패:', err));
  });
  setInterval(() => void syncConversation().catch(() => undefined), SYNC_MS).unref();
  void autoStart()
    .then(() => syncConversation())
    .catch((err: unknown) => console.error('[orchestrator] 루트 자동 시작 실패:', err));
}
