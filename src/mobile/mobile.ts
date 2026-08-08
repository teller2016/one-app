// 모바일(MO) 터미널 — One App 메인 프로세스의 WS 브리지(/term)에 붙어
// 데스크톱과 같은 PTY 세션을 이어서 쓴다. 재접속 = 재attach = replay 복원.
import { FitAddon } from '@xterm/addon-fit';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import './mobile.css';
import type {
  TermClientMsg,
  TermCwdOption,
  TermServerMsg,
  TermWorkspaceNode,
  TermWorktreeNode,
} from '../shared/terminal-protocol';
import type {
  TerminalAgentId,
  TerminalAgentInfo,
  TerminalPreset,
  TerminalSessionInfo,
} from '../shared/types';
import {
  TERMINAL_AGENT_NAMES,
  agentIdFromCommand,
  presetsForWorkspace,
} from '../shared/types';

const LAST_SESSION_KEY = 'mo:lastSession';
// 선택한 작업 영역(워크트리) — 데스크톱 LNB 선택에 해당한다
const SCOPE_KEY = 'mo:scope';

// 데스크톱 TerminalView 의 TERM_THEME 과 동일 팔레트
const TERM_THEME = {
  background: '#1e1e20',
  foreground: '#e8e8ea',
  cursor: '#e8e8ea',
  cursorAccent: '#1e1e20',
  selectionBackground: 'rgba(41, 151, 255, 0.35)',
  black: '#3d3d40',
  red: '#ff6961',
  green: '#34c759',
  yellow: '#ffd60a',
  blue: '#2997ff',
  magenta: '#ff7ab6',
  cyan: '#5ac8fa',
  white: '#e8e8ea',
  brightBlack: '#6c6c71',
  brightRed: '#ff8a80',
  brightGreen: '#66d97e',
  brightYellow: '#ffe23f',
  brightBlue: '#61b0ff',
  brightMagenta: '#ff9ac9',
  brightCyan: '#8fdcff',
  brightWhite: '#ffffff',
};

const termEl = document.getElementById('term') as HTMLElement;
const statusEl = document.getElementById('status') as HTMLElement;
const selectEl = document.getElementById('sessionSelect') as HTMLSelectElement;
const navBtn = document.getElementById('navBtn') as HTMLButtonElement;
const presetBtn = document.getElementById('presetBtn') as HTMLButtonElement;
const scopeEl = document.getElementById('scope') as HTMLElement;
const newBtn = document.getElementById('newBtn') as HTMLButtonElement;
const kbBtn = document.getElementById('kbBtn') as HTMLButtonElement;
const waitBtn = document.getElementById('waitBtn') as HTMLButtonElement;
const keybarEl = document.getElementById('keybar') as HTMLElement;
const ctrlBtn = document.getElementById('ctrlBtn') as HTMLButtonElement;
const pasteBtn = document.getElementById('pasteBtn') as HTMLButtonElement;
const fontHud = document.getElementById('fontHud') as HTMLElement;
const bottomBtn = document.getElementById('toBottom') as HTMLButtonElement;
const cwdSheet = document.getElementById('cwdSheet') as HTMLElement;
const cwdBackdrop = document.getElementById('cwdBackdrop') as HTMLElement;
const cwdList = document.getElementById('cwdList') as HTMLElement;
const cwdTitle = document.getElementById('cwdTitle') as HTMLElement;

// 주소창의 토큰은 서버가 쿠키로 승격했으니 지운다 (공유·스크린샷 노출 방지).
// ⚠️ 경로는 현재 경로를 유지할 것 — '/' 로 고정하면 이 페이지(`/terminal/`)가 아니라
// 앱 셸로 URL 이 바뀌어 새로고침·홈 화면 아이콘이 엉뚱한 화면을 연다.
if (new URLSearchParams(location.search).has('token')) {
  history.replaceState(null, '', location.pathname);
}

// 글자 크기 — 폰 화면·시야에 따라 편차가 커서 사용자가 조절하고 기억한다.
// 기본값은 최소 크기 — claude 같은 넓은 TUI 를 폰에서 통째로 보는 게 첫 화면의 목적이고,
// 키우는 건 핀치로 바로 되지만 잘려 있으면 무엇을 키워야 할지조차 안 보인다.
const FONT_KEY = 'mo:fontSize';
const FONT_MIN = 6;
const FONT_MAX = 22;
const initialFont = Number(localStorage.getItem(FONT_KEY)) || FONT_MIN;

