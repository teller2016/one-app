// MO 터미널 컨트롤러 — One App 메인 프로세스의 WS 브리지(/term)에 붙어 데스크톱과 같은 PTY
// 세션을 이어서 쓴다. 재접속 = 재attach = replay 복원.
//
// React 밖의 싱글턴이다 — xterm 인스턴스·소켓·타이머는 탭을 오가도 살아 있어야 한다(셸이 터미널
// 탭을 keep-alive 로 숨긴다). 화면(MoTerminalTab)은 `subscribe`/`getState` 로 상태만 그린다.
//
// 옛 `src/mobile/mobile.ts`(별도 페이지)를 옮겼다 — 함정 주석은 그 자리의 것을 그대로 가져왔다.
// 순수 판정은 `logic.ts`(단위 테스트).
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import type {
  TermClientMsg,
  TermCwdOption,
  TermServerMsg,
  TermWorkspaceNode,
} from '../../shared/terminal-protocol';
import type { TerminalPreset, TerminalSessionInfo } from '../../shared/types';
import { TERMINAL_AGENT_NAMES, agentIdFromCommand } from '../../shared/types';
import {
  KEYBOARD_MIN_DELTA,
  KEY_SEQ,
  StableWaiting,
  applyModifiers,
  pickAutoAttach,
  stripDaReplies,
  visibleSessions,
  type KeyName,
  type Modifiers,
} from './logic';

const LAST_SESSION_KEY = 'mo:lastSession';
// 선택한 작업 영역(워크트리) — 데스크톱 LNB 선택에 해당한다
const SCOPE_KEY = 'mo:scope';
const WS_EXPANDED_KEY = 'mo:wsExpanded';
const NOTIFY_DISMISS_KEY = 'mo:notifyBarDismissed';

// 글자 크기 — 폰 화면·시야에 따라 편차가 커서 사용자가 조절하고 기억한다.
// 기본 11px — 예전 기본(최소 6px)은 넓은 TUI 를 통째로 보려는 값이었지만 읽기엔 너무 작았다
// (2026-10-01 리디자인 목업 값). 핀치·세션 메뉴 [A− A+] 로 바꾼다.
const FONT_KEY = 'mo:fontSize';
export const FONT_MIN = 6;
export const FONT_MAX = 22;
const FONT_DEFAULT = 11;

/** 선택한 작업 영역 — null 이면 전체 세션을 보여준다(처음 켠 폰·해제했을 때) */
export type MoScope = {
  wsId: string;
  wsName: string;
  /** 타일 색 번호 — 작업 영역 노드의 color (없으면 이름 해시) */
  wsColor?: number;
  path: string;
  name: string;
  branch?: string;
};

export type MoTermState = {
  connected: boolean;
  /** 연결 상태 문구 — '연결 중…' · '연결 끊김 — 재연결 중…' · '연결됨' */
  statusText: string;
  sessions: TerminalSessionInfo[];
  attachedId: string | null;
  scope: MoScope | null;
  workspaces: TermWorkspaceNode[];
  /** 펼쳐 둔 워크스페이스 id */
  expandedWs: string[];
  cwds: TermCwdOption[];
  presets: TerminalPreset[];
  /** 입력 대기 — 안정화된 집합(logic.ts StableWaiting) */
  waiting: string[];
  mods: Modifiers;
  fontSize: number;
  /** 소프트 키보드가 떠 있다(뷰포트 높이 판정) */
  kbdOpen: boolean;
  /** 위로 올려 보는 중 — [맨 아래로] 노출 */
  scrolledUp: boolean;
  /** 알림 권한 안내 띠 */
  notifyBar: boolean;
  notifySupported: boolean;
  notifyGranted: boolean;
  /** 붙여넣기 가능(secure context 의 clipboard.readText) */
  canPaste: boolean;
  /** 출력 선택 모드 — 드래그가 스크롤 대신 줄 선택이 된다 */
  selecting: boolean;
  selectedLines: number;
  /** 핀치 중 잠깐 보이는 현재 글자 크기 */
  fontHud: number | null;
};

type Listener = () => void;

const readJson = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback; // 형식이 깨졌으면 기본값
  }
};

const cssVar = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/**
 * 터미널 색 — 데스크톱 TerminalView 의 buildTheme 과 **같은 토큰**(다크 패널 on-dark 계열)에서 읽는다.
 * 폰은 이제 앱 셸 테마(라이트/다크)를 따르고, 터미널 면은 두 테마 모두 `--surface-dark` 다.
 * 마젠타·시안·bright 일부는 대응 토큰이 없어 데스크톱과 같은 값을 쓴다.
 */
const buildTheme = () => ({
  // 배경은 패널 CSS(--surface-dark)에 맡긴다 — 칸 단위로 맞추고 남는 오른쪽·아래 자리가 다른 톤의 띠로 보였다
  // (2026-10-01 /test). 데스크톱 TerminalView 와 같은 방식 — 'transparent' 는 xterm 이 못 읽어 검정이 된다
  background: 'rgba(0, 0, 0, 0)',
  foreground: cssVar('--on-dark-2'),
  cursor: cssVar('--on-dark'),
  cursorAccent: cssVar('--surface-dark'),
  selectionBackground: 'rgba(140, 155, 255, 0.35)', // --accent-on-dark 틴트
  black: cssVar('--border-dark'),
  red: cssVar('--danger-on-dark'),
  green: cssVar('--ok-on-dark'),
  yellow: cssVar('--warning-on-dark'),
  magenta: '#ff7ab6',
  cyan: '#5ac8fa',
  blue: cssVar('--accent-on-dark'),
  white: cssVar('--on-dark-2'),
  brightBlack: cssVar('--on-dark-3'),
  brightRed: '#ff8a80',
  brightGreen: '#66d97e',
  brightYellow: '#ffe23f',
  brightMagenta: '#ff9ac9',
  brightCyan: '#8fdcff',
  brightBlue: cssVar('--accent-hover-on-dark'),
  brightWhite: cssVar('--on-dark'),
});

