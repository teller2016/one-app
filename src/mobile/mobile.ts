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
  ChangedFile,
  ChangesDiffResult,
  ChangesPushResult,
  ChangesStatus,
  ChangesTarget,
  TerminalPreset,
  TerminalSessionInfo,
} from '../shared/types';
// 변경사항은 `/term` 이 아니라 **`/rpc`** 로 가져온다 — changes IPC 는 전 채널이
// handleShared 라 이미 폰에 열려 있고(그게 MO 화이트리스트 선언이다 — mo-app.md),
// 그 통로가 rpc 다. 프로토콜·서버를 건드리지 않으므로 로직 중복이 0 이다.
// shim 은 순수 브라우저 WS 클라이언트라 앱 셸과 그대로 공유한다.
import { call as rpcRawCall, startRpc } from '../mobile-app/shim/rpc';
import {
  TERMINAL_AGENT_NAMES,
  agentIdFromCommand,
  presetsForWorkspace,
} from '../shared/types';

// `/rpc` 소켓은 변경사항(±) 조회에만 쓴다 — 터미널만 보는 동안 상시 열어 두면 30초 ping
// 왕복이 배터리를 갉는다. 처음 필요할 때 열고, 그 뒤 재연결은 shim 이 맡는다.
let rpcStarted = false;
function rpcCall(channel: string, args: unknown[]): Promise<unknown> {
  if (!rpcStarted) {
    rpcStarted = true;
    startRpc();
  }
  return rpcRawCall(channel, args); // 연결 전 호출은 shim 의 큐가 받아 둔다
}

const LAST_SESSION_KEY = 'mo:lastSession';
// 선택한 작업 영역(워크트리) — 데스크톱 LNB 선택에 해당한다
const SCOPE_KEY = 'mo:scope';

// MO 전용 다크 팔레트 — 폰은 항상 다크다.
// ⚠️ 데스크톱(TerminalView 의 `buildTheme()`)은 `_base.scss` 토큰에서 읽으므로 여기와 다르다
// (전경·커서·white 계열이 이미 갈라져 있다). "같다"고 가정하고 한쪽만 고치지 말 것.
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
const closeBtn = document.getElementById('closeBtn') as HTMLButtonElement;
const changesBtn = document.getElementById('changesBtn') as HTMLButtonElement;
const chgView = document.getElementById('chgView') as HTMLElement;
const chgClose = document.getElementById('chgClose') as HTMLButtonElement;
const chgBranch = document.getElementById('chgBranch') as HTMLElement;
const chgAhead = document.getElementById('chgAhead') as HTMLElement;
const chgPush = document.getElementById('chgPush') as HTMLButtonElement;
const chgBody = document.getElementById('chgBody') as HTMLElement;
const scopeEl = document.getElementById('scope') as HTMLElement;
const newBtn = document.getElementById('newBtn') as HTMLButtonElement;
const waitBtn = document.getElementById('waitBtn') as HTMLButtonElement;
const waitCount = document.getElementById('waitCount') as HTMLElement;
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

// ⚠️ 폰 키보드의 **예측 입력(단어 조합)** 억제 — 안 하면 타이핑이 즉시 터미널로 가지
// 않고 스페이스로 단어를 확정해야 한 번에 들어간다(2026-08-08 사용자 지적).
// xterm 은 IME 조합 중에는 아무것도 보내지 않고 compositionend 에서 한 번에 보내는데,
// Gboard·삼성 키보드는 **영문도 단어 단위 조합**으로 처리하기 때문이다.
//
// xterm 이 거는 autocorrect/autocapitalize/spellcheck 만으로는 부족했으므로(그 상태에서
// 증상이 났다) `inputmode` 까지 바꾼다 — url 모드는 예측·자동완성을 끄는 게 규격상
// 의도된 동작이고, 터미널에 자주 쓰는 `/` 가 키보드에 노출되는 부수 이득도 있다.
// 한글 입력은 그대로 되지만(키보드 전환 가능) 스페이스바가 조금 좁아진다 —
// 실기기에서 불편하면 이 두 줄만 지우면 원래대로 돌아온다.
const ta = term.textarea;
if (ta) {
  ta.setAttribute('autocomplete', 'off'); // xterm 이 걸지 않는 유일한 항목
  ta.setAttribute('autocapitalize', 'none'); // xterm 은 'off' — 표준값은 'none'
  ta.setAttribute('inputmode', 'url');
}

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
// 주소창 표시/숨김(≈50px)과 구분되는 문턱 — 소프트 키보드는 이보다 훨씬 크게 줄인다
const KEYBOARD_MIN_DELTA = 120;
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