const term = new Terminal({
  fontSize: Math.min(FONT_MAX, Math.max(FONT_MIN, initialFont)),
  // 데스크톱과 같은 번들 폰트 — 기기 기본 monospace 는 폰마다 자폭·자연 줄높이가 달라
  // 박스 드로잉과 커서가 어긋나 보였다(mobile.css 의 @font-face 참고).
  fontFamily: "'JetBrains Mono NL', ui-monospace, Menlo, monospace",
  // ⚠️ xterm 의 lineHeight 는 fontSize 가 아니라 **폰트의 자연 줄높이**에 곱해진다 —
  // 이 폰트는 1.346 배라 1.25 를 주면 행간이 크게 벌어져 세로로 늘어나 보이고
  // 폰의 좁은 화면에서 보이는 행 수까지 줄었다. 1.0 이 이 폰트로 가능한 최소값이다
  // (xterm 은 1 미만을 거부한다 — features/terminal.md).
  lineHeight: 1.0,
  cursorBlink: true,
  scrollback: 3000,
  // ⚠️ Unicode11Addon 이 쓰는 term.unicode 는 proposed API 라 이 옵션이 없으면
  // addon load 가 throw 하고 그 뒤 초기화가 통째로 멈춘다(데스크톱 실측).
  allowProposedApi: true,
  theme: TERM_THEME,
});
const fit = new FitAddon();
term.loadAddon(fit);
// 한글·이모지의 셀 폭 판정을 최신 규격으로 — 없으면 CJK 가 한 칸으로 계산돼
// TUI 의 표·테두리가 오른쪽으로 밀린다(데스크톱과 같은 addon 구성).
const unicode11 = new Unicode11Addon();
term.loadAddon(unicode11);
term.unicode.activeVersion = '11';
term.open(termEl);
fit.fit();

// 웹폰트가 늦게 오면 xterm 이 폴백 폭으로 잰 셀 크기가 굳는다 — 로드 후 한 번 다시 잰다
void document.fonts.ready.then(() => {
  term.clearTextureAtlas();
  fit.fit();
});

let ws: WebSocket | null = null;
let attachedId: string | null = null;
let attachSeq = 0; // 이 값 이하의 data 는 replay 에 이미 포함 — 버린다
let sessions: TerminalSessionInfo[] = [];
let cwdOptions: TermCwdOption[] = []; // 새 세션 위치 후보 (서버가 프로젝트 레지스트리에서 보내줌)
let agentOptions: TerminalAgentInfo[] = []; // 에이전트 후보 (설치 감지 포함)
let workspaceTree: TermWorkspaceNode[] = []; // 작업 영역 트리 (시트를 열 때 받아온다)
let presets: TerminalPreset[] = []; // 프리셋 (접속 시 서버가 밀어준다)
let reconnectDelay = 1000;
let ctrlArmed = false; // ctrl 키바 토글 — 다음 한 글자를 제어문자로

/**
 * 선택한 작업 영역 — 데스크톱 LNB 의 워크트리 선택에 해당한다.
 * 세션 목록을 이 위치 것만 남기고, 새 세션·프리셋도 여기서 연다.
 * null 이면 예전처럼 전체 세션을 보여준다(처음 켠 폰·해제했을 때).
 */
type Scope = { wsId: string; wsName: string; path: string; name: string; branch?: string };
let scope: Scope | null = loadScope();

function loadScope(): Scope | null {
  try {
    const raw = localStorage.getItem(SCOPE_KEY);
    return raw ? (JSON.parse(raw) as Scope) : null;
  } catch {
    return null; // 형식이 깨졌으면 전체 보기로
  }
}

function setScope(next: Scope | null) {
  scope = next;
  if (next) localStorage.setItem(SCOPE_KEY, JSON.stringify(next));
  else localStorage.removeItem(SCOPE_KEY);
  renderScope();
  renderSessions();
}

/** 지금 보여줄 세션 — 작업 영역이 잡혀 있으면 그 위치에서 시작한 것만 */
function visibleSessions(): TerminalSessionInfo[] {
  return scope ? sessions.filter((s) => s.cwd === scope?.path) : sessions;
}

function renderScope() {
  if (!scope) {
    scopeEl.hidden = true;
    navBtn.classList.remove('on');
    return;
  }
  scopeEl.hidden = false;
  navBtn.classList.add('on');
  scopeEl.innerHTML = '';
  const name = document.createElement('span');
  name.className = 'scope-name';
  name.textContent = `${scope.wsName} · ${scope.name}`;
  scopeEl.appendChild(name);
  if (scope.branch) {
    const br = document.createElement('span');
    br.className = 'scope-branch';
    br.textContent = scope.branch;
    scopeEl.appendChild(br);
  }
  const clear = document.createElement('button');
  clear.type = 'button';
  clear.textContent = '전체 보기';
  clear.addEventListener('click', () => setScope(null));
  scopeEl.appendChild(clear);
}

