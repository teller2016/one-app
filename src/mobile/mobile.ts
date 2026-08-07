// 모바일(MO) 터미널 — One App 메인 프로세스의 WS 브리지(/term)에 붙어
// 데스크톱과 같은 PTY 세션을 이어서 쓴다. 재접속 = 재attach = replay 복원.
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import './mobile.css';
import type {
  TermClientMsg,
  TermCwdOption,
  TermServerMsg,
} from '../shared/terminal-protocol';
import type {
  TerminalAgentId,
  TerminalAgentInfo,
  TerminalSessionInfo,
} from '../shared/types';
import { TERMINAL_AGENT_NAMES } from '../shared/types';

const LAST_SESSION_KEY = 'mo:lastSession';

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
const newBtn = document.getElementById('newBtn') as HTMLButtonElement;
const ctrlBtn = document.getElementById('ctrlBtn') as HTMLButtonElement;
const fontDownBtn = document.getElementById('fontDown') as HTMLButtonElement;
const fontUpBtn = document.getElementById('fontUp') as HTMLButtonElement;
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
// 키우는 건 A＋ 로 바로 되지만 잘려 있으면 무엇을 키워야 할지조차 안 보인다.
const FONT_KEY = 'mo:fontSize';
const FONT_MIN = 6;
const FONT_MAX = 22;
const initialFont = Number(localStorage.getItem(FONT_KEY)) || FONT_MIN;

const term = new Terminal({
  fontSize: Math.min(FONT_MAX, Math.max(FONT_MIN, initialFont)),
  lineHeight: 1.25,
  cursorBlink: true,
  scrollback: 3000,
  theme: TERM_THEME,
});
const fit = new FitAddon();
term.loadAddon(fit);
term.open(termEl);
fit.fit();

let ws: WebSocket | null = null;
let attachedId: string | null = null;
let attachSeq = 0; // 이 값 이하의 data 는 replay 에 이미 포함 — 버린다
let sessions: TerminalSessionInfo[] = [];
let cwdOptions: TermCwdOption[] = []; // 새 세션 위치 후보 (서버가 프로젝트 레지스트리에서 보내줌)
let agentOptions: TerminalAgentInfo[] = []; // 에이전트 후보 (설치 감지 포함)
let reconnectDelay = 1000;
let ctrlArmed = false; // ctrl 키바 토글 — 다음 한 글자를 제어문자로

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
  selectEl.disabled = !ok;
}

// 상태 글리프 — <option> 은 스타일이 안 먹어 텍스트 글리프가 유일한 표현 수단
const STATUS_GLYPHS: Record<TerminalSessionInfo['status'], string> = {
  waiting: '●', // 입력 대기 — 주의 필요
  busy: '◐', // 작업 중
  idle: '○',
};

function renderSessions() {
  selectEl.innerHTML = '';
  for (const s of sessions) {
    const opt = document.createElement('option');
    opt.value = s.id;
    const glyph = STATUS_GLYPHS[s.status] ?? '○';
    const agent = s.agentId && s.agentId !== 'shell' ? ` (${TERMINAL_AGENT_NAMES[s.agentId]})` : '';
    opt.textContent = `${glyph} ${s.title}${agent}`;
    selectEl.appendChild(opt);
  }
  if (!sessions.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '세션 없음 — 새 세션을 만드세요';
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
      if (!attachedId && sessions.length) {
        const last = localStorage.getItem(LAST_SESSION_KEY);
        attach(sessions.find((s) => s.id === last)?.id ?? sessions[0].id);
      }
      break;
    case 'cwds':
      cwdOptions = msg.items;
      break;
    case 'agents':
      agentOptions = msg.items;
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
    } else if (KEY_SEQ[key]) {
      sendMsg({ type: 'input', data: KEY_SEQ[key] });
    }
    term.focus();
  });
});

selectEl.addEventListener('change', () => {
  if (selectEl.value && selectEl.value !== attachedId) attach(selectEl.value);
});
// 새 세션 — 같은 시트에서 ①위치 → ②에이전트 순으로 고른다 (둘 다 데스크톱과 같은 출처)
let pendingCwd: string | undefined;