// 고정 토글(⌨)은 없앴다 — 키보드가 뜨면 키바도 따라 오므로 별도 버튼이 할 일이 없었고,
// 툴바만 복잡해졌다(2026-08-08 사용자 요청).
function syncKeybar() {
  const show = keyboardOpen();
  if (keybarEl.hidden === !show) return; // 변화 없으면 fit 을 돌리지 않는다
  keybarEl.hidden = !show;
  syncViewport(); // 높이가 바뀌었으니 PTY 행도 따라간다
}

// ── 입력 대기 세션 바로가기 ──
// 폰은 '자리를 비웠을 때 이어받는' 화면이라, 어떤 세션이 나를 기다리는지가 가장 중요한 정보다.
// 예전엔 select 를 열어야 글리프(●)가 보였다.
//
// ⚠️ **상태를 그대로 반영하면 버튼이 깜빡인다**(2026-08-08 사용자 지적) — claude 는 입력
// 대기 화면에서도 주기적으로 화면을 다시 그리고, 그 출력이 오는 순간 세션이 waiting→busy
// 로 내려갔다가 2.5 초 침묵 뒤 다시 waiting 이 된다(`pty.ts` noteOutput/statusTick,
// 실측 로그: `waiting→busy (output) bytes=1717` ↔ `busy→waiting (silence)`).
// 상태 판정 자체는 데스크톱 알림·뱃지가 함께 쓰므로 건드리지 않고, **표시만 안정화**한다:
// 생기면 즉시 띄우고, 사라지면 유예를 둔 뒤 그때도 없으면 숨긴다.
const WAIT_HIDE_GRACE_MS = 3000;
let waitHideTimer: ReturnType<typeof setTimeout> | null = null;
/** 마지막으로 관측한 대기 세션 — 유예 중(진동 구간)에 눌러도 이동이 되게 */
let lastWaitingIds: string[] = [];

function renderWaiting() {
  const waiting = sessions.filter((s) => s.status === 'waiting');

  if (waiting.length) {
    if (waitHideTimer !== null) {
      clearTimeout(waitHideTimer); // 숨기려던 참이었다면 취소
      waitHideTimer = null;
    }
    lastWaitingIds = waiting.map((s) => s.id);
    waitBtn.hidden = false;
    // ⚠️ textContent 로 덮으면 안의 SVG 가 날아간다 — 숫자는 겹치는 배지 span 에만 넣는다
    waitCount.textContent = String(waiting.length);
    waitBtn.setAttribute(
      'aria-label',
      `입력 대기 ${waiting.length}개 — 다음 대기 세션으로 이동`
    );
    return;
  }

  // 0 이 됐다 — 진동일 수 있으니 바로 숨기지 않는다
  if (waitBtn.hidden || waitHideTimer !== null) return;
  waitHideTimer = setTimeout(() => {
    waitHideTimer = null;
    if (sessions.some((s) => s.status === 'waiting')) return; // 그새 다시 대기
    waitBtn.hidden = true;
    lastWaitingIds = [];
  }, WAIT_HIDE_GRACE_MS);
}

waitBtn.addEventListener('click', () => {
  // 유예 중이면 지금 목록이 비어 있을 수 있다 — 마지막으로 본 대기 세션으로 간다.
  // (이게 없으면 버튼이 보이는데 눌러도 아무 일이 없는 순간이 생긴다)
  const now = sessions.filter((s) => s.status === 'waiting').map((s) => s.id);
  const pool = now.length
    ? now
    : lastWaitingIds.filter((id) => sessions.some((s) => s.id === id));
  if (!pool.length) return;
  // 이미 보고 있는 대기 세션 다음 것으로 — 여러 개면 눌러서 순회한다
  const cur = pool.indexOf(attachedId ?? '');
  const next = pool[(cur + 1) % pool.length];
  if (next !== attachedId) attach(next);
  term.focus();
});

// 상태 글리프 — <option> 은 스타일이 안 먹어 텍스트 글리프가 유일한 표현 수단
const STATUS_GLYPHS: Record<TerminalSessionInfo['status'], string> = {
  waiting: '●', // 입력 대기 — 주의 필요
  busy: '◐', // 작업 중
  idle: '○',
};