function sendMsg(msg: TermClientMsg) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function setStatus(text: string, ok: boolean) {
  // 정상 연결이면 초록 점만 남긴다(텍스트 자리 절약) — 문구는 title 로 보존
  statusEl.textContent = ok ? '' : text;
  statusEl.title = text;
  statusEl.classList.toggle('ok', ok);
  // 연결이 없으면 버튼이 조용히 죽는 대신 비활성으로 상태를 드러낸다
  newBtn.disabled = !ok;
  navBtn.disabled = !ok;
  presetBtn.disabled = !ok;
  selectEl.disabled = !ok;
}

/** 안내를 잠깐 띄웠다가 원래 연결 상태로 되돌린다 (토스트가 없는 화면이라 상태줄을 빌린다) */
let noticeTimer: ReturnType<typeof setTimeout> | null = null;
function notice(text: string) {
  if (noticeTimer !== null) clearTimeout(noticeTimer);
  statusEl.textContent = text;
  statusEl.classList.remove('ok');
  noticeTimer = setTimeout(() => {
    noticeTimer = null;
    setStatus(ws?.readyState === WebSocket.OPEN ? '연결됨' : '연결 끊김', ws?.readyState === WebSocket.OPEN);
  }, 2200);
}

// ── 키바 — 소프트 키보드가 떠 있을 때만 펼친다 ──
// safe-area 까지 합쳐 87px(UI 크롬의 42%)를 상시로 먹고 있었는데, esc·tab·방향키는
// 소프트 키보드가 떠 있을 때만 쓸모가 있다(2026-08-08 실측).
//
// ⚠️ 판정을 `term.textarea` 의 focus/blur 로 하면 **키보드를 내려도 키바가 남는다**
//    (2026-08-08 사용자 지적) — 안드로이드 뒤로가기·iOS 키보드 내리기로 닫으면
//    포커스는 그대로라 blur 가 오지 않는다. 그래서 **보이는 뷰포트 높이가 얼마나
//    줄었는지**로 본다: 키보드는 두 OS 모두 뷰포트를 크게 줄이고, 닫히면 되돌린다.
const KEYBAR_PIN_KEY = 'mo:keybarPinned';
// 주소창 표시/숨김(≈50px)과 구분되는 문턱 — 소프트 키보드는 이보다 훨씬 크게 줄인다
const KEYBOARD_MIN_DELTA = 120;
let keybarPinned = localStorage.getItem(KEYBAR_PIN_KEY) === '1';
/** 키보드가 없을 때의 뷰포트 높이 — 관측된 최대값으로 따라간다(회전 시 리셋) */
let baseViewportH = 0;

/** 지금 실제로 보이는 높이 — 레이아웃까지 줄이는 안드로이드는 innerHeight 가 더 작다 */
function viewportH(): number {
  const vv = window.visualViewport?.height;
  return Math.min(vv ?? Infinity, window.innerHeight || Infinity);
}

function keyboardOpen(): boolean {
  const h = viewportH();
  if (!Number.isFinite(h)) return false;
  if (h > baseViewportH) baseViewportH = h; // 가장 넓었던 상태 = 키보드 없음
  return baseViewportH - h > KEYBOARD_MIN_DELTA;
}

function syncKeybar() {
  const show = keybarPinned || keyboardOpen();
  kbBtn.classList.toggle('on', keybarPinned);
  if (keybarEl.hidden === !show) return; // 변화 없으면 fit 을 돌리지 않는다
  keybarEl.hidden = !show;
  syncViewport(); // 높이가 바뀌었으니 PTY 행도 따라간다
}

kbBtn.addEventListener('pointerdown', (e) => e.preventDefault()); // 포커스 유지
kbBtn.addEventListener('click', () => {
  keybarPinned = !keybarPinned;
  localStorage.setItem(KEYBAR_PIN_KEY, keybarPinned ? '1' : '0');
  syncKeybar();
  term.focus();
});

// ── 입력 대기 세션 바로가기 ──
// 폰은 '자리를 비웠을 때 이어받는' 화면이라, 어떤 세션이 나를 기다리는지가 가장 중요한 정보다.
// 예전엔 select 를 열어야 글리프(●)가 보였다.
function renderWaiting() {
  const waiting = sessions.filter((s) => s.status === 'waiting');
  waitBtn.hidden = waiting.length === 0;
  if (!waiting.length) return;
  waitBtn.textContent = `● ${waiting.length}`;
  waitBtn.setAttribute(
    'aria-label',
    `입력 대기 ${waiting.length}개 — 다음 대기 세션으로 이동`
  );
}

waitBtn.addEventListener('click', () => {
  const waiting = sessions.filter((s) => s.status === 'waiting');
  if (!waiting.length) return;
  // 이미 보고 있는 대기 세션 다음 것으로 — 여러 개면 눌러서 순회한다
  const cur = waiting.findIndex((s) => s.id === attachedId);
  const next = waiting[(cur + 1) % waiting.length];
  if (next.id !== attachedId) attach(next.id);
  term.focus();
});