/** #RRGGBB 두 색을 비율로 섞는다 — 검색 하이라이트는 알파를 못 받아 미리 합성한다(데스크톱과 같은 방식) */
const mixHex = (fg: string, bg: string, ratio: number) => {
  const parse = (h: string) => {
    const v = parseInt(h.replace('#', ''), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  };
  const a = parse(fg);
  const b = parse(bg);
  return `#${a
    .map((x, i) =>
      Math.round(x * ratio + b[i] * (1 - ratio))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
};

const searchDecorations = () => {
  const accent = cssVar('--accent-on-dark') || '#8c9bff';
  const surface = cssVar('--surface-dark') || '#08090b';
  return {
    matchBackground: mixHex(accent, surface, 0.22),
    activeMatchBackground: mixHex(accent, surface, 0.85),
    matchOverviewRuler: cssVar('--on-dark-3'),
    activeMatchColorOverviewRuler: accent,
  };
};

const notifySupported = () =>
  window.isSecureContext && 'Notification' in window && 'serviceWorker' in navigator;

// 주소창의 `?session=` — 폰 알림을 눌러 들어온 경우 SW 가 붙여 준 '먼저 보여줄 세션'이다.
// ⚠️ 모듈 평가 시점에 읽는다 — main.tsx 가 토큰 쿼리를 지우면서 이 값까지 지우기 전이다
// (import 는 main.tsx 본문보다 먼저 평가된다). 여기서도 읽은 뒤 지운다.
const initialFocus = new URLSearchParams(location.search).get('session');

class MoTerminalController {
  private term: Terminal | null = null;
  private fit: FitAddon | null = null;
  private search: SearchAddon | null = null;
  private hostEl: HTMLElement | null = null;
  private ws: WebSocket | null = null;
  private reconnectDelay = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attachSeq = 0; // 이 값 이하의 data 는 replay 에 이미 포함 — 버린다
  /** attach 응답(`attached`)을 기다리는 세션 — 대기 중 같은 요청을 또 보내지 않는다 */
  private pendingAttachId: string | null = null;
  private pendingFocusId: string | null = initialFocus;
  private tmuxBackend = false; // 지금 보는 세션이 tmux 백엔드인가 (스크롤 위임의 전제)
  private serverScrolledUp = false; // tmux copy-mode 로 올라가 있는가
  private active = true; // 셸이 터미널 탭을 보이는 중인가
  private started = false;
  private baseViewportH = 0;
  private listeners = new Set<Listener>();
  private noticeListeners = new Set<(text: string) => void>();
  private stable = new StableWaiting(3000, () => this.onWaitingChanged([]));
  private state: MoTermState;

  constructor() {
    const font = Number(localStorage.getItem(FONT_KEY)) || FONT_DEFAULT;
    this.state = {
      connected: false,
      statusText: '연결 중…',
      sessions: [],
      attachedId: null,
      scope: readJson<MoScope | null>(SCOPE_KEY, null),
      workspaces: [],
      expandedWs: readJson<string[]>(WS_EXPANDED_KEY, []),
      cwds: [],
      presets: [],
      waiting: [],
      mods: { ctrl: false, alt: false },
      fontSize: Math.min(FONT_MAX, Math.max(FONT_MIN, font)),
      kbdOpen: false,
      scrolledUp: false,
      notifyBar: false,
      notifySupported: notifySupported(),
      notifyGranted: notifySupported() && Notification.permission === 'granted',
      canPaste: !!navigator.clipboard?.readText,
      selecting: false,
      selectedLines: 0,
      fontHud: null,
    };
  }

  // ── 구독 ──

  subscribe = (fn: Listener) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getState = () => this.state;

  /** 안내 한 줄 — 화면이 토스트로 띄운다(옛 페이지는 상태 칸을 2.2초 빌렸다) */
  onNotice(fn: (text: string) => void) {
    this.noticeListeners.add(fn);
    return () => {
      this.noticeListeners.delete(fn);
    };
  }

  private notice(text: string) {
    this.noticeListeners.forEach((fn) => fn(text));
  }

  private focusListeners = new Set<() => void>();
  /** 알림을 눌러 들어왔다 — 셸이 다른 탭에 있으면 터미널 탭으로 돌아와야 한다 */
  onFocusRequest(fn: () => void) {
    this.focusListeners.add(fn);
    return () => {
      this.focusListeners.delete(fn);
    };
  }

  private set(patch: Partial<MoTermState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }

  // ── 수명 ──

  /** 처음 한 번 — 소켓·전역 리스너를 연다 (화면 마운트와 무관하게 살아 있다) */
  start() {
    if (this.started) return;
    this.started = true;
    if (location.search.includes('session=')) history.replaceState(null, '', location.pathname);
    if (this.state.notifySupported) {
      navigator.serviceWorker.addEventListener('message', (e: MessageEvent) => {
        const data = e.data as { type?: string; id?: string } | null;
        if (data?.type === 'focus-session' && data.id) this.focusSession(data.id);
      });
      if (Notification.permission === 'granted') void this.ensureSw(); // 이미 허용한 폰 — 워커를 미리
    }
    window.visualViewport?.addEventListener('resize', this.onViewportChange);
    window.addEventListener('resize', this.onViewportChange);
    window.addEventListener('orientationchange', () => {
      // 회전하면 기준 높이 자체가 달라진다 — 다시 관측하게 리셋
      this.baseViewportH = 0;
      setTimeout(this.onViewportChange, 300);
    });
    // 탭 슬립(잠금·앱 전환) 복귀 시 즉시 재연결
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        if (!this.ws) {
          this.reconnectDelay = 1000;
          this.connect();
        }
        // 돌아왔다 — 탭바 배지가 보이므로 트레이의 알림은 걷는다
        void this.closeNotificationsFor(() => true);
      }
      this.syncWakeLock();
    });
    this.baseViewportH = this.viewportH();
    this.syncNotifyBar();
    this.syncViewport();
    this.connect();
  }

  /** xterm 을 호스트 요소에 붙인다 — 화면이 처음 마운트될 때. 이후 재마운트면 같은 인스턴스를 옮긴다 */
  mount(el: HTMLElement) {
    this.hostEl = el;
    if (this.term) {
      const node = this.term.element;
      if (node && node.parentElement !== el) el.appendChild(node);
      this.refit();
      return;
    }
    const term = new Terminal({
      fontSize: this.state.fontSize,
      // 데스크톱과 같은 번들 폰트(_base.scss @font-face) — 기기 기본 monospace 는 폰마다 자폭·줄높이가
      // 달라 박스 드로잉과 커서가 어긋났다
      fontFamily: "'JetBrains Mono NL', ui-monospace, Menlo, monospace",
      // ⚠️ xterm 의 lineHeight 는 **폰트의 자연 줄높이**에 곱해진다 — 이 폰트는 1.346 배라 1.25 면
      // 행간이 크게 벌어져 폰의 보이는 행 수까지 줄었다. 1.0 이 최소값이다(xterm 은 1 미만 거부)
      lineHeight: 1.0,
      cursorBlink: true,
      scrollback: 3000,
      // ⚠️ Unicode11Addon 이 쓰는 term.unicode 는 proposed API — 없으면 addon load 가 throw 한다
      allowProposedApi: true,
      allowTransparency: true, // 배경을 패널 CSS 에 맡긴다 (buildTheme 주석 참고)
      theme: buildTheme(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    // 한글·이모지 셀 폭을 최신 규격으로 — 없으면 CJK 가 한 칸으로 계산돼 TUI 표가 밀린다
    const unicode11 = new Unicode11Addon();
    term.loadAddon(unicode11);
    term.unicode.activeVersion = '11';
    const search = new SearchAddon();
    term.loadAddon(search);
    term.open(el);
    this.term = term;
    this.fit = fit;
    this.search = search;

    // ⚠️ 폰 키보드의 **예측 입력(단어 조합)** 억제 — 안 하면 타이핑이 스페이스로 단어를 확정해야
    // 한 번에 들어간다(2026-08-08). Gboard·삼성 키보드는 영문도 단어 단위 조합으로 처리한다.
    // inputmode=url 은 예측·자동완성을 끄는 게 규격상 의도이고, `/` 가 키보드에 노출되는 부수 이득도 있다.
    const ta = term.textarea;
    if (ta) {
      ta.setAttribute('autocomplete', 'off');
      ta.setAttribute('autocapitalize', 'none');
      ta.setAttribute('inputmode', 'url');
    }

    // 웹폰트가 늦게 오면 xterm 이 폴백 폭으로 잰 셀 크기가 굳는다 — 로드 후 한 번 다시 잰다
    void document.fonts.ready.then(() => {
      term.clearTextureAtlas();
      this.refit();
    });

    term.onData((raw) => {
      const data = stripDaReplies(raw);
      if (!data) return; // 능력 응답뿐이었으면 아무것도 보내지 않는다
      const { data: out, used } = applyModifiers(data, this.state.mods);
      if (used) this.set({ mods: { ctrl: false, alt: false } });
      this.input(out);
    });

    // PTY 리사이즈는 디바운스한다(데스크톱과 같은 규칙) — 핀치·iOS 키보드 애니메이션은 프레임마다
    // fit 을 부르는데, 그때마다 SIGWINCH 를 보내면 claude 같은 TUI 가 스텝 수만큼 전체 리렌더를 한다
    let resizeTimer: number | null = null;
    term.onResize(({ cols, rows }) => {
      this.cellH = 0; // 셀 높이가 바뀌었을 수 있다 — 터치 스크롤의 줄 환산 기준
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        resizeTimer = null;
        this.send({ type: 'resize', cols, rows });
      }, 120);
    });
    term.onScroll(() => this.syncBottom());
    term.onSelectionChange(() => {
      if (!this.state.selecting) return;
      const pos = term.getSelectionPosition();
      this.set({ selectedLines: pos ? pos.end.y - pos.start.y + 1 : 0 });
    });

    this.bindTouch(el);
    this.refit();
    this.autoAttach(); // 세션 목록이 xterm 보다 먼저 왔을 수 있다
  }

  /** 셸이 탭을 바꿨다 — 숨은 동안엔 크기 주장·화면 켜둠을 하지 않는다 */
  setActive(active: boolean) {
    this.active = active;
    if (active) requestAnimationFrame(() => this.refit());
    else this.closeKeyboard();
    this.syncWakeLock();
  }

  private refit() {
    if (!this.term || !this.fit || !this.hostEl || !this.active) return;
    if (this.hostEl.clientWidth === 0) return; // 숨어 있다(display:none) — 0 열로 줄이지 않는다
    this.fit.fit();
  }

  // ── 소켓 ──

  private send(msg: TermClientMsg) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  /** 입력 — 들어가면 서버가 copy-mode 를 끝내므로 [맨 아래로] 도 함께 내린다 */
  private input(data: string) {
    this.send({ type: 'input', data });
    if (this.serverScrolledUp) {
      this.serverScrolledUp = false;
      this.syncBottom();
    }
  }

  // 재연결 예약 핸들 — visibilitychange 재연결과 onclose 백오프가 경합해 소켓이 이중 생성되면,
  // 먼저 열린 쪽은 `ws !== sock` 가드에 걸려 영영 닫히지 않는 유령 소켓이 된다(2026-08-07).
  private connect() {
    if (this.ws) return;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.set({ connected: false, statusText: '연결 중…' });
    // 스킴은 페이지를 따라간다 — https 페이지에서 ws:// 는 mixed content 로 막힌다
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const sock = new WebSocket(`${scheme}://${location.host}/term`);
    this.ws = sock;
    sock.onopen = () => {
      this.reconnectDelay = 1000;
      this.set({ connected: true, statusText: '연결됨' });
      this.syncWakeLock();
      // 작업 영역 트리를 한 번 받아 둔다 — 상단 타일 색과 변경 탭 대상(세션 위치 → 워크트리)이 쓴다.
      // 경량 조회(listWorktreesBrief)라 접속마다 한 번은 부담이 없다. 시트를 열 때 다시 갱신한다.
      this.send({ type: 'workspaces' });
      // 서버가 접속 직후 sessions 를 보내주고, 그때 마지막 세션으로 재attach 된다
    };
    sock.onmessage = (e) => {
      try {
        this.handle(JSON.parse(String(e.data)) as TermServerMsg);
      } catch {
        // 형식이 안 맞는 프레임은 무시
      }
    };
    sock.onclose = () => {
      if (this.ws !== sock) return;
      this.ws = null;
      this.pendingAttachId = null; // 못 받은 응답을 기다리며 재attach 를 막으면 안 된다
      this.releaseWake(); // 끊긴 화면을 켜 둘 이유가 없다
      this.set({ attachedId: null, connected: false, statusText: '연결 끊김 — 재연결 중…' });
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 5000); // 1→2→4→5초 백오프
    };
    sock.onerror = () => sock.close();
  }

  private handle(msg: TermServerMsg) {
    switch (msg.type) {
      case 'sessions': {
        const sessions = msg.sessions;
        const attachedId =
          this.state.attachedId && sessions.some((s) => s.id === this.state.attachedId)
            ? this.state.attachedId
            : null;
        this.set({ sessions, attachedId });
        this.onWaitingChanged(this.stable.update(sessions));
        this.syncWakeLock();
        this.autoAttach();
        break;
      }
      case 'cwds':
        this.set({ cwds: msg.items });
        break;
      case 'workspaces': {
        // 고른 영역의 타일 색·브랜치를 최신 트리로 맞춘다(데스크톱에서 색을 바꿨을 수 있다)
        const scope = this.state.scope;
        let nextScope = scope;
        if (scope) {
          const ws = msg.items.find((w) => w.id === scope.wsId);
          const wt = ws?.worktrees.find((w) => w.path === scope.path);
          if (ws && wt)
            nextScope = { ...scope, wsName: ws.name, wsColor: ws.color, name: wt.name, branch: wt.branch };
        }
        this.set({ workspaces: msg.items, scope: nextScope });
        if (nextScope !== scope) localStorage.setItem(SCOPE_KEY, JSON.stringify(nextScope));
        break;
      }
      case 'presets':
        this.set({ presets: msg.items });
        break;
      case 'created':
        this.attach(msg.id);
        break;
      case 'attached': {
        const term = this.term;
        this.pendingAttachId = null;
        this.attachSeq = msg.seq;
        localStorage.setItem(LAST_SESSION_KEY, msg.id);
        this.tmuxBackend = msg.tmux ?? false;
        this.serverScrolledUp = false; // 새 세션 — 이전 세션의 copy-mode 상태를 물려받지 않는다
        this.scrollAcc = 0;
        this.scrollSentAt = 0;
        if (term) {
          term.reset();
          // 대체 화면(TUI) 세션은 replay 가 생략된다 — 전환 시퀀스를 합성해 xterm 의 buffer 타입을
          // 실제 상태와 맞춘다(터치 스크롤의 방향키 변환 판정이 이것을 쓴다)
          if (msg.alt) term.write('\x1b[?1049h');
          if (msg.replay) term.write(msg.replay);
          if (msg.cols > 0 && msg.rows > 0 && (msg.cols !== term.cols || msg.rows !== term.rows))
            term.resize(msg.cols, msg.rows);
        }
        this.set({ attachedId: msg.id, selecting: false, selectedLines: 0 });
        this.syncBottom();
        this.syncWakeLock();
        void this.closeNotificationsFor((id) => id === msg.id); // 열어 봤으면 그 알림은 용건이 끝났다
        break;
      }
      case 'data':
        if (msg.id === this.state.attachedId && msg.seq > this.attachSeq) this.term?.write(msg.data);
        break;
      case 'scrolled':
        // 위임 스크롤의 결과 — tmux copy-mode 는 xterm 버퍼로 알 수 없으므로 서버가 알려준다
        if (msg.id !== this.state.attachedId) break;
        this.scrollSentAt = 0;
        this.serverScrolledUp = msg.scrolledUp;
        this.syncBottom();
        break;
      case 'resized': {
        const term = this.term;
        if (msg.id !== this.state.attachedId || !term) break;
        // 다른 클라이언트(데스크톱)가 큰 크기로 바꾸면 폰에선 오른쪽이 잘려 못 읽는다 →
        // **보고 있는 쪽이 다시 주장**한다. 백그라운드·숨은 탭일 때는 따라가 다툼을 피한다.
        const mine = this.fit?.proposeDimensions();
        if (
          document.visibilityState === 'visible' &&
          this.active &&
          mine &&
          mine.cols > 0 &&
          mine.rows > 0 &&
          (mine.cols !== msg.cols || mine.rows !== msg.rows)
        ) {
          term.resize(mine.cols, mine.rows);
          // term.cols 가 이미 mine 과 같으면 onResize 가 안 뜨므로 직접 보낸다
          this.send({ type: 'resize', cols: mine.cols, rows: mine.rows });
        } else if (msg.cols !== term.cols || msg.rows !== term.rows) {
          term.resize(msg.cols, msg.rows);
        }
        break;
      }
      case 'exit':
        if (msg.id === this.state.attachedId) {
          this.set({ attachedId: null });
          // 종료 코드를 함께 남긴다 — 방금 만든 세션이 곧바로 사라질 때 원인을 좁히는 단서다
          // (0=정상 종료 · 127=명령 없음 · 그 외=실행 실패)
          this.term?.write(`\r\n\x1b[90m[세션이 종료되었습니다 — exit ${msg.exitCode}]\x1b[0m\r\n`);
          this.notice(`세션 종료 (exit ${msg.exitCode})`);
        }
        break;
      case 'error':
        // ⚠️ 연결 끊김으로 표시하지 말 것 — attach 실패 한 번에 UI 가 통째로 잠겨 "아무것도 안 된다"가
        // 됐다(2026-08-08). 연결은 멀쩡하므로 안내만 띄운다.
        this.pendingAttachId = null; // attach 실패였다면 다시 시도할 수 있어야 한다
        this.notice(msg.message);
        break;
    }
  }

  // ── 세션 ──

  /** 붙은 세션이 없으면 고른다 — ⚠️ attach 응답을 기다리는 중이면 고르지 않는다(logic.ts pickAutoAttach 주석) */
  private autoAttach() {
    if (!this.term || this.state.attachedId || this.pendingAttachId) return;
    const wanted = this.pendingFocusId;
    const next = pickAutoAttach(this.state.sessions, {
      wanted,
      last: localStorage.getItem(LAST_SESSION_KEY),
      scopePath: this.state.scope?.path ?? null,
    });
    if (this.state.sessions.length) this.pendingFocusId = null; // 한 번만 — 목록이 온 뒤에 소비
    if (next) this.attach(next);
  }

  attach(id: string) {
    // ⚠️ 응답 전에 sessions 브로드캐스트가 또 attach 를 부르면 같은 세션에 두 번 붙어
    // term.reset()+replay+전체 리드로를 두 번 겪는다(셀룰러·릴레이 경로는 왕복이 수백 ms)
    // 소켓이 안 열렸으면 보내지도 대기 표시도 하지 않는다 — 표시만 남으면 이후 자동 attach 가 막힌다
    if (this.pendingAttachId === id || !this.term || this.ws?.readyState !== WebSocket.OPEN) return;
    this.pendingAttachId = id;
    this.refit();
    this.send({ type: 'attach', id, cols: this.term.cols, rows: this.term.rows });
  }

  /** 지금 보여줄 세션 — 보고 있는 세션이 영역 밖이면(다른 영역에서 이어보는 중) 끝에 남긴다 */
  chipSessions(): TerminalSessionInfo[] {
    const { sessions, scope, attachedId } = this.state;
    const list = visibleSessions(sessions, scope?.path ?? null);
    const attached = attachedId ? sessions.find((s) => s.id === attachedId) : undefined;
    return attached && !list.includes(attached) ? [...list, attached] : list;
  }

  kill(id: string) {
    this.send({ type: 'kill', id });
  }

  /** 새 세션 시트를 열 때 — 위치 후보·프리셋을 최신으로(데스크톱에서 방금 고쳤을 수 있다) */
  refreshNewSession() {
    this.send({ type: 'cwds' });
    this.send({ type: 'presets' });
  }

  /** 새 세션 — preset 이 없으면 셸. cols/rows 는 attach 리사이즈로 자동 실행이 깨지지 않게 실어 보낸다 */
  create(cwd: string | undefined, preset?: TerminalPreset) {
    const base = { cwd, cols: this.term?.cols ?? 80, rows: this.term?.rows ?? 24 };
    // undefined 필드는 JSON 직렬화에서 빠진다 — 구버전 서버와도 호환
    if (!preset) {
      this.send({ type: 'create', ...base, agentId: 'shell' });
      return;
    }
    // 데스크톱 프리셋 칩과 같은 동작 — agentId 태깅까지 같아야 입력 대기 알림·상태 휴리스틱이 붙는다
    this.send({
      type: 'create',
      ...base,
      agentId: agentIdFromCommand(preset.command),
      command: preset.command,
      title: preset.name,
    });
  }

  /** 알림을 눌러 들어왔다(SW → postMessage) — 그 세션으로 */
  focusSession(id: string) {
    this.focusListeners.forEach((fn) => fn());
    const { sessions, attachedId } = this.state;
    if (sessions.some((s) => s.id === id)) {
      if (id !== attachedId) this.attach(id);
    } else if (!sessions.length) {
      this.pendingFocusId = id; // 세션 목록이 아직 안 왔다 — 첫 sessions 수신 때 붙는다
    } else {
      this.notice('그 세션은 이미 종료됐습니다');
    }
  }

  // ── 작업 영역 ──

  /** 작업 영역 시트를 열 때 — git 조회라 열 때마다 최신으로 */
  refreshWorkspaces() {
    this.send({ type: 'workspaces' });
  }

  setScope(next: MoScope | null) {
    if (next) localStorage.setItem(SCOPE_KEY, JSON.stringify(next));
    else localStorage.removeItem(SCOPE_KEY);
    this.set({ scope: next });
    if (!next) return;
    // 고른 영역에 세션이 있으면 바로 그 세션으로 — 영역만 바뀌고 화면이 그대로면 무엇이 달라졌는지 모른다
    const first = visibleSessions(this.state.sessions, next.path)[0];
    if (first && first.id !== this.state.attachedId) this.attach(first.id);
  }

  toggleWs(id: string) {
    const set = new Set(this.state.expandedWs);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    const expandedWs = [...set];
    localStorage.setItem(WS_EXPANDED_KEY, JSON.stringify(expandedWs));
    this.set({ expandedWs });
  }

  // ── 키 바·입력 ──

  sendKey(key: KeyName) {
    const seq = KEY_SEQ[key];
    // 키 바의 글자 키(| ~ / -)에도 ctrl·alt 가 걸린다 — 키보드로 친 것과 같게
    const { data, used } = applyModifiers(seq, this.state.mods);
    if (used) this.set({ mods: { ctrl: false, alt: false } });
    this.input(data);
  }

  toggleMod(mod: keyof Modifiers) {
    this.set({ mods: { ...this.state.mods, [mod]: !this.state.mods[mod] } });
  }

  /** 키보드 열기 — 화면 탭은 읽기 전용이라 키보드는 이 버튼으로만 연다(리디자인) */
  openKeyboard() {
    this.term?.focus();
  }

  closeKeyboard() {
    this.term?.blur();
  }

  /**
   * 클립보드 붙여넣기 — 폰에서 xterm 에 텍스트를 넣을 사실상 유일한 경로다.
   * ⚠️ `navigator.clipboard` 는 secure context 에서만 있다 — Tailscale 인증서가 없어 http 로 뜨면 불가.
   */
  async paste() {
    if (!navigator.clipboard?.readText) {
      this.notice('붙여넣기는 HTTPS 접속에서만 됩니다');
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        this.notice('클립보드가 비어 있습니다');
        return;
      }
      this.input(text);
    } catch {
      // iOS 는 사용자 제스처 안에서도 권한 거부가 날 수 있다
      this.notice('클립보드를 읽지 못했습니다');
    }
  }

  // ── 출력 선택·복사 (리디자인 신규) ──
  // 폰에서 xterm 의 마우스 선택은 쓸 수 없다(터치 드래그 = 스크롤). 선택 모드에서는 드래그가
  // **줄 단위 선택**이 된다 — 행 경계만 정하면 되므로 손가락으로도 정확하다.

  setSelecting(on: boolean) {
    if (!on) this.term?.clearSelection();
    this.set({ selecting: on, selectedLines: 0 });
  }

  selectionText(): string {
    return this.term?.getSelection() ?? '';
  }

  // ── 검색 (리디자인 신규 — 데스크톱 ⌘F 와 같은 addon) ──

  findNext(q: string) {
    if (!q) return;
    this.search?.findNext(q, { decorations: searchDecorations() });
  }

  findPrev(q: string) {
    if (!q) return;
    this.search?.findPrevious(q, { decorations: searchDecorations() });
  }

  clearSearch() {
    this.search?.clearDecorations();
    this.term?.clearSelection();
  }

  scrollToBottom() {
    if (this.serverScrolledUp) {
      this.send({ type: 'scroll-bottom' }); // tmux copy-mode 종료 — 응답이 상태를 되돌린다
      this.serverScrolledUp = false; // 낙관적 반영(왕복을 기다리면 버튼이 늦게 사라진다)
    }
    this.term?.scrollToBottom();
    this.syncBottom();
  }

  private syncBottom() {
    const buf = this.term?.buffer.active;
    // 올라가 있는 경로가 둘이다 — xterm 스크롤백(폴백 세션)과 tmux copy-mode(위임 스크롤)
    const up = this.serverScrolledUp || (!!buf && buf.viewportY < buf.baseY);
    if (up !== this.state.scrolledUp) this.set({ scrolledUp: up });
  }

  // ── 글자 크기 ──

  setFontSize(next: number) {
    const size = Math.min(FONT_MAX, Math.max(FONT_MIN, Math.round(next)));
    localStorage.setItem(FONT_KEY, String(size));
    if (this.term) {
      this.term.options.fontSize = size;
      this.cellH = 0; // 행 수가 그대로일 수 있어 onResize 만으론 부족하다
      this.refit(); // 열·행이 바뀌므로 PTY 도 따라온다(onResize)
    }
    this.set({ fontSize: size });
  }

  private hudTimer: ReturnType<typeof setTimeout> | null = null;
  private showFontHud() {
    this.set({ fontHud: this.state.fontSize });
    if (this.hudTimer !== null) clearTimeout(this.hudTimer);
    this.hudTimer = setTimeout(() => {
      this.hudTimer = null;
      this.set({ fontHud: null });
    }, 700);
  }

  // ── 터치 — 스크롤 · 핀치 · 선택 ──
  // 데스크톱 휠(TerminalView)과 **같은 판정·같은 경로**다:
  //   · 마우스 트래킹을 켠 앱(claude 등) → **합성 휠 이벤트**를 xterm 에 넘긴다(앱이 자체 스크롤)
  //   · 그 외(tmux 백엔드) → 줄 수만 세어 **서버로 위임**(`scroll`) — 일반 셸은 tmux 스크롤백까지 올라간다
  // ⚠️ 마우스 트래킹이 꺼진 상태의 휠을 xterm 에 넘기면 안 된다 — 대체 화면에서 xterm 은 휠을
  //    **방향키(↑↓)로 바꿔** 앱에 보낸다. claude 는 리렌더마다 마우스 모드를 껐다 켜서 그 틈에
  //    넘어간 휠이 프롬프트 히스토리를 롤링했다(2026-09-09). tmux pane 플래그는 안 흔들린다.

  private cellH = 0;
  private scrollAcc = 0; // 아직 안 보낸 줄 수(소수 — 한 프레임은 1줄에 못 미친다)
  private scrollTimer: number | null = null;
  private scrollSentAt = 0; // 응답 대기 시작 시각 (0 = 대기 없음)

  private cellHeight(screen: HTMLElement) {
    if (!this.cellH && this.term) this.cellH = screen.clientHeight / Math.max(1, this.term.rows);
    return this.cellH || 16;
  }

  private flushScroll = () => {
    this.scrollTimer = null;
    // 왕복 중이면 겹쳐 보내지 않고 다음 flush 에 합친다(tmux CLI 가 밀리지 않게)
    if (this.scrollSentAt && Date.now() - this.scrollSentAt < 500) {
      this.scrollTimer = window.setTimeout(this.flushScroll, 24);
      return;
    }
    const n = Math.trunc(this.scrollAcc);
    if (!n) return;
    this.scrollAcc -= n;
    this.scrollSentAt = Date.now();
    this.send({ type: 'scroll', lines: n });
  };

  private bindTouch(el: HTMLElement) {
    let screen: HTMLElement | null = null;
    const screenEl = () => (screen ??= el.querySelector<HTMLElement>('.xterm-screen')) ?? el;
    let dragY = 0;
    let dragging = false;
    let dragged = false;
    let pinchStart = 0;
    let pinchStartFont = 0;
    let selAnchor = -1;
    const dist = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    /** 손가락 y → 버퍼 행 (뷰포트 시작 + 화면 행) */
    const rowAt = (y: number) => {
      const term = this.term;
      if (!term) return 0;
      const r = screenEl().getBoundingClientRect();
      const row = Math.floor((y - r.top) / this.cellHeight(screenEl()));
      return term.buffer.active.viewportY + Math.min(term.rows - 1, Math.max(0, row));
    };
    const selectTo = (y: number) => {
      const row = rowAt(y);
      this.term?.selectLines(Math.min(selAnchor, row), Math.max(selAnchor, row));
    };

    el.addEventListener(
      'touchstart',
      (e) => {
        if (e.touches.length === 2) {
          dragging = false; // 스크롤 드래그와 겹치지 않게
          pinchStart = dist(e.touches);
          pinchStartFont = this.state.fontSize;
          return;
        }
        if (e.touches.length !== 1) return;
        dragY = e.touches[0].clientY;
        dragging = true;
        dragged = false;
        if (this.state.selecting) {
          selAnchor = rowAt(dragY);
          selectTo(dragY);
        }
      },
      { passive: true },
    );

    el.addEventListener(
      'touchmove',
      (e) => {
        if (e.touches.length === 2 && pinchStart > 0) {
          e.preventDefault();
          const next = Math.round(pinchStartFont * (dist(e.touches) / pinchStart));
          if (next !== this.state.fontSize) this.setFontSize(next);
          this.showFontHud();
          return;
        }
        if (!dragging || e.touches.length !== 1) return;
        const t = e.touches[0];
        if (this.state.selecting) {
          e.preventDefault();
          dragged = true;
          selectTo(t.clientY);
          return;
        }
        const dy = dragY - t.clientY; // 손가락을 내리면 음수 = 위(과거) 내용
        dragY = t.clientY;
        if (!dragged && Math.abs(dy) < 4) return; // 탭과 구분되는 최소 이동
        dragged = true;
        e.preventDefault(); // 페이지가 대신 움직이지 않게
        const term = this.term;
        if (!term) return;
        const delegate =
          this.tmuxBackend && // 폴백(tmux 미설치) 세션은 xterm 에 스크롤백이 쌓인다 — 기본 동작이 옳다
          term.modes.mouseTrackingMode === 'none'; // 마우스 앱은 자체 스크롤을 갖고 있다
        if (delegate) {
          this.scrollAcc += -dy / this.cellHeight(screenEl());
          if (this.scrollTimer === null) this.scrollTimer = window.setTimeout(this.flushScroll, 24);
          return;
        }
        // 좌표까지 실어 보낸다 — 마우스 트래킹 앱은 휠 이벤트의 행·열을 함께 보고한다
        screenEl().dispatchEvent(
          new WheelEvent('wheel', {
            deltaY: dy,
            deltaMode: 0,
            clientX: t.clientX,
            clientY: t.clientY,
            bubbles: true,
            cancelable: true,
          }),
        );
      },
      { passive: false },
    );

    el.addEventListener(
      'touchend',
      (e) => {
        if (pinchStart > 0) {
          if (e.touches.length === 0) pinchStart = 0;
          e.preventDefault(); // 핀치 끝을 탭으로 오해하지 않게
          return;
        }
        dragging = false;
        // ⚠️ 탭은 **읽기**다 — 키보드를 열지 않는다(리디자인: 키보드는 키 바의 버튼으로).
        // 기본 동작을 막아야 뒤따르는 합성 mousedown 으로 xterm 이 textarea 에 포커스(=키보드)를
        // 주지 않는다. 키보드가 이미 떠 있으면 막지 않는다(입력 위치를 그대로 둔다).
        if (!this.state.kbdOpen || this.state.selecting) e.preventDefault();
        void dragged;
      },
      { passive: false },
    );
  }

  // ── 뷰포트 — 소프트 키보드가 뜨면 실제 보이는 높이에 맞춰 레이아웃·PTY 를 줄인다 ──
  // iOS Safari·안드로이드 Chrome 모두 visual viewport 만 줄이는 게 기본이라 JS 로 맞춘다
  // (안드로이드는 index.html 의 interactive-widget=resizes-content 가 레이아웃까지 줄여 이중 보정).
  // ⚠️ 키보드 판정을 textarea 의 focus/blur 로 하면 **키보드를 내려도 남는다** — 안드로이드
  //    뒤로가기·iOS 키보드 내리기는 blur 를 보내지 않는다(2026-08-08). 그래서 높이 감소로 본다.

  /** 지금 실제로 보이는 높이 — 레이아웃까지 줄이는 안드로이드는 innerHeight 가 더 작다 */
  private viewportH(): number {
    const vv = window.visualViewport?.height;
    return Math.min(vv ?? Infinity, window.innerHeight || Infinity);
  }

  private onViewportChange = () => {
    const h = this.viewportH();
    let open = false;
    if (Number.isFinite(h)) {
      if (h > this.baseViewportH) this.baseViewportH = h; // 가장 넓었던 상태 = 키보드 없음
      open = this.baseViewportH - h > KEYBOARD_MIN_DELTA;
    }
    if (open !== this.state.kbdOpen) this.set({ kbdOpen: open });
    this.syncViewport();
  };

  /** 셸 높이(`--mo-vh`)·키보드 클래스(`mo-kbd`)를 맞춘다 — 셸이 탭바를 숨기고 높이를 줄인다 */
  private syncViewport() {
    const h = this.viewportH();
    const root = document.documentElement;
    if (Number.isFinite(h)) root.style.setProperty('--mo-vh', `${Math.round(h)}px`);
    root.classList.toggle('mo-kbd', this.state.kbdOpen);
    requestAnimationFrame(() => this.refit());
  }

  // ── 입력 대기 — 탭바 배지·홈 화면 아이콘 배지·폰 알림이 전부 이 집합 하나를 본다 ──

  private onWaitingChanged(added: string[]) {
    const waiting = [...this.stable.ids];
    const same =
      waiting.length === this.state.waiting.length &&
      waiting.every((id, i) => id === this.state.waiting[i]);
    if (!same) this.set({ waiting });
    this.syncAppBadge();
    if (added.length) void this.notifyWaiting(added);
    // 대기가 풀린 세션의 알림은 걷는다 — 이미 답한 세션의 알림이 트레이에 남지 않게
    void this.closeNotificationsFor((id) => !this.stable.ids.has(id));
  }

  /** 다음 대기 세션으로 — 여러 개면 눌러서 순회한다 */
  nextWaiting() {
    const pool = this.state.waiting.filter((id) => this.state.sessions.some((s) => s.id === id));
    if (!pool.length) return;
    const cur = pool.indexOf(this.state.attachedId ?? '');
    const next = pool[(cur + 1) % pool.length];
    if (next !== this.state.attachedId) this.attach(next);
  }

  // 홈 화면 아이콘 배지 — 홈 화면에 추가한 PWA 아이콘에 숫자가 붙는다(안드로이드 Chrome)
  private syncAppBadge() {
    if (!('setAppBadge' in navigator)) return;
    const n = this.stable.ids.size;
    const p = n > 0 ? navigator.setAppBadge(n) : navigator.clearAppBadge();
    p.catch(() => undefined); // 설치되지 않은 탭에서는 거부될 수 있다 — 표시 보조일 뿐이다
  }

  // ── 폰 알림 — 자리를 비운 동안 입력 대기가 생기면 알린다 ──
  // ⚠️ 안드로이드 Chrome 은 페이지의 `new Notification()` 을 거부한다 — SW 의 showNotification 만 된다.
  //    SW(`/sw.js`)는 fetch 를 가로채지 않는다 — 알림 클릭 처리만.
  // ⚠️ 진짜 푸시가 아니다 — 페이지가 백그라운드에서 **살아 있는 동안**(WS 유지)만 온다.
  // ⚠️ secure context 전용 — http 로 뜬 경우엔 통째로 비활성.

  private swReg: ServiceWorkerRegistration | null = null;
  private async ensureSw(): Promise<ServiceWorkerRegistration | null> {
    if (!notifySupported()) return null;
    if (this.swReg) return this.swReg;
    try {
      // 루트 스코프 — 셸 전체(`/`)가 한 페이지다. 옛 터미널 페이지가 `/terminal/` 스코프로 깔아 둔
      // 워커는 서버가 같은 sw.js 를 주므로 갱신되어 같은 동작을 한다
      this.swReg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      return this.swReg;
    } catch {
      return null; // 등록 실패(구형 브라우저 등) — 알림만 포기한다
    }
  }

  private async notifyWaiting(ids: string[]) {
    if (document.visibilityState === 'visible') return;
    if (!notifySupported() || Notification.permission !== 'granted') return;
    const reg = await this.ensureSw();
    if (!reg) return;
    for (const id of ids) {
      const s = this.state.sessions.find((x) => x.id === id);
      if (!s) continue;
      const where = s.projectName ?? s.cwd.split('/').filter(Boolean).pop() ?? '';
      try {
        await reg.showNotification(s.title, {
          body: `${TERMINAL_AGENT_NAMES[s.agentId]} 입력 대기${where ? ` · ${where}` : ''}`,
          // 같은 세션은 한 장 — 진동 구간에 다시 들어와도 기존 알림을 갱신할 뿐 새로 울리지 않는다
          tag: `wait:${id}`,
          data: { id },
        });
      } catch {
        // 권한 회수·워커 비활성 — 조용히 넘어간다
      }
    }
  }

  private async closeNotificationsFor(match: (sessionId: string) => boolean) {
    if (!this.swReg) return;
    try {
      for (const n of await this.swReg.getNotifications()) {
        const id = (n.data as { id?: string } | null)?.id;
        if (id && match(id)) n.close();
      }
    } catch {
      // 워커가 사라졌으면 걷을 것도 없다
    }
  }

  private syncNotifyBar() {
    const show =
      notifySupported() &&
      Notification.permission === 'default' &&
      !localStorage.getItem(NOTIFY_DISMISS_KEY);
    this.set({
      notifyBar: show,
      notifyGranted: notifySupported() && Notification.permission === 'granted',
    });
  }

  /** 알림 받기 — 권한을 묻는다(이미 거부했으면 브라우저가 기억해 다시 묻지 않는다) */
  requestNotify() {
    if (!notifySupported()) {
      this.notice('알림은 HTTPS 접속에서만 됩니다');
      return;
    }
    void Notification.requestPermission().then((perm) => {
      if (perm === 'granted') void this.ensureSw();
      else if (perm === 'denied') this.notice('브라우저 설정에서 알림이 차단돼 있습니다');
      this.syncNotifyBar();
    });
  }

  dismissNotifyBar() {
    localStorage.setItem(NOTIFY_DISMISS_KEY, '1');
    this.syncNotifyBar();
  }

  // ── 화면 켜둠 — 보고 있는 세션이 일하는 동안 화면이 꺼지지 않게 ──
  // 지켜보는 중에 화면이 꺼지면 소켓이 끊기고 다시 켤 때 재접속·전체 리드로를 겪는다. **보는 동안만**
  // 막고 끝나면(waiting·idle) 풀어 배터리를 지킨다. 해제는 유예를 둔다(busy↔waiting 진동).
  // ⚠️ secure context 전용 — http 면 navigator.wakeLock 자체가 없다.

  private wakeSentinel: WakeLockSentinel | null = null;
  private wakeRequesting = false;
  private wakeReleaseTimer: ReturnType<typeof setTimeout> | null = null;

  private watchingWork(): boolean {
    const { attachedId, sessions } = this.state;
    const s = attachedId ? sessions.find((x) => x.id === attachedId) : null;
    return !!s && (s.working || s.status === 'busy');
  }

  private async acquireWake() {
    if (!('wakeLock' in navigator) || this.wakeSentinel || this.wakeRequesting) return;
    this.wakeRequesting = true;
    try {
      const sentinel = await navigator.wakeLock.request('screen');
      sentinel.addEventListener('release', () => {
        if (this.wakeSentinel === sentinel) this.wakeSentinel = null;
      });
      this.wakeSentinel = sentinel;
    } catch {
      // 배터리 절약 모드 등에서 브라우저가 거부한다 — 그냥 넘어간다
    } finally {
      this.wakeRequesting = false;
    }
  }

  private releaseWake() {
    if (this.wakeReleaseTimer !== null) {
      clearTimeout(this.wakeReleaseTimer);
      this.wakeReleaseTimer = null;
    }
    const s = this.wakeSentinel;
    this.wakeSentinel = null;
    void s?.release().catch(() => undefined);
  }

  private syncWakeLock() {
    const want =
      document.visibilityState === 'visible' &&
      this.active &&
      this.ws?.readyState === WebSocket.OPEN &&
      this.watchingWork();
    if (want) {
      if (this.wakeReleaseTimer !== null) {
        clearTimeout(this.wakeReleaseTimer);
        this.wakeReleaseTimer = null;
      }
      void this.acquireWake();
      return;
    }
    if (!this.wakeSentinel || this.wakeReleaseTimer !== null) return;
    this.wakeReleaseTimer = setTimeout(() => {
      this.wakeReleaseTimer = null;
      if (!this.watchingWork() || !this.active) this.releaseWake();
    }, 5000);
  }
}

export const controller = new MoTerminalController();