/** <option> 표시 문자열 — 상태 글리프 + 제목 + 에이전트 */
function optionLabel(s: TerminalSessionInfo): string {
  const glyph = STATUS_GLYPHS[s.status] ?? '○';
  const agent =
    s.agentId && s.agentId !== 'shell' ? ` (${TERMINAL_AGENT_NAMES[s.agentId]})` : '';
  return `${glyph} ${s.title}${agent}`;
}

/** 마지막으로 그린 목록 — 같은 내용이면 다시 그리지 않는다(아래 renderSessions) */
let lastSessionsSig = '';

function renderSessions() {
  const list = visibleSessions();
  // 보고 있는 세션이 작업 영역 밖이면(다른 영역에서 이어보는 중) 목록에도 남겨둔다 —
  // 없으면 select 가 엉뚱한 세션을 가리켜 손만 대도 화면이 바뀐다
  const attached = attachedId ? sessions.find((s) => s.id === attachedId) : null;
  const rows = list.map((s) => ({ value: s.id, label: optionLabel(s) }));
  if (attached && !list.some((s) => s.id === attached.id)) {
    rows.push({ value: attached.id, label: `${optionLabel(attached)} (다른 영역)` });
  }
  if (rows.length === 0) {
    rows.push({
      value: '',
      label: scope
        ? '이 작업 영역에 세션 없음 — ＋ 로 시작'
        : '세션 없음 — 새 세션을 만드세요',
    });
  }
  // 그릴 내용이 이전과 같으면 건너뛴다 — 세션 목록 브로드캐스트는 상태 전이마다(초 단위)
  // 오는데 대부분은 이 select 에 안 보이는 변화다(프로젝트 공통 규칙: 같으면 이전 유지)
  const sig = `${attachedId ?? ''}${rows
    .map((r) => `${r.value} ${r.label}`)
    .join('')}`;
  if (sig !== lastSessionsSig) {
    lastSessionsSig = sig;
    selectEl.innerHTML = '';
    for (const r of rows) {
      const opt = document.createElement('option');
      opt.value = r.value;
      opt.textContent = r.label;
      selectEl.appendChild(opt);
    }
    if (attachedId) selectEl.value = attachedId;
  }
  // 종료는 붙어 있는 세션이 있을 때만 — 없으면 누를 대상이 없다.
  // (변경사항 ± 은 작업 영역만 골라 둬도 볼 수 있어 항상 띄운다 — index.html 주석 참고)
  closeBtn.hidden = !attached;
}

// 현재 세션 종료 — 되돌릴 수 없으므로 한 번 더 묻는다(폰은 오터치가 잦다).
// 서버가 kill 후 sessions 브로드캐스트와 exit 를 보내므로 목록·화면은 알아서 따라온다.
closeBtn.addEventListener('click', () => {
  const s = attachedId ? sessions.find((x) => x.id === attachedId) : null;
  if (!s) return;
  if (!confirm(`'${s.title}' 세션을 종료할까요?`)) return;
  sendMsg({ type: 'kill', id: s.id });
});

/** attach 응답(`attached`)을 기다리는 세션 — 대기 중 같은 요청을 또 보내지 않는다 */
let pendingAttachId: string | null = null;