// 상태 글리프 — <option> 은 스타일이 안 먹어 텍스트 글리프가 유일한 표현 수단
const STATUS_GLYPHS: Record<TerminalSessionInfo['status'], string> = {
  waiting: '●', // 입력 대기 — 주의 필요
  busy: '◐', // 작업 중
  idle: '○',
};

function renderSessions() {
  const list = visibleSessions();
  selectEl.innerHTML = '';
  for (const s of list) {
    const opt = document.createElement('option');
    opt.value = s.id;
    const glyph = STATUS_GLYPHS[s.status] ?? '○';
    const agent = s.agentId && s.agentId !== 'shell' ? ` (${TERMINAL_AGENT_NAMES[s.agentId]})` : '';
    opt.textContent = `${glyph} ${s.title}${agent}`;
    selectEl.appendChild(opt);
  }
  // 보고 있는 세션이 작업 영역 밖이면(다른 영역에서 이어보는 중) 목록에도 남겨둔다 —
  // 없으면 select 가 엉뚱한 세션을 가리켜 손만 대도 화면이 바뀐다
  const attached = attachedId ? sessions.find((s) => s.id === attachedId) : null;
  if (attached && !list.some((s) => s.id === attached.id)) {
    const opt = document.createElement('option');
    opt.value = attached.id;
    opt.textContent = `${STATUS_GLYPHS[attached.status] ?? '○'} ${attached.title} (다른 영역)`;
    selectEl.appendChild(opt);
  }
  if (!selectEl.options.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = scope
      ? '이 작업 영역에 세션 없음 — ＋ 로 시작'
      : '세션 없음 — 새 세션을 만드세요';
    selectEl.appendChild(opt);
  }
  if (attachedId) selectEl.value = attachedId;
}

function attach(id: string) {
  fit.fit();
  sendMsg({ type: 'attach', id, cols: term.cols, rows: term.rows });
}

function handleMessage(msg: TermServerMsg) {
  switch (msg.type) {
    case 'sessions':
      sessions = msg.sessions;
      if (attachedId && !sessions.some((s) => s.id === attachedId)) {
        attachedId = null;
      }
      renderSessions();
      renderWaiting();
      if (!attachedId) {
        // 마지막에 보던 세션은 작업 영역과 무관하게 이어본다(폰은 '이어서 쓰는' 화면이다).
        // 없으면 지금 영역의 첫 세션으로.
        const last = localStorage.getItem(LAST_SESSION_KEY);
        const next = sessions.find((s) => s.id === last) ?? visibleSessions()[0];
        if (next) attach(next.id);
      }
      break;
    case 'cwds':
      cwdOptions = msg.items;
      break;
    case 'agents':
      agentOptions = msg.items;
      break;
    case 'workspaces':
      workspaceTree = msg.items;
      if (sheetMode === 'scope') renderScopeSheet(); // 열려 있으면 즉시 채운다
      break;
    case 'presets':
      presets = msg.items;
      if (sheetMode === 'preset') renderPresetSheet();
      break;
    case 'created':
      attach(msg.id);
      break;
    case 'attached':
      attachedId = msg.id;
      attachSeq = msg.seq;
      localStorage.setItem(LAST_SESSION_KEY, msg.id);
      term.reset();
      if (msg.replay) term.write(msg.replay);
      syncBottomBtn();
      if (
        msg.cols > 0 &&
        msg.rows > 0 &&
        (msg.cols !== term.cols || msg.rows !== term.rows)
      ) {
        term.resize(msg.cols, msg.rows);
      }
      renderSessions();
      break;
    case 'data':
      if (msg.id === attachedId && msg.seq > attachSeq) term.write(msg.data);
      break;
    case 'resized': {
      if (msg.id !== attachedId) break;
      // 다른 클라이언트(데스크톱)가 큰 크기로 바꾸면 폰에선 오른쪽이 잘려 못 읽는다 →
      // **보고 있는 쪽이 다시 주장**한다. 백그라운드일 때는 그대로 따라가 다툼을 피한다.
      const mine = fit.proposeDimensions();
      if (
        document.visibilityState === 'visible' &&
        mine &&
        mine.cols > 0 &&
        mine.rows > 0 &&
        (mine.cols !== msg.cols || mine.rows !== msg.rows)
      ) {
        term.resize(mine.cols, mine.rows);
        // term.cols 가 이미 mine 과 같으면 onResize 가 안 뜨므로 직접 보낸다
        sendMsg({ type: 'resize', cols: mine.cols, rows: mine.rows });
      } else if (msg.cols !== term.cols || msg.rows !== term.rows) {
        term.resize(msg.cols, msg.rows);
      }
      break;
    }
    case 'exit':
      if (msg.id === attachedId) {
        attachedId = null;
        term.write('\r\n\x1b[90m[세션이 종료되었습니다]\x1b[0m\r\n');
      }
      break;
    case 'error':
      setStatus(msg.message, false);
      break;
  }
}