function sheetButton(label: string, sub: string | undefined, onPick: () => void) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  if (sub) {
    const span = document.createElement('span');
    span.className = 'cwd-path';
    span.textContent = sub;
    btn.appendChild(span);
  }
  btn.addEventListener('click', onPick);
  cwdList.appendChild(btn);
}

function openCwdStep() {
  cwdTitle.textContent = '새 세션 위치';
  cwdList.innerHTML = '';
  sheetButton('홈 디렉터리', undefined, () => pickCwd(undefined));
  for (const o of cwdOptions) sheetButton(o.name, o.path, () => pickCwd(o.path));
  cwdSheet.hidden = false;
}

function pickCwd(path: string | undefined) {
  pendingCwd = path;
  const choices = agentOptions.filter((a) => a.installed);
  // 에이전트 목록이 없으면(구버전 서버·감지 실패) 고를 게 없다 — 바로 셸 세션
  if (choices.length <= 1) {
    createSession('shell');
    return;
  }
  cwdTitle.textContent = '에이전트';
  cwdList.innerHTML = '';
  for (const a of choices) {
    sheetButton(a.name, a.id === 'shell' ? '자동 실행 없음' : undefined, () =>
      createSession(a.id)
    );
  }
}

function createSession(agentId: TerminalAgentId) {
  cwdSheet.hidden = true;
  // undefined 필드는 JSON 직렬화에서 빠진다 — 구버전 서버와도 호환
  sendMsg({ type: 'create', cwd: pendingCwd, agentId });
}

newBtn.addEventListener('click', () => {
  sendMsg({ type: 'cwds' }); // 최신 목록으로 갱신 (프로젝트가 추가됐을 수 있음)
  sendMsg({ type: 'agents' }); // 에이전트 설치 감지 결과도 함께
  openCwdStep();
});
cwdBackdrop.addEventListener('click', () => {
  cwdSheet.hidden = true;
});

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

termEl.addEventListener(
  'touchstart',
  (e) => {
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

termEl.addEventListener('touchend', () => {
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

// ── 글자 크기 ──
function setFontSize(next: number) {
  const size = Math.min(FONT_MAX, Math.max(FONT_MIN, next));
  term.options.fontSize = size;
  localStorage.setItem(FONT_KEY, String(size));
  fontDownBtn.disabled = size <= FONT_MIN;
  fontUpBtn.disabled = size >= FONT_MAX;
  fit.fit(); // 열·행이 바뀌므로 PTY 도 따라온다(onResize)
}
fontDownBtn.addEventListener('pointerdown', (e) => e.preventDefault());
fontUpBtn.addEventListener('pointerdown', (e) => e.preventDefault());
fontDownBtn.addEventListener('click', () => setFontSize((term.options.fontSize ?? 15) - 1));
fontUpBtn.addEventListener('click', () => setFontSize((term.options.fontSize ?? 15) + 1));
setFontSize(term.options.fontSize ?? 15);

// ── 뷰포트 — 소프트 키보드가 뜨면 실제 보이는 높이에 맞춰 레이아웃·PTY 를 줄인다 ──
// (iOS Safari·안드로이드 Chrome 모두 visual viewport 만 줄이는 게 기본이라 JS 로 맞춘다.
//  안드로이드는 index.html 의 interactive-widget=resizes-content 가 레이아웃까지 줄여 이중 보정)

function syncViewport() {
  // 레이아웃 뷰포트가 이미 줄어든 경우(resizes-content)는 둘 중 작은 값이 실제 가용 높이
  const vv = window.visualViewport?.height;
  const h = Math.min(vv ?? Infinity, window.innerHeight || Infinity);
  if (Number.isFinite(h)) document.body.style.height = `${Math.round(h)}px`;
  fit.fit();
}
window.visualViewport?.addEventListener('resize', syncViewport);
window.addEventListener('orientationchange', () => setTimeout(syncViewport, 300));
window.addEventListener('resize', syncViewport);

// 탭 슬립(잠금·앱 전환) 복귀 시 즉시 재연결
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !ws) {
    reconnectDelay = 1000;
    connect();
  }
});

connect();