function attach(id: string) {
  // ⚠️ 응답 전에 sessions 브로드캐스트(상태 전이마다 온다)가 또 attach 를 부르면 같은
  // 세션에 두 번 붙어 term.reset()+replay+전체 리드로를 두 번 겪는다. 셀룰러·릴레이
  // 경로는 왕복이 수백 ms 라 실제로 겹친다.
  if (pendingAttachId === id) return;
  pendingAttachId = id;
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
    case 'workspaces':
      workspaceTree = msg.items;
      if (sheetMode === 'scope') renderScopeSheet(); // 열려 있으면 즉시 채운다
      break;
    case 'presets':
      presets = msg.items;
      // '무엇으로' 시트가 열려 있으면 목록을 다시 그린다(위치는 이미 골라 둔 상태)
      if (sheetMode === 'start') pickCwd(pendingCwd);
      break;
    case 'created':
      attach(msg.id);
      break;
    case 'attached':
      pendingAttachId = null;
      attachedId = msg.id;
      attachSeq = msg.seq;
      localStorage.setItem(LAST_SESSION_KEY, msg.id);
      term.reset();
      // 대체 화면(TUI) 세션은 replay 가 생략된다 — 전환 시퀀스를 합성해 xterm 의
      // buffer 타입을 실제 상태와 맞춘다(터치 스크롤의 방향키 변환 등이 이 판정을 쓴다)
      if (msg.alt) term.write('\x1b[?1049h');
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
        // 종료 코드를 함께 남긴다 — 방금 만든 세션이 곧바로 사라질 때 원인을 좁히는
        // 유일한 단서다(0=정상 종료 · 127=명령 없음 · 그 외=실행 실패).
        term.write(
          `\r\n\x1b[90m[세션이 종료되었습니다 — exit ${msg.exitCode}]\x1b[0m\r\n`
        );
        notice(`세션 종료 (exit ${msg.exitCode})`);
      }
      break;
    case 'error':
      // ⚠️ setStatus(_, false) 를 쓰면 안 된다 — 그 함수는 **연결 끊김**을 뜻해서
      //    ≡·＋·⚡·세션 select 를 전부 비활성화한다. attach 실패 한 번처럼 소켓과
      //    무관한 오류에도 폰 UI 가 통째로 잠겨 "아무것도 안 된다"가 된다
      //    (2026-08-08 프리셋 디버깅 중 발견). 연결은 멀쩡하므로 알림만 띄운다.
      pendingAttachId = null; // attach 실패였다면 다시 시도할 수 있어야 한다
      notice(msg.message);
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
    pendingAttachId = null; // 못 받은 응답을 기다리며 재attach 를 막으면 안 된다
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

/**
 * xterm 이 **터미널 능력 질의(DA)에 자동 응답**하는 시퀀스 — DA1 `ESC[?1;2c` · DA2 `ESC[>0;276;0c`.
 *
 * ⚠️ attach 할 때 tmux 가 클라이언트 능력을 물어보는데, 폰은 WS 왕복이 있어 응답이 늦게
 * 돌아온다. 그러면 tmux 가 그 응답을 자기 것으로 못 알아보고 **pane 으로 흘려보내** 셸이나
 * claude 의 입력이 된다 — 세션을 열 때마다 화면에 `^[[?1;2c^[[>0;276;0c` 가 찍혔다
 * (2026-08-08 사용자 지적). 데스크톱은 IPC 라 왕복이 빨라 tmux 가 제때 받아 문제가 없다.
 *
 * 이건 **사용자가 키보드로 칠 수 없는 입력**이므로 여기서 걸러도 잃는 것이 없다. 응답을
 * 못 받은 tmux 는 타임아웃 후 기본값을 쓰고, 색·기능은 어차피 conf 의 `terminal-features`
 * 가 명시한다. 키바의 esc(`\x1b` 한 글자)는 이 패턴에 걸리지 않는다.
 */
// (ESC 를 정규식 리터럴에 직접 쓰면 no-control-regex 에 걸려 문자열로 조립한다)
const DA_REPLY_RE = new RegExp(`${String.fromCharCode(27)}\\[[?>][0-9;]*c`, 'g');

function updateCtrlUi() {
  ctrlBtn.classList.toggle('armed', ctrlArmed);
}