// 재연결 예약 핸들 — visibilitychange 재연결과 onclose 백오프가 경합해 소켓이
// 이중 생성되면, 먼저 열린 쪽은 `ws !== sock` 가드에 걸려 영영 닫히지 않는
// 유령 소켓이 된다(2026-08-07 성능 감사). connect 진입 시 예약을 지우고,
// 이미 소켓이 있으면(연결 중 포함) 새로 만들지 않는다.
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function connect() {
  if (ws) return;
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  setStatus('연결 중…', false);
  // 스킴은 페이지를 따라간다 — https 페이지에서 ws:// 는 브라우저가 mixed content 로 막는다
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  const sock = new WebSocket(`${scheme}://${location.host}/term`);
  ws = sock;
  sock.onopen = () => {
    reconnectDelay = 1000;
    setStatus('연결됨', true);
    // 서버가 접속 직후 sessions 를 보내주고, 그때 마지막 세션으로 재attach 된다
  };
  sock.onmessage = (e) => {
    try {
      handleMessage(JSON.parse(String(e.data)) as TermServerMsg);
    } catch {
      // 형식이 안 맞는 프레임은 무시
    }
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    ws = null;
    attachedId = null; // 재접속 시 재attach
    setStatus('연결 끊김 — 재연결 중…', false);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 5000); // 1→2→4→5초 백오프
  };
  sock.onerror = () => sock.close();
}

// ── 입력 ──

function updateCtrlUi() {
  ctrlBtn.classList.toggle('armed', ctrlArmed);
}

term.onData((data) => {
  if (ctrlArmed && data.length === 1) {
    ctrlArmed = false;
    updateCtrlUi();
    const code = data.toUpperCase().charCodeAt(0);
    if (code >= 64 && code < 96) {
      sendMsg({ type: 'input', data: String.fromCharCode(code - 64) }); // 예: c → ^C
      return;
    }
  }
  sendMsg({ type: 'input', data });
});
term.onResize(({ cols, rows }) => sendMsg({ type: 'resize', cols, rows }));

// 키바 — pointerdown preventDefault 로 xterm 포커스(=키보드)를 유지한 채 입력
const KEY_SEQ: Record<string, string> = {
  esc: '\x1b',
  tab: '\t',
  'shift-tab': '\x1b[Z',
  up: '\x1b[A',
  down: '\x1b[B',
  left: '\x1b[D',
  right: '\x1b[C',
  enter: '\r',
};
document.querySelectorAll<HTMLButtonElement>('#keybar button').forEach((btn) => {
  btn.addEventListener('pointerdown', (e) => e.preventDefault());
  btn.addEventListener('click', () => {
    const key = btn.dataset.key ?? '';
    if (key === 'ctrl') {
      ctrlArmed = !ctrlArmed;
      updateCtrlUi();
    } else if (key === 'paste') {
      void paste();
    } else if (KEY_SEQ[key]) {
      sendMsg({ type: 'input', data: KEY_SEQ[key] });
    }
    term.focus();
  });
});

/**
 * 클립보드 붙여넣기 — 폰에서 xterm 에 텍스트를 넣을 사실상 유일한 경로다
 * (터미널 위 길게 누르기로는 붙여넣기 메뉴가 나오지 않는다).
 * ⚠️ `navigator.clipboard` 는 secure context 에서만 존재한다 — MO 는 Tailscale
 *    인증서로 HTTPS 면 정상이고, 인증서가 없어 http 로 뜬 경우엔 여기서 걸린다.
 */
async function paste() {
  if (!navigator.clipboard?.readText) {
    notice('붙여넣기 불가 — HTTPS 접속에서만 됩니다');
    return;
  }
  try {
    const text = await navigator.clipboard.readText();
    if (!text) {
      notice('클립보드가 비어 있습니다');
      return;
    }
    sendMsg({ type: 'input', data: text });
  } catch {
    // iOS 는 사용자 제스처 안에서도 권한 거부가 날 수 있다
    notice('클립보드를 읽지 못했습니다');
  }
}

// 인증서가 없어 http 로 뜬 경우엔 클립보드 API 자체가 없다 — 눌러도 안 되는 버튼으로
// 키바 한 칸을 먹느니 감춘다(나머지 9개가 그만큼 넓어진다)
if (!navigator.clipboard?.readText) pasteBtn.hidden = true;

// 키바 표시는 뷰포트 높이(=키보드 유무)가 정하므로 여기서 포커스를 보지 않는다 —
// 아래 syncViewport 쪽 리스너가 resize 때마다 syncKeybar 를 부른다.

selectEl.addEventListener('change', () => {
  if (selectEl.value && selectEl.value !== attachedId) attach(selectEl.value);
});
// 바텀시트는 하나를 돌려 쓴다 — 작업 영역 트리 · 새 세션(위치→에이전트) · 프리셋.
// 좁은 화면이라 상시 UI 를 늘리지 않고 버튼 하나 + 시트로 처리한다(2026-08-08 사용자 요청).
type SheetMode = 'scope' | 'cwd' | 'agent' | 'preset' | null;
let sheetMode: SheetMode = null;
let pendingCwd: string | undefined;

function openSheet(mode: SheetMode, title: string) {
  sheetMode = mode;
  cwdTitle.textContent = title;
  cwdList.innerHTML = '';
  cwdSheet.hidden = false;
}

function closeSheet() {
  sheetMode = null;
  cwdSheet.hidden = true;
}

function sheetButton(
  label: string,
  sub: string | undefined,
  onPick: () => void,
  opts: { child?: boolean; on?: boolean; count?: number } = {}
) {
  const btn = document.createElement('button');
  btn.type = 'button';
  if (opts.child) btn.className = 'sheet-child';
  if (opts.on) btn.classList.add('on');
  // 세션 수는 라벨 오른쪽에 — 먼저 넣어야 float 가 첫 줄에 걸린다
  if (opts.count) {
    const cnt = document.createElement('span');
    cnt.className = 'sheet-count';
    cnt.textContent = `세션 ${opts.count}`;
    btn.appendChild(cnt);
  }
  btn.appendChild(document.createTextNode(label));
  if (sub) {
    const span = document.createElement('span');
    span.className = 'cwd-path';
    span.textContent = sub;
    btn.appendChild(span);
  }
  btn.addEventListener('click', onPick);
  cwdList.appendChild(btn);
}

function sheetGroup(label: string) {
  const div = document.createElement('div');
  div.className = 'sheet-group';
  div.textContent = label;
  cwdList.appendChild(div);
}

function sheetEmpty(label: string) {
  const div = document.createElement('div');
  div.className = 'sheet-empty';
  div.textContent = label;
  cwdList.appendChild(div);
}

// ── 작업 영역 (데스크톱 LNB 의 폰 판) ──

function pickScope(ws: TermWorkspaceNode, wt: TermWorktreeNode) {
  setScope({
    wsId: ws.id,
    wsName: ws.name,
    path: wt.path,
    name: wt.name,
    branch: wt.branch,
  });
  closeSheet();
  // 고른 영역에 세션이 있으면 바로 그 세션으로 옮겨 붙는다 — 영역만 바꾸고
  // 화면은 그대로면 무엇이 달라졌는지 알 수 없다
  const first = visibleSessions()[0];
  if (first && first.id !== attachedId) attach(first.id);
}

function renderScopeSheet() {
  cwdTitle.textContent = '작업 영역';
  cwdList.innerHTML = '';
  if (scope) {
    sheetButton('전체 세션 보기', '작업 영역 해제', () => {
      setScope(null);
      closeSheet();
    });
  }
  if (!workspaceTree.length) {
    sheetEmpty('워크스페이스가 없습니다 — 데스크톱에서 저장소를 등록하세요.');
    return;
  }
  for (const ws of workspaceTree) {
    sheetGroup(ws.name);
    if (!ws.worktrees.length) {
      sheetEmpty('워크트리가 없습니다');
      continue;
    }
    for (const wt of ws.worktrees) {
      const count = sessions.filter((s) => s.cwd === wt.path).length;
      sheetButton(wt.name, wt.branch, () => pickScope(ws, wt), {
        child: true,
        on: scope?.path === wt.path,
        count,
      });
    }
  }
}

navBtn.addEventListener('click', () => {
  sendMsg({ type: 'workspaces' }); // git 조회라 열 때마다 최신으로 (응답 오면 다시 그린다)
  openSheet('scope', '작업 영역');
  renderScopeSheet();
});

// ── 프리셋 (데스크톱 프리셋 바의 폰 판) ──

function renderPresetSheet() {
  cwdTitle.textContent = '프리셋';
  cwdList.innerHTML = '';
  // 스코프 필터는 데스크톱과 같은 판정을 공유한다(shared/types.ts)
  const list = presetsForWorkspace(presets, scope?.wsId ?? null);
  if (!list.length) {
    sheetEmpty(
      presets.length
        ? '이 작업 영역에 노출된 프리셋이 없습니다.'
        : '프리셋이 없습니다 — 데스크톱 터미널의 ⚙ 에서 추가하세요.'
    );
    return;
  }
  const where = scope ? `${scope.wsName} · ${scope.name}` : '홈 디렉터리';
  for (const p of list) {
    sheetButton(p.name, `${p.command}  →  ${where}`, () => {
      closeSheet();
      // 데스크톱과 같은 동작 — 그 위치의 **새 세션**에서 명령을 자동 실행한다.
      // agentId 태깅까지 같아야 입력 대기 알림·상태 휴리스틱이 폰에서도 붙는다.
      sendMsg({
        type: 'create',
        cwd: scope?.path,
        agentId: agentIdFromCommand(p.command),
        command: p.command,
        title: p.name,
      });
    });
  }
}