term.onData((raw) => {
  const data = raw.replace(DA_REPLY_RE, '');
  if (!data) return; // 능력 응답뿐이었으면 아무것도 보내지 않는다
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
// PTY 리사이즈는 디바운스한다(데스크톱 TerminalView 와 같은 규칙) — 핀치 글자조절은
// touchmove 마다, iOS 키보드 애니메이션은 프레임마다 fit 을 부르는데, 그때마다 SIGWINCH 를
// 보내면 claude 같은 TUI 가 스텝 수만큼 전체 리렌더를 한다. 마지막 값만 보내면 한 번이다.
const PTY_RESIZE_DEBOUNCE_MS = 120;
let ptyResizeTimer: number | null = null;
term.onResize(({ cols, rows }) => {
  if (ptyResizeTimer !== null) window.clearTimeout(ptyResizeTimer);
  ptyResizeTimer = window.setTimeout(() => {
    ptyResizeTimer = null;
    sendMsg({ type: 'resize', cols, rows });
  }, PTY_RESIZE_DEBOUNCE_MS);
});

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
type SheetMode = 'scope' | 'cwd' | 'start' | null;
let sheetMode: SheetMode = null;
let pendingCwd: string | undefined;

// ── 안드로이드 뒤로가기로 오버레이 닫기 ──
// 폰에서 시트·전체화면이 떠 있을 때 뒤로가기를 누르면 **그 화면만 닫혀야** 하는데,
// 아무 처리가 없으면 페이지를 벗어나 앱 셸로 나가 버린다(2026-08-08 사용자 지적).
//
// 열 때 히스토리 항목을 하나 쌓고, **닫기는 언제나 `history.back()` 한 경로로 모은다** —
// 실제 DOM 을 숨기는 일은 `popstate` 에서만 한다. 그래야 뒤로가기로 닫든 UI 로 닫든
// 히스토리와 화면 상태가 어긋나지 않는다(닫을 때 back 을 빼먹으면 유령 항목이 쌓여
// 뒤로가기를 두 번 눌러야 나가게 된다).
function pushOverlayState() {
  history.pushState({ moOverlay: true }, '');
}

/** 실제로 화면을 숨기는 일 — popstate 에서만 부른다 */
function hideTopOverlay(): boolean {
  if (!chgView.hidden) {
    chgView.hidden = true;
    chgBody.innerHTML = ''; // 큰 diff 를 들고 있지 않게
    return true;
  }
  if (!cwdSheet.hidden) {
    sheetMode = null;
    cwdSheet.hidden = true;
    return true;
  }
  return false;
}

window.addEventListener('popstate', () => {
  hideTopOverlay();
});

function openSheet(mode: SheetMode, title: string) {
  if (cwdSheet.hidden) pushOverlayState(); // 이미 열린 시트를 갈아끼울 때는 쌓지 않는다
  sheetMode = mode;
  cwdTitle.textContent = title;
  cwdList.innerHTML = '';
  cwdSheet.hidden = false;
}

function closeSheet() {
  if (cwdSheet.hidden) return;
  // back 은 비동기라 그 사이 도착한 응답이 시트를 다시 그릴 수 있다 — 모드는 즉시 비운다
  sheetMode = null;
  history.back(); // popstate 가 실제로 닫는다
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

/**
 * 워크스페이스 헤더 — 눌러서 워크트리 목록을 접고 편다.
 * 레포가 여럿이면 워크트리까지 전부 펼쳐진 목록은 훑기가 어렵다(2026-08-08 사용자 지적).
 * 접혀 있어도 **세션 수**는 보여줘 어디가 살아 있는지 알 수 있게 한다.
 */
function sheetGroup(
  label: string,
  open: boolean,
  count: number,
  onToggle: () => void
) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'sheet-group';
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');

  const caret = document.createElement('span');
  caret.className = 'sheet-caret';
  caret.textContent = open ? '▾' : '▸';
  btn.appendChild(caret);

  const name = document.createElement('span');
  name.className = 'sheet-group-name';
  name.textContent = label;
  btn.appendChild(name);

  if (count) {
    const cnt = document.createElement('span');
    cnt.className = 'sheet-count';
    cnt.textContent = `세션 ${count}`;
    btn.appendChild(cnt);
  }

  btn.addEventListener('click', onToggle);
  cwdList.appendChild(btn);
}

function sheetEmpty(label: string) {
  const div = document.createElement('div');
  div.className = 'sheet-empty';
  div.textContent = label;
  cwdList.appendChild(div);
}

// ── 작업 영역 (데스크톱 LNB 의 폰 판) ──

/** 펼쳐 둔 워크스페이스 — 레포가 여럿이라 기본은 접힌 상태다(데스크톱 LNB 의 expanded 와 같은 개념) */
const WS_EXPANDED_KEY = 'mo:wsExpanded';
const expandedWs = new Set<string>(loadExpandedWs());

function loadExpandedWs(): string[] {
  try {
    const raw = localStorage.getItem(WS_EXPANDED_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function toggleWs(id: string) {
  if (expandedWs.has(id)) expandedWs.delete(id);
  else expandedWs.add(id);
  localStorage.setItem(WS_EXPANDED_KEY, JSON.stringify([...expandedWs]));
  renderScopeSheet();
}

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
    // 지금 고른 영역이 속한 레포는 자동으로 펼친다 — 시트를 다시 열었을 때 어디였는지 보이게
    const open = expandedWs.has(ws.id) || scope?.wsId === ws.id;
    const paths = new Set(ws.worktrees.map((w) => w.path));
    const wsCount = sessions.filter((s) => paths.has(s.cwd)).length;
    sheetGroup(ws.name, open, wsCount, () => toggleWs(ws.id));
    if (!open) continue;
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

// ── 변경사항 전체화면 (데스크톱 터미널 변경사항 드로어의 폰 판) ──
// ± 를 누르면 **바로 이 화면**이다 — 중간 목록 시트를 거치지 않는다(2026-08-08 사용자 요청).
// 파일 행을 탭하면 그 자리에서 diff 가 펼쳐져 스크롤 한 번으로 전체를 훑을 수 있다.
//
// ⚠️ 데이터는 `/term` 이 아니라 `/rpc` 로 가져온다 — changes IPC 는 전 채널이 handleShared 라
// 이미 폰에 열려 있고(그게 MO 화이트리스트 선언이다 — mo-app.md) 그 통로가 rpc 다.
// 폴링은 하지 않는다 — 버튼을 누를 때만 조회한다(폰 배터리).

/**
 * 대상 — **지금 작업 중인 영역**. 작업 영역(≡)을 골라 뒀으면 그 워크트리, 아니면 보고 있는
 * 세션의 위치다. 둘 다 없으면 볼 것이 없다.
 */
function changesTarget(): ChangesTarget | null {
  if (scope) return { workspaceId: scope.wsId, worktreePath: scope.path };
  if (attachedId) return { sessionId: attachedId };
  return null;
}

const KIND_GLYPH: Record<ChangedFile['kind'], string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  conflict: '!',
};

function chgEmpty(text: string) {
  chgBody.innerHTML = '';
  const div = document.createElement('div');
  div.className = 'chg-empty';
  div.textContent = text;
  chgBody.appendChild(div);
}

function closeChanges() {
  if (chgView.hidden) return;
  history.back(); // popstate 가 실제로 닫는다 (뒤로가기와 같은 경로 — 위 hideTopOverlay 참고)
}

async function openChanges() {
  const target = changesTarget();
  if (!target) {
    // 누를 대상이 없으면 조용히 넘어가지 말 것 — 사용자는 "버튼이 안 먹는다"로 느낀다
    notice('세션을 열거나 ≡ 에서 작업 영역을 고르세요');
    return;
  }
  chgBranch.textContent = scope ? `${scope.wsName} · ${scope.name}` : '';
  chgAhead.textContent = '';
  chgPush.hidden = true;
  chgEmpty('불러오는 중…');
  if (chgView.hidden) pushOverlayState(); // 뒤로가기로 닫을 수 있게
  chgView.hidden = false;
  try {
    const st = (await rpcCall('changes:status', [target, 'work'])) as ChangesStatus;
    if (chgView.hidden) return; // 그 사이 닫았으면 그리지 않는다
    renderChanges(st);
  } catch (err) {
    if (!chgView.hidden) chgEmpty(`불러오지 못했습니다 — ${(err as Error).message}`);
  }
}

function renderChanges(st: ChangesStatus) {
  if (!st.ok || !st.repo) {
    chgEmpty(st.error ?? 'git 저장소가 아닙니다.');
    return;
  }
  chgBranch.textContent = st.branch ?? '(detached)';

  // 안 푸시한 커밋 — upstream 이 없으면 아직 한 번도 push 안 한 브랜치(푸시는 -u 로, main 이 처리)
  const ahead = st.ahead ?? 0;
  const canPush = ahead > 0 || !st.upstream;
  chgAhead.textContent = !st.upstream ? '새 브랜치' : ahead > 0 ? `↑${ahead}` : '';
  chgPush.hidden = !canPush;
  chgPush.disabled = false;
  chgPush.textContent = '푸시';

  const files = st.files ?? [];
  chgBody.innerHTML = '';
  if (!files.length) {
    chgEmpty('변경된 파일이 없습니다.');
    return;
  }
  for (const f of files) chgFileRow(f, files.length === 1);
}

/** 파일 한 줄 + 그 아래 접힌 diff. 파일이 하나뿐이면 처음부터 펼쳐 바로 읽히게 한다 */
function chgFileRow(f: ChangedFile, autoOpen: boolean) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chg-file';

  const caret = document.createElement('span');
  caret.className = 'chg-caret';
  caret.textContent = '▸';
  btn.appendChild(caret);

  const kind = document.createElement('span');
  kind.className = 'chg-kind';
  kind.dataset.kind = f.kind;
  kind.textContent = KIND_GLYPH[f.kind] ?? '?';
  btn.appendChild(kind);

  const path = document.createElement('span');
  path.className = 'chg-path';
  // direction: rtl 이라 경로 앞이 잘린다 — 좌우 기호가 뒤집히지 않게 격리 문자로 감싼다
  path.textContent = `⁦${f.path}⁩`;
  btn.appendChild(path);

  if (f.additions != null || f.deletions != null) {
    const num = document.createElement('span');
    num.className = 'chg-num';
    const add = document.createElement('span');
    add.className = 'chg-add';
    add.textContent = `+${f.additions ?? 0}`;
    num.appendChild(add);
    const del = document.createElement('span');
    del.className = 'chg-del';
    del.textContent = `−${f.deletions ?? 0}`;
    num.appendChild(del);
    btn.appendChild(num);
  }

  const pre = document.createElement('pre');
  pre.className = 'chg-diff';
  pre.hidden = true;

  let loaded = false;
  const toggle = () => {
    const open = pre.hidden;
    pre.hidden = !open;
    caret.textContent = open ? '▾' : '▸';
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open && !loaded) {
      loaded = true;
      void loadDiff(f, pre);
    }
  };
  btn.addEventListener('click', toggle);

  chgBody.appendChild(btn);
  chgBody.appendChild(pre);
  if (autoOpen) toggle();
}

async function loadDiff(f: ChangedFile, pre: HTMLElement) {
  const target = changesTarget();
  if (!target) return;
  pre.textContent = '불러오는 중…';
  try {
    const res = (await rpcCall('changes:diff', [
      target,
      { path: f.path, origPath: f.origPath, untracked: f.untracked },
    ])) as ChangesDiffResult;
    if (!res.ok) {
      pre.textContent = res.error ?? 'diff 를 불러오지 못했습니다.';
      return;
    }
    if (res.binary) {
      pre.textContent = '(바이너리 파일)';
      return;
    }
    paintDiff(pre, res.diff ?? '', res.truncated === true);
  } catch (err) {
    pre.textContent = `불러오지 못했습니다 — ${(err as Error).message}`;
  }
}

// 한 번에 그리는 줄 수 — 서버 상한(512KB ≈ 1만 줄)을 통째로 DOM 화하면 폰이 멈춘다.
// 데스크톱도 같은 이유로 청크 렌더를 쓴다(UnifiedDiff 1200줄).
const DIFF_CHUNK_LINES = 1000;

/** unified diff 색칠 — 줄 단위로 +/-/@@ 만 구분한다(폰에서 과한 하이라이트는 오히려 안 읽힌다) */
function paintDiff(pre: HTMLElement, diff: string, truncated: boolean) {
  pre.textContent = '';
  const lines = diff.split('\n');
  let shown = 0;

  const moreBtn = document.createElement('button');
  moreBtn.type = 'button';
  moreBtn.className = 'd-more';
  moreBtn.addEventListener('click', () => drawChunk());

  const drawChunk = () => {
    moreBtn.remove(); // 다음 청크 뒤로 다시 붙인다
    const end = Math.min(lines.length, shown + DIFF_CHUNK_LINES);
    const frag = document.createDocumentFragment();
    for (let i = shown; i < end; i++) {
      const line = lines[i];
      const span = document.createElement('span');
      if (line.startsWith('@@')) span.className = 'd-hunk';
      else if (line.startsWith('+++') || line.startsWith('---')) span.className = 'd-meta';
      else if (line.startsWith('+')) span.className = 'd-add';
      else if (line.startsWith('-')) span.className = 'd-del';
      else if (line.startsWith('diff ') || line.startsWith('index '))
        span.className = 'd-meta';
      span.textContent = `${line}\n`;
      frag.appendChild(span);
    }
    shown = end;
    pre.appendChild(frag);
    if (shown < lines.length) {
      moreBtn.textContent = `··· ${lines.length - shown}줄 더 보기`;
      pre.appendChild(moreBtn);
      return;
    }
    if (truncated) {
      const note = document.createElement('span');
      note.className = 'd-meta';
      note.textContent = '\n(표시 상한을 넘어 잘렸습니다 — 데스크톱에서 전체를 보세요)\n';
      pre.appendChild(note);
    }
  };

  drawChunk();
}

chgPush.addEventListener('click', () => void doPush());

async function doPush() {
  const target = changesTarget();
  if (!target) return;
  if (!confirm(`'${chgBranch.textContent ?? ''}' 를 푸시할까요?`)) return;
  chgPush.disabled = true;
  chgPush.textContent = '푸시 중…';
  try {
    const res = (await rpcCall('changes:push', [target])) as ChangesPushResult;
    if (res.ok) {
      notice('푸시 완료');
      void openChanges(); // ahead 가 0 이 됐으니 다시 그린다
    } else {
      // 실패 사유는 git 출력 tail 에 들어 있다 — 그대로 보여주는 게 가장 정확하다
      notice(res.error ?? res.output ?? '푸시 실패');
      chgPush.disabled = false;
      chgPush.textContent = '푸시';
    }
  } catch (err) {
    notice(`푸시 실패 — ${(err as Error).message}`);
    chgPush.disabled = false;
    chgPush.textContent = '푸시';
  }
}

chgClose.addEventListener('click', closeChanges);
changesBtn.addEventListener('click', () => void openChanges());

// ── 새 세션 = 위치 → 무엇으로 (셸 + 프리셋) ──
// 예전엔 ⚡ 프리셋 버튼이 따로 있었고 ＋ 는 에이전트(셸·claude·femc)를 물었는데, 결국
// "무엇으로 시작할까"라는 같은 질문이라 하나로 합쳤다(2026-08-08 사용자 요청).
// 에이전트 목록 대신 **셸 + 사용자가 설정한 프리셋**을 보여준다 — claude·FEMC 도 프리셋에
// 있으므로 목록이 겹치지 않고, 프리셋마다 붙여 둔 옵션(`--dangerously-skip-permissions` 등)이
// 그대로 살아난다.

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
  openSheet('start', '무엇으로 시작할까요');
  sheetButton('셸', '자동 실행 없음', () => startShell());

  // 스코프 필터는 데스크톱과 같은 판정을 공유한다(shared/types.ts).
  // ⚠️ 위치를 직접 고른 경우엔 워크스페이스를 알 수 없어 전역 프리셋만 나온다 —
  //    레포 전용 프리셋을 쓰려면 ≡ 에서 작업 영역을 고르면 된다.
  const wsId = scope && scope.path === path ? scope.wsId : null;
  const list = presetsForWorkspace(presets, wsId);
  for (const p of list) sheetButton(p.name, p.command, () => startPreset(p));

  if (!list.length) {
    sheetEmpty(
      presets.length
        ? '이 위치에 노출된 프리셋이 없습니다 — ≡ 에서 작업 영역을 고르면 그 레포 프리셋이 보입니다.'
        : '프리셋이 없습니다 — 데스크톱 터미널의 ⚙ 에서 추가하세요.'
    );
  }
}

/** 공통 생성 인자 — cols/rows 는 attach 리사이즈로 자동 실행이 깨지지 않게 항상 실어 보낸다 */
const createBase = () => ({
  cwd: pendingCwd,
  cols: term.cols,
  rows: term.rows,
});

function startShell() {
  closeSheet();
  // undefined 필드는 JSON 직렬화에서 빠진다 — 구버전 서버와도 호환
  sendMsg({ type: 'create', ...createBase(), agentId: 'shell' });
}

function startPreset(p: TerminalPreset) {
  closeSheet();
  // 데스크톱 프리셋 칩과 같은 동작 — 그 위치의 새 세션에서 명령을 자동 실행한다.
  // agentId 태깅까지 같아야 입력 대기 알림·상태 휴리스틱이 폰에서도 붙는다.
  sendMsg({
    type: 'create',
    ...createBase(),
    agentId: agentIdFromCommand(p.command),
    command: p.command,
    title: p.name,
  });
}

newBtn.addEventListener('click', () => {
  sendMsg({ type: 'cwds' }); // 최신 목록으로 갱신 (프로젝트가 추가됐을 수 있음)
  sendMsg({ type: 'presets' }); // 데스크톱에서 방금 고쳤을 수 있으니 함께 갱신
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
// `.xterm-screen` 은 term.open() 이후 바뀌지 않는다 — touchmove 마다 다시 찾을 이유가 없다
let wheelTargetEl: HTMLElement | null = null;
const wheelTarget = () =>
  (wheelTargetEl ??= termEl.querySelector<HTMLElement>('.xterm-screen')) ?? termEl;

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