presetBtn.addEventListener('click', () => {
  sendMsg({ type: 'presets' }); // 데스크톱에서 방금 고쳤을 수 있으니 갱신
  openSheet('preset', '프리셋');
  renderPresetSheet();
});

// ── 새 세션 ──

function openCwdStep() {
  // 작업 영역이 잡혀 있으면 위치는 이미 정해졌다 — 위치 단계를 건너뛴다
  // (다른 곳에 열려면 ≡ 에서 영역을 바꾸거나 해제하면 된다)
  if (scope) {
    pickCwd(scope.path);
    return;
  }
  openSheet('cwd', '새 세션 위치');
  sheetButton('홈 디렉터리', undefined, () => pickCwd(undefined));
  for (const o of cwdOptions) sheetButton(o.name, o.path, () => pickCwd(o.path));
}

function pickCwd(path: string | undefined) {
  pendingCwd = path;
  const choices = agentOptions.filter((a) => a.installed);
  // 에이전트 목록이 없으면(구버전 서버·감지 실패) 고를 게 없다 — 바로 셸 세션
  if (choices.length <= 1) {
    createSession('shell');
    return;
  }
  openSheet('agent', '에이전트');
  for (const a of choices) {
    sheetButton(a.name, a.id === 'shell' ? '자동 실행 없음' : undefined, () =>
      createSession(a.id)
    );
  }
}

function createSession(agentId: TerminalAgentId) {
  closeSheet();
  // undefined 필드는 JSON 직렬화에서 빠진다 — 구버전 서버와도 호환
  sendMsg({ type: 'create', cwd: pendingCwd, agentId });
}

newBtn.addEventListener('click', () => {
  sendMsg({ type: 'cwds' }); // 최신 목록으로 갱신 (프로젝트가 추가됐을 수 있음)
  sendMsg({ type: 'agents' }); // 에이전트 설치 감지 결과도 함께
  openCwdStep();
});
cwdBackdrop.addEventListener('click', closeSheet);

// ── 터치 스크롤 ──
// 폰에서는 손가락 스크롤이 그냥은 먹지 않는다(터미널 텍스트 레이어가 덮고 있고,
// xterm 6 은 네이티브 스크롤 영역을 쓰지 않는다). 그래서 드래그를 **합성 휠 이벤트**로 바꿔
// xterm 에 그대로 넘긴다 — 데스크톱에서 휠을 돌린 것과 완전히 같은 경로가 된다:
//   · 일반 화면    → xterm 이 스크롤백을 스크롤
//   · 마우스 트래킹 켜진 TUI(claude 등) → xterm 이 마우스 이벤트로 인코딩해 앱에 전달
//     (claude 는 대체 화면이라 스크롤백이 없다 — scrollLines 를 부르면 아무 일도 안 일어난다)
const wheelTarget = () => termEl.querySelector<HTMLElement>('.xterm-screen') ?? termEl;

let dragY = 0;
let dragging = false;
let dragged = false; // 살짝 눌렀다 뗀 건 탭(포커스=키보드)으로 남긴다

// 두 손가락 핀치 = 글자 크기 (A－/A＋ 버튼을 대신한다 — 툴바 두 칸을 돌려받았다).
// 시작 시점의 손가락 간격·글자 크기를 기준으로 비율을 곱한다.
let pinchStart = 0;
let pinchStartFont = 0;

const touchDist = (t: TouchList) =>
  Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

termEl.addEventListener(
  'touchstart',
  (e) => {
    if (e.touches.length === 2) {
      dragging = false; // 스크롤 드래그와 겹치지 않게
      pinchStart = touchDist(e.touches);
      pinchStartFont = term.options.fontSize ?? FONT_MIN;
      return;
    }
    if (e.touches.length !== 1) return;
    dragY = e.touches[0].clientY;
    dragging = true;
    dragged = false;
  },
  { passive: true }
);

termEl.addEventListener(
  'touchmove',
  (e) => {
    if (e.touches.length === 2 && pinchStart > 0) {
      e.preventDefault();
      const ratio = touchDist(e.touches) / pinchStart;
      const next = Math.round(pinchStartFont * ratio);
      if (next !== term.options.fontSize) setFontSize(next);
      showFontHud();
      return;
    }
    if (!dragging || e.touches.length !== 1) return;
    const t = e.touches[0];
    const dy = dragY - t.clientY; // 손가락을 내리면 음수 = 위(과거) 내용
    dragY = t.clientY;
    if (!dragged && Math.abs(dy) < 4) return; // 탭과 구분되는 최소 이동
    dragged = true;
    e.preventDefault(); // 페이지가 대신 움직이지 않게
    // 좌표까지 실어 보낸다 — 마우스 트래킹 앱은 휠 이벤트의 행·열을 함께 보고한다
    wheelTarget().dispatchEvent(
      new WheelEvent('wheel', {
        deltaY: dy,
        deltaMode: 0, // 픽셀 단위
        clientX: t.clientX,
        clientY: t.clientY,
        bubbles: true,
        cancelable: true,
      })
    );
  },
  { passive: false }
);

termEl.addEventListener('touchend', (e) => {
  // 핀치 중이었으면 탭으로 오해해 키보드를 열지 않는다 (두 손가락을 뗄 때 touches 가 준다)
  if (pinchStart > 0) {
    if (e.touches.length === 0) pinchStart = 0;
    return;
  }
  dragging = false;
  if (!dragged) term.focus(); // 탭 = 키보드 열기
});

// 스크롤 위치에 따라 '맨 아래로' 버튼 노출 — 위로 올려 본 뒤 돌아올 방법
function syncBottomBtn() {
  const buf = term.buffer.active;
  bottomBtn.hidden = buf.viewportY >= buf.baseY;
}
term.onScroll(() => syncBottomBtn());
bottomBtn.addEventListener('pointerdown', (e) => e.preventDefault());
bottomBtn.addEventListener('click', () => {
  term.scrollToBottom();
  syncBottomBtn();
  term.focus();
});

// ── 글자 크기 (두 손가락 핀치) ──
function setFontSize(next: number) {
  const size = Math.min(FONT_MAX, Math.max(FONT_MIN, next));
  term.options.fontSize = size;
  localStorage.setItem(FONT_KEY, String(size));
  fit.fit(); // 열·행이 바뀌므로 PTY 도 따라온다(onResize)
}

// 조절 중에만 현재 크기를 띄운다 — 버튼이 없어져 값을 알 다른 방법이 없다
let hudTimer: ReturnType<typeof setTimeout> | null = null;
function showFontHud() {
  const size = term.options.fontSize ?? FONT_MIN;
  const limit = size <= FONT_MIN ? ' (최소)' : size >= FONT_MAX ? ' (최대)' : '';
  fontHud.textContent = `${size}px${limit}`;
  fontHud.hidden = false;
  if (hudTimer !== null) clearTimeout(hudTimer);
  hudTimer = setTimeout(() => {
    hudTimer = null;
    fontHud.hidden = true;
  }, 700);
}

setFontSize(term.options.fontSize ?? FONT_MIN);

// ── 뷰포트 — 소프트 키보드가 뜨면 실제 보이는 높이에 맞춰 레이아웃·PTY 를 줄인다 ──
// (iOS Safari·안드로이드 Chrome 모두 visual viewport 만 줄이는 게 기본이라 JS 로 맞춘다.
//  안드로이드는 index.html 의 interactive-widget=resizes-content 가 레이아웃까지 줄여 이중 보정)

function syncViewport() {
  // 레이아웃 뷰포트가 이미 줄어든 경우(resizes-content)는 둘 중 작은 값이 실제 가용 높이
  const h = viewportH();
  if (Number.isFinite(h)) document.body.style.height = `${Math.round(h)}px`;
  fit.fit();
}

/** 높이가 바뀌면 = 키보드가 뜨거나 닫혔을 수 있다 — 키바를 먼저 맞추고 레이아웃을 잡는다 */
function onViewportChange() {
  syncKeybar(); // 표시가 바뀌면 내부에서 syncViewport 까지 부른다
  syncViewport();
}
window.visualViewport?.addEventListener('resize', onViewportChange);
window.addEventListener('orientationchange', () => {
  // 회전하면 기준 높이 자체가 달라진다 — 다시 관측하게 리셋
  baseViewportH = 0;
  setTimeout(onViewportChange, 300);
});
window.addEventListener('resize', onViewportChange);

// 탭 슬립(잠금·앱 전환) 복귀 시 즉시 재연결
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !ws) {
    reconnectDelay = 1000;
    connect();
  }
});

renderScope(); // 저장된 작업 영역을 첫 페인트부터 반영 (세션 목록은 sessions 수신 때 그린다)
baseViewportH = viewportH(); // 첫 관측이 '키보드 없는 높이' 기준이 된다
syncKeybar(); // 고정 설정을 반영 — 기본(비고정)이면 키보드가 뜰 때까지 접혀 있다
connect();
