// 세션 하나를 xterm 으로 화면에 붙인다 — attach(replay 복원)·입출력·리사이즈 동기화 담당.
// 탭 전환 시 언마운트→재마운트되며, 그때마다 attach 가 링버퍼 replay 로 스크롤백을 복원하고
// SIGWINCH redraw(main 담당)가 현재 화면을 다시 그린다. 모바일(MO)도 같은 방식으로 붙는다.
//
// 툴바(프리셋·검색·글자크기·Finder)는 pane 이 아니라 **탭바 아래 공용 바**(TerminalSection)
// 하나다 — 분할하면 pane 마다 반복될 이유가 없다(2026-08-10 사용자 지적). 터미널 인스턴스를
// 직접 만져야 하는 조작(검색 열기·맨 아래로)은 onRegisterHandle 로 핸들을 올려 보낸다.
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../../../components/Icon';
import { Input } from '../../../components/Input';
import { Tooltip } from '../../../components/Tooltip';
import { terminalBackend } from '../lib/backend';

const cssVar = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/**
 * 번들 모노 폰트가 **이미 로드돼 있는지** — 폰트 스택의 첫 후보만 본다
 * (뒤의 시스템 폰트는 항상 available 이라 스택 전체를 넘기면 판정이 무의미해진다).
 *
 * ⚠️ 이 판정이 필요한 이유는 **텍스처 아틀라스가 pane 사이 공유물**이기 때문이다 —
 * 같은 폰트·크기의 xterm 들은 하나의 `TextureAtlas` 를 나눠 쓰는데,
 * `clearTextureAtlas()` 는 **호출한 pane 의 model 만** 다시 그리고 나머지 pane 에는
 * 알리지 않는다(addon-webgl 의 `clearTexture()` 가 `_requestClearModel` 을 세우지 않는다).
 * 그래서 pane 하나가 부르면 살아 있던 다른 pane 들이 **무효가 된 옛 글리프 좌표로**
 * 계속 그려 글자가 겹쳐 보인다(2026-08-12 사용자 신고).
 */
const monoFontLoaded = (stack: string, size: number) => {
  try {
    return document.fonts.check(`${size}px ${stack.split(',')[0].trim()}`);
  } catch {
    return false; // check 가 파싱에 실패하면 보수적으로 '아직 아니다'
  }
};

// PTY 크기 전달 지연 — 창 드래그가 멈춘 뒤 한 번만 SIGWINCH 를 보낸다
const PTY_RESIZE_DEBOUNCE_MS = 120;
// 다만 디바운스만 두면 드래그를 붙잡고 있는 동안 아무도 화면을 채우지 않는다 — **마지막 전송**
// 으로부터 이 시간이 지났으면 즉시 보내, 드래그 시작 직후와 드래그 중 모두 화면이 채워지게 한다
const PTY_RESIZE_THROTTLE_MS = 250;

// 휠 위임 주기 — 한 번의 IPC 가 tmux CLI 를 한 번 돌리므로 프레임마다 보내지 않는다
const WHEEL_FLUSH_MS = 24;

/**
 * 휠 델타 → 스크롤할 줄 수(양수 = 위로). `deltaMode` 는 픽셀(0)·줄(1)·페이지(2) 로 오고
 * 트랙패드는 한 틱이 1줄에 못 미치므로 소수를 그대로 반환해 호출부가 누적한다.
 */
const wheelLinesOf = (ev: WheelEvent, cellH: number, rows: number) => {
  if (cellH <= 0) return 0;
  const px =
    ev.deltaMode === 1
      ? ev.deltaY * cellH
      : ev.deltaMode === 2
        ? ev.deltaY * cellH * rows
        : ev.deltaY;
  return -px / cellH;
};

/**
 * 드롭한 파일 경로를 셸 입력용으로 인용한다 — Finder 경로엔 공백·괄호가 흔해서
 * 그대로 넣으면 단어가 갈라진다. 안전한 문자뿐이면 원문 유지(읽기 좋게),
 * 아니면 작은따옴표로 감싸고 내부 ' 는 `'\''` 로 잇는다(POSIX 관례 — Terminal.app 동일 취지).
 */
const shellQuotePath = (p: string) =>
  /^[A-Za-z0-9_\-./~+@%,:]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`;

// xterm 의 DA(장치 속성 질의) 자동 응답 — ESC[?…c(DA1)·ESC[>…c(DA2).
// (ESC 를 정규식 리터럴에 직접 쓰면 no-control-regex 에 걸려 문자열로 조립한다 — MO 동일)
const DA_REPLY_RE = new RegExp(`${String.fromCharCode(27)}\\[[?>][0-9;]*c`, 'g');

// 글자 크기 — 13 이 기본(앱 본문과 같은 크기). 값 보관은 TerminalSection 이 하고
// (세션 pane 이 여러 개 살아 있어 각자 들고 있으면 세션마다 크기가 어긋난다)
// 여기서는 범위·기본값만 정의한다.
export const FONT_SIZE_KEY = 'terminal:fontSize';
export const FONT_SIZE_DEFAULT = 13;
export const FONT_SIZE_MIN = 9;
export const FONT_SIZE_MAX = 22;

/**
 * 터미널 색 — DESIGN.md 의 **다크 패널(panel-dark)** 토큰에서 가져온다.
 * 로그·코드 패널과 같은 계열이라 라이트/다크 테마 모두에서 앱의 일부처럼 보인다.
 *
 * ⚠️ 배경은 여기서 칠하지 않고 `transparent` + `allowTransparency` 로 두어 **패널의 CSS 배경**
 * (`panel-dark` → `--surface-dark`)이 그대로 비치게 한다. xterm 은 생성 후 `options.theme` 을
 * 바꿔도 뷰포트 배경을 다시 칠하지 않아서, JS 로 동기화하면 테마 전환 시 패널(#272729)과
 * 터미널(검정)이 어긋난다(2026-08 실측). 나머지 색은 on-dark 토큰이라 테마와 무관하다.
 * 마젠타·시안은 대응 토큰이 없어 애플 시스템 색을 그대로 쓴다(그 둘만 예외).
 */
const buildTheme = () => {
  return {
    background: 'rgba(0, 0, 0, 0)', // 'transparent' 는 xterm 색 파서가 못 읽고 검정으로 폴백한다
    foreground: cssVar('--on-dark-2'),
    cursor: cssVar('--on-dark'),
    cursorAccent: cssVar('--surface-dark'),
    // --accent-on-dark(#2997ff) 에서 파생한 선택 영역 틴트
    selectionBackground: 'rgba(41, 151, 255, 0.35)',
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
  };
};

/** #RRGGBB 두 색을 비율로 섞는다 (ratio = 앞 색의 비중) */
const mixHex = (fg: string, bg: string, ratio: number) => {
  const parse = (h: string) => {
    const v = parseInt(h.replace('#', ''), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  };
  const [fr, fg2, fb] = parse(fg);
  const [br, bg2, bb] = parse(bg);
  const ch = (a: number, b: number) =>
    Math.round(a * ratio + b * (1 - ratio))
      .toString(16)
      .padStart(2, '0');
  return `#${ch(fr, br)}${ch(fg2, bg2)}${ch(fb, bb)}`;
};

/**
 * 검색 하이라이트 — 액센트를 패널 배경에 얹은 색을 **미리 합성**해서 쓴다.
 * addon 규격이 `#RRGGBB` 만 받아(알파 불가) 선택 영역처럼 rgba 틴트를 줄 수 없는데,
 * 경고색(노랑) 같은 밝은 배경을 그대로 쓰면 그 위의 밝은 글자가 안 읽힌다(2026-08-05 실측).
 * 비활성 일치는 옅게(22%), 현재 일치는 진하게(85%) — 둘 다 밝은 글자와 대비가 남는다.
 *
 * ⚠️ 두 값을 크게 벌려야 한다 — xterm 은 현재 일치에 **선택 영역 틴트까지 겹쳐** 그려서,
 * 비활성 일치 색을 선택 틴트(액센트 35%)와 비슷하게 잡으면 셋이 똑같이 보이고
 * "몇 번째 일치를 보고 있는지"가 화면에서 사라진다(2026-08-05 실측).
 */
const searchDecorations = () => {
  const accent = cssVar('--accent-on-dark');
  const surface = cssVar('--surface-dark');
  return {
    matchBackground: mixHex(accent, surface, 0.22),
    activeMatchBackground: mixHex(accent, surface, 0.85),
    // 오버뷰 룰러는 글자가 없는 얇은 막대라 토큰 색을 그대로 쓴다
    matchOverviewRuler: cssVar('--on-dark-3'),
    activeMatchColorOverviewRuler: accent,
  };
};

/** 상단 공용 바가 포커스 pane 을 조작할 때 쓰는 핸들 — pane 이 마운트 중에만 등록된다 */
export type TerminalPaneHandle = {
  openSearch: () => void;
  scrollToBottom: () => void;
  /** 키보드 포커스 회수 — 섹션 안 버튼에 포커스를 빼앗겼을 때 되돌린다
   *  (TerminalSection 의 '포커스 안전망' 절 — ⌘C/⌘V 가 무반응이 되는 것을 막는다) */
  focus: () => void;
};

/**
 * ⚠️ 세션 객체(TerminalSessionInfo)가 아니라 **원시값만** 받는다 — 세션 목록 브로드캐스트는
 * 상태(busy↔waiting)가 바뀔 때마다 오고 그때마다 객체가 새로 만들어지는데, 객체를 그대로
 * 받으면 memo 가 매번 깨져 살아 있는 모든 pane 이 함께 리렌더된다(제목·상태는 탭바가,
 * 프리셋·글자크기 등 툴바는 상단 공용 바가 표시한다).
 */
export const TerminalView = memo(function TerminalView({
  sessionId: id,
  visible,
  focused,
  rectLeft,
  rectTop,
  rectW,
  rectH,
  onFocusPane,
  fontSize,
  onRegisterHandle,
  onScrolledChange,
}: {
  sessionId: string;
  /** 화면에 보이는 pane 인지 — 숨은 pane 은 크기를 주장하지 않는다(아래 visibleRef 참고).
   *  분할 중에는 여러 pane 이 동시에 true 다 — 서로 다른 세션이라 크기 주장이 충돌하지 않는다 */
  visible: boolean;
  /** 키보드 입력 대상(항상 하나) — term.focus()·⌘F 는 이 pane 만 갖는다.
   *  visible 과 분리하지 않으면 분할 드롭 순간 새 pane 이 포커스를 훔친다 */
  focused: boolean;
  /** 분할 rect(%, .terminal__panes 기준) — 없으면 기존 단일 pane(flex/--hidden) 경로.
   *  ⚠️ 객체가 아니라 원시값 4개로 받는다 — 객체로 받으면 상위가 렌더될 때마다
   *  새 객체가 되어 memo 가 매번 깨진다(세션 상태 브로드캐스트는 초 단위로 온다) */
  rectLeft?: number;
  rectTop?: number;
  rectW?: number;
  rectH?: number;
  /** pane 아무 곳이나 클릭 = 포커스 이동 — 상위 useCallback 안정 참조(memo 유지) */
  onFocusPane: (sessionId: string) => void;
  fontSize: number;
  /** 상단 공용 바의 검색·맨아래로 버튼이 이 pane 을 조작할 핸들 등록 (상위 useCallback) */
  onRegisterHandle: (sessionId: string, handle: TerminalPaneHandle | null) => void;
  /** 스크롤백을 위로 올렸는지 — 상단 바의 [맨 아래로] 노출 판정 (tmux 폴백 세션만 발화) */
  onScrolledChange: (sessionId: string, scrolledUp: boolean) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const reclaimRef = useRef<(() => void) | null>(null);
  // 콜백 안에서 최신 visible/focused 를 봐야 한다 — 마운트 effect 는 세션당 한 번만 돌기 때문
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const focusedRef = useRef(focused);
  focusedRef.current = focused;

  const fontSizeRef = useRef(fontSize);
  fontSizeRef.current = fontSize;
  const onScrolledChangeRef = useRef(onScrolledChange);
  onScrolledChangeRef.current = onScrolledChange;
  // tmux 백엔드면 스크롤 주인이 tmux 다 — 휠·[맨 아래로] 를 main 으로 위임한다(아래 참고)
  const tmuxRef = useRef(false);

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState({ index: -1, count: 0 });
  // Finder 파일을 끌어와 있는 동안만 true — 드롭 안내 오버레이 표시용
  const [fileDragOver, setFileDragOver] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    const fontFamily = cssVar('--font-mono') || 'ui-monospace, Menlo, monospace';
    // 마운트 시점에 번들 폰트가 와 있었는지 — 아래 아틀라스 재굽기 판정에 쓴다(선언 위치 주의:
    // term 생성이 폰트를 '쓰기 시작'하는 지점이라 그 전에 재 둬야 한다).
    const fontWasReady = monoFontLoaded(fontFamily, fontSizeRef.current);
    const term = new Terminal({
      fontFamily,
      fontSize: fontSizeRef.current, // 앱 본문(type-body)과 같은 13px 기본 + 툴바로 조절
      // ⚠️ xterm 의 lineHeight 는 **fontSize 가 아니라 폰트의 자연 줄높이에 곱해진다** —
      // 그 값이 폰트마다 달라서(13px 기준 실측: JetBrains Mono 17.5px = 1.346배,
      // Menlo 15px = 1.154배) 같은 lineHeight 라도 폰트를 바꾸면 행간이 통째로 달라진다.
      // TUI 가 블록 문자(█·▀)로 그리는 그림은 셀 종횡비가 그대로 픽셀 종횡비라 세로로 늘어나는데,
      // xterm 은 lineHeight < 1 을 거부하므로(최소 1) 이 폰트에서 가능한 가장 촘촘한 값이 1.0 이다
      // (셀 1:2.22 — 실측: 1.0→20px, 1.1→22px, 1.2→24px @ fontSize 15).
      lineHeight: 1.0,
      cursorBlink: true,
      macOptionIsMeta: true, // Option 을 Meta 로 — CLI 단어 이동(⌥←/→ 등)
      scrollback: 5000,
      // ⚠️ Unicode11Addon 이 쓰는 term.unicode 는 xterm 의 proposed API 다 — 이 옵션이
      // 없으면 addon 을 load 하는 순간 throw 하고, 그 예외가 effect 를 타고 올라가
      // React 루트가 통째로 언마운트된다(터미널 섹션 진입 시 앱이 하얗게 죽음 — 2026-08-05 실측).
      allowProposedApi: true,
      allowTransparency: true, // 배경을 패널 CSS 에 맡긴다 (buildTheme 주석 참고)
      theme: buildTheme(),
      // OSC 8 하이퍼링크 — tmux conf 에서 hyperlinks 를 켜 둔 만큼(terminal.md) 받을 쪽이 필요하다.
      // 앱 창에서 열면 워크스페이스가 깨지므로 항상 기본 브라우저로 넘긴다.
      linkHandler: {
        activate: (_e, uri) => void window.oneApp.openExternal(uri),
      },
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    // 문자 폭 판정 — xterm 기본은 Unicode 6 이라 이모지·일부 기호를 1셀로 계산해
    // claude 같은 TUI 의 박스 드로잉이 어긋난다. 11 로 올려 실제 렌더 폭과 맞춘다.
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = '11';
    // 평문 URL 클릭 (OSC 8 이 아닌 그냥 출력된 주소) — 같은 경로로 기본 브라우저에
    term.loadAddon(
      new WebLinksAddon((_e, uri) => void window.oneApp.openExternal(uri))
    );
    termRef.current = term;
    fitRef.current = fit;
    searchRef.current = search;
    term.open(host);
    // WebGL 렌더러 — DOM 렌더러보다 대량 출력·1Hz 스피너 리렌더가 훨씬 싸다.
    // open() 이후에만 붙을 수 있고, 컨텍스트를 못 얻으면 조용히 DOM 렌더러로 남는다.
    // 컨텍스트 유실 시 dispose 가 공식 문서의 권장 처리(= DOM 렌더러 폴백)다.
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      // WebGL 미지원 환경 — 렌더러만 느려지고 동작은 같다
    }
    fit.fit();

    // ⚠️ 번들 폰트(JetBrains Mono NL)가 아직 로드되지 않은 채로 측정하면 xterm 은 **폴백 폰트
    // 폭으로 셀 크기를 확정**하고 그대로 쓴다 — 글자와 커서·박스 드로잉이 어긋난다.
    // `font-display: block`(_base.scss)이 폴백 렌더 자체를 막지만 측정 시점이 로드보다
    // 앞설 수 있어, 로드 완료 후 한 번 다시 잰다. WebGL 렌더러는 글리프를 아틀라스에
    // 캐시하므로 함께 버려야 옛 폰트로 구운 글리프가 남지 않는다.
    //
    // ⚠️ 단, 아틀라스 버리기는 **폰트가 아직 안 온 상태로 마운트됐을 때만** 한다 —
    // 아틀라스는 pane 사이 공유물이라(`monoFontLoaded` 주석) 이미 폰트가 준비된 뒤에 생기는
    // pane 이 부르면 **살아 있던 다른 pane 들의 화면을 통째로 깨뜨린다.** 탭을 처음 옮길 때
    // 그 세션의 pane 이 새로 마운트되므로(livePanes), 예전엔 **탭 전환 한 번마다** 보고 있던
    // claude 화면이 겹쳐 그려졌다(2026-08-12 사용자 신고 — 출력이 멈춘 선택지 화면에서 특히
    // 눈에 띄었다). 늦게 생긴 pane 은 애초에 제 폰트로 셀을 쟀으므로 다시 구울 이유도 없다.
    void document.fonts.ready.then(() => {
      if (disposed) return;
      if (!fontWasReady) term.clearTextureAtlas();
      fit.fit();
    });

    const resultSub = search.onDidChangeResults((e) =>
      setHits({ index: e.resultIndex, count: e.resultCount })
    );
    // 스크롤 위치 추적 — xterm 6 은 네이티브 스크롤 영역이 없어 buffer 좌표로 판정한다.
    // [맨 아래로] 버튼은 상단 공용 바에 있으므로 boolean 변화만 위로 올린다.
    // (대체 화면 TUI 는 스크롤백이 없고, tmux 백엔드도 xterm 스크롤백이 안 쌓여
    //  실제로는 tmux 미설치 폴백 세션에서만 발화한다 — 2026-08-05 실측)
    const atBottom = () => {
      const b = term.buffer.active;
      return b.type === 'alternate' || b.viewportY >= b.baseY;
    };
    let lastScrolledUp = false;
    const syncScrolled = () => {
      const v = !atBottom();
      if (v === lastScrolledUp) return;
      lastScrolledUp = v;
      onScrolledChangeRef.current(id, v);
    };
    const scrollSub = term.onScroll(syncScrolled);
    const bufferSub = term.buffer.onBufferChange(syncScrolled);

    // attach 결과(replay + seq)가 오기 전에 도착한 라이브 출력은 큐에 담아 두고,
    // replay 에 이미 포함된 것(seq ≤ attachSeq)만 걸러낸다 — 유실도 중복도 없다.
    let attachSeq: number | null = null;
    const queue: { data: string; seq: number }[] = [];

    const offData = window.oneApp.terminal.onData((ev) => {
      if (ev.id !== id) return;
      if (attachSeq === null) queue.push(ev);
      else if (ev.seq > attachSeq) term.write(ev.data);
    });
    // 다른 클라이언트(MO)가 PTY 크기를 바꾸면 내 xterm 도 따라간다 — 안 하면 렌더가 깨짐
    const offResized = window.oneApp.terminal.onResized((ev) => {
      if (ev.id !== id) return;
      if (ev.cols !== term.cols || ev.rows !== term.rows)
        term.resize(ev.cols, ev.rows);
    });
    // ⚠️ DA(터미널 능력 질의) 자동 응답은 PTY 로 보내지 않는다 — attach replay(링버퍼)에
    // 세션 시작 때 tmux 가 보낸 질의(ESC[>c 등)가 남아 있어 xterm 이 replay 를 파싱하며
    // 응답을 다시 만들어 낸다. 그 시점의 tmux 는 질의를 기다리지 않으므로 응답이 셸 입력으로
    // 새어 프롬프트에 `[>0;276;0c` 가 찍힌다(2026-08-10 사용자 신고 — pane 재마운트·HMR
    // 직후의 재attach 마다 1회). 사용자가 키보드로 만들 수 없는 시퀀스라 걸러도 잃는 것이
    // 없고, tmux 의 기능 판정은 conf 의 terminal-features 가 명시한다 — MO(mobile.ts)와
    // 같은 필터다(features/terminal.md 'DA 응답' 절).
    const dataSub = term.onData((raw) => {
      const data = raw.replace(DA_REPLY_RE, '');
      if (data) window.oneApp.terminal.write(id, data);
    });
    // Shift+Enter = 줄바꿈 (superset 동일 동작) — 터미널은 원래 Enter 의 수정키를 구분하지
    // 못해 Shift 를 눌러도 그냥 \r(제출)이 간다. ESC+CR(\x1b\r)로 바꿔 보내면 claude 등
    // ink 기반 TUI 가 meta+return = 줄바꿈으로 해석한다 — macOptionIsMeta 로 이미 동작하던
    // Option+Enter 와 같은 경로의 별칭이다.
    // ⚠️ 대체 화면(TUI)에서만 개입한다 — 일반 화면(zsh 프롬프트)에서는 ESC+CR 이 개행이
    // 되지 않고 그 줄이 그대로 실행됐다(2026-08-06 실측). 셸은 기본 Enter 동작 유지.
    // ── 한글 조합 중 커서 이동 ─────────────────────────────────────────
    // ⚠️ 조합 중인 방향키를 xterm 에 넘기면 **마지막 글자가 복제된다**(2026-08-26 신고:
    // "가나다라마바사" → "사사사", "입력" → "입력력"). `CompositionHelper.keydown` 이
    // 방향키를 보면 `_finalizeComposition(false)` 로 조합을 **즉시** 확정하는데, 그때 쓰는
    // `_compositionPosition.end` 는 compositionupdate 의 setTimeout(0) 으로 갱신되므로
    // 아직 낡은 값이라 이미 보낸 글자를 다시 보낸다. 중복 방지 보정(`_dataAlreadySent`,
    // xterm #3191)은 `waitForPropagation=true` 경로에만 있어 이 경로엔 안 걸린다.
    // 물리 방향키·Home 은 IME 가 먼저 조합을 확정해 이 경로를 타지 않지만, **키를 합성해
    // 보내는 경우**(Karabiner 로 ⌘U/⌘J 를 방향키로 리맵 등)는 그 setTimeout 과 경합해
    // 조합 중에 도착한다.
    // 대응: 조합 중 커서 이동 키는 xterm 에 넘기지 않고(`return false` 면
    // `CoreBrowserTerminal._keyDown` 이 즉시 반환해 CompositionHelper 를 아예 안 탄다)
    // 보류했다가 compositionend 뒤에 시퀀스를 직접 보낸다 — 확정과 이동이 한 번에 된다.
    // ⚠️ ⌥+방향키는 넣지 않아도 된다 — `macOptionIsMeta: true` 라 xterm 이 alt 키를 조합
    // 처리에서 제외한다(`shouldIgnoreComposition`). ⇧ 동반 조합도 개입하지 않는다.
    let pendingCursorSeq: string | null = null;
    const composingCursorSeq = (ev: KeyboardEvent): string | null => {
      if (ev.ctrlKey || ev.altKey || ev.shiftKey) return null;
      // ⌘←/⌘→ 는 아래 비-조합 분기와 같은 시퀀스로 맞춘다 (줄 처음/끝)
      if (ev.metaKey) {
        if (ev.key === 'ArrowLeft') return '\x01';
        if (ev.key === 'ArrowRight') return '\x05';
        return null;
      }
      switch (ev.key) {
        case 'ArrowLeft':
          return '\x1b[D';
        case 'ArrowRight':
          return '\x1b[C';
        case 'ArrowUp':
          return '\x1b[A';
        case 'ArrowDown':
          return '\x1b[B';
        default:
          return null;
      }
    };
    // 조합 글자가 먼저 나간 다음에 이동해야 한다 — CompositionHelper 도 compositionend 에서
    // setTimeout(0) 으로 조합 결과를 보내는데, 이 리스너는 `term.open()` **이후** 등록이라
    // xterm 자신의 리스너보다 나중에 호출되고 그래서 우리 타이머가 뒤에 실행된다.
    const composeTarget = term.textarea;
    // compositionend 뒤 xterm 이 조합 결과를 setTimeout(0) 으로 보내기까지의 창 — 이 사이에도
    // CompositionHelper 는 `_isSendingComposition` 으로 '조합 중'과 같게 keydown 을 다룬다.
    // 우리 타이머는 xterm 것보다 뒤에 실행되므로(리스너 등록 순서) 그 창을 정확히 덮는다.
    let compositionSettling = false;
    const onCompositionEnd = () => {
      compositionSettling = true;
      window.setTimeout(() => {
        compositionSettling = false;
      }, 0);
      if (!pendingCursorSeq) return;
      const seq = pendingCursorSeq;
      pendingCursorSeq = null;
      window.setTimeout(() => {
        if (!disposed) window.oneApp.terminal.write(id, seq);
      }, 0);
    };
    // 핸들러가 직접 보내는 제어 시퀀스는 전부 이걸로 — ⚠️ compositionend 직후 정리 창에서는
    // 즉시 보내면 **조합 글자보다 먼저 도착**한다. IME 가 ⌘← 에서 '과' 를 확정하면 xterm 은
    // 그 글자를 setTimeout(0) 으로 미뤄 보내는데, 우리는 keydown 에서 \x01 을 바로 쏘니
    // '사과' 조합 중 ⌘U(=⌘←) → "과사"(2026-08-26 신고). xterm 자체는 이 창에 키가 오면
    // 글자를 먼저 flush 하지만(`CompositionHelper.keydown`), 커스텀 핸들러가 그보다 앞서
    // `return false` 하므로 그 경로를 못 탄다. 정리 창이면 같은 setTimeout(0) 으로 미룬다 —
    // xterm 의 타이머가 먼저 예약돼 있어 우리 것이 그 뒤에 실행된다.
    const writeKeySeq = (seq: string) => {
      if (!compositionSettling) {
        window.oneApp.terminal.write(id, seq);
        return;
      }
      window.setTimeout(() => {
        if (!disposed) window.oneApp.terminal.write(id, seq);
      }, 0);
    };
    composeTarget?.addEventListener('compositionend', onCompositionEnd);
    // ⚠️ 조합 중 **단독 수정키 keydown 은 xterm 에 넘기지 않는다** — `CompositionHelper.keydown`
    // 의 면제 목록은 CapsLock(20)·229·Shift/Ctrl/Alt(16/17/18) 뿐이라 **Meta(⌘, 91/93) 는
    // 조합을 즉시 확정하는 키로 취급**된다: 글자를 한 번 보내고, 뒤이은 진짜 compositionend
    // 가 `substring(start)` 로 같은 글자를 다시 보낸다 → 마지막 글자 중복. Karabiner 가
    // `⌘J → ←` 처럼 수정키 없는 키로 리맵하면 `⌘ up → ← → ⌘ down` 으로 합성하므로 이동
    // 직후 **⌘ keydown 이 조합 중에 도착**한다("입력중" → "입력중중", 2026-08-26 신고 —
    // 물리 화살표엔 ⌘ 재누름이 없어 무사). xterm 은 단독 수정키 keydown 으로 하는 일이 없어
    // 막아도 잃는 기능이 없다(Shift/Ctrl/Alt 는 xterm 도 면제하지만 통일해서 막는다).
    const MODIFIER_KEYS = new Set(['Meta', 'Shift', 'Control', 'Alt', 'CapsLock']);
    // ── 숨은 textarea 캐럿 ──────────────────────────────────────────────
    // ⚠️ 아래 핸들러에서 가로채 `return false` 하는 키는 `ev.preventDefault()` 도 함께 한다
    // (예외: 조합 중 커서 보류 분기 — 그 이유는 해당 분기 주석) — xterm 은 커스텀 핸들러가
    // false 를 주면 cancel() 없이 바로 빠져나가므로
    // 브라우저의 기본 편집 명령(⌘← = moveToBeginningOfLine, ⌘⌫ = deleteToBeginningOfLine,
    // Enter = 개행 삽입)이 **xterm 의 숨은 textarea** 에 그대로 적용된다. 한글 등 IME 입력은
    // 그 textarea 를 거치는데, `CompositionHelper` 는 조합 위치를 `textarea.value.length`
    // (= 항상 끝에 붙는다는 가정)로만 계산한다. 그래서 캐럿이 앞으로 옮겨진 뒤에는 조합이
    // 끝날 때마다 새 글자 대신 textarea 끝에 남은 글자가 잘려 나갔다 — '가나다라' 입력 →
    // ⌘←(Karabiner ⌘U) → 아무 글자나 쳐도 '라라라라 가나다라'(2026-08-26 신고). textarea 는
    // Enter/^C 때만 비워지므로 한 번 어긋나면 그 줄 내내 반복된다.
    const rehomeCaret = () => {
      // 안전망 — 어떤 경로로든 캐럿이 끝에서 벗어났으면 다음 조합이 시작되기 전에 되돌린다.
      // 조합 첫 keydown 은 keyCode 229·isComposing=false 로 오고 IME 의 텍스트 삽입은 그 뒤에
      // 처리되므로 이 시점에 고치면 삽입 위치가 맞는다. 조합 중엔 IME 가 캐럿의 주인이라
      // 건드리지 않는다.
      const ta = term.textarea;
      if (!ta) return;
      const len = ta.value.length;
      if (ta.selectionStart !== len || ta.selectionEnd !== len) ta.setSelectionRange(len, len);
    };
    term.attachCustomKeyEventHandler((ev) => {
      if (
        ev.type === 'keydown' &&
        (ev.isComposing || compositionSettling) &&
        MODIFIER_KEYS.has(ev.key)
      )
        return false; // 조합 중 단독 수정키 — 위 설명 참고
      if (ev.type === 'keydown' && !ev.isComposing) rehomeCaret();
      // 한글 조합 중 커서 이동 — 위 설명 참고. keydown 에서만 보류하고 keypress·keyup 까지
      // 막아 xterm 이 손대지 못하게 한다.
      // ⚠️ 여기서는 preventDefault 를 **하지 않는다** — 브라우저 편집 명령(moveLeft 등)이
      // textarea 캐럿을 옮기며 IME 조합을 끝내 주는 경로가 곧 보류한 시퀀스를 내보내는
      // 방아쇠다. 캐럿이 어긋나는 문제는 아래 `rehomeCaret` 이 다음 keydown 에서 되돌린다.
      if (ev.isComposing) {
        const seq = composingCursorSeq(ev);
        if (seq) {
          if (ev.type === 'keydown') pendingCursorSeq = seq;
          return false;
        }
      }
      // ⌘⌫ = 줄 지우기 (macOS 관례) — xterm 은 Backspace 에서 meta 를 무시해 한 글자만
      // 지워진다. VS Code·iTerm 처럼 Ctrl+U(\x15)로 바꿔 보내면 zsh(kill-whole-line)·
      // claude 입력줄 모두 커서가 있는 줄 전체를 지운다.
      if (
        ev.key === 'Backspace' &&
        ev.metaKey &&
        !ev.ctrlKey &&
        !ev.altKey &&
        !ev.shiftKey &&
        !ev.isComposing
      ) {
        ev.preventDefault(); // 기본 동작(deleteToBeginningOfLine)이 textarea 를 건드리지 않게
        if (ev.type === 'keydown') writeKeySeq('\x15');
        return false; // keypress·keyup 도 막는다 (Shift+Enter 와 같은 이유)
      }
      // ⌘←/⌘→ = 줄 처음/끝 (macOS 관례) — xterm 은 meta+화살표를 아예 버려서
      // (Keyboard.ts `if (ev.metaKey) break`) 셸에 아무것도 가지 않는다. Home/End
      // 시퀀스(ESC[H/F)는 맨 zsh 가 안 묶는 경우가 많아, zsh(emacs 모드)·claude 가
      // 모두 아는 Ctrl+A(\x01)/Ctrl+E(\x05)로 바꿔 보낸다.
      if (
        ev.metaKey &&
        !ev.ctrlKey &&
        !ev.altKey &&
        !ev.shiftKey &&
        !ev.isComposing &&
        (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight')
      ) {
        // ⚠️ preventDefault 필수 — 없으면 ⌘← 가 숨은 textarea 캐럿을 맨 앞으로 옮겨 이후
        // 한글 조합이 전부 마지막 글자로 바뀐다(위 '숨은 textarea 캐럿').
        ev.preventDefault();
        if (ev.type === 'keydown') writeKeySeq(ev.key === 'ArrowLeft' ? '\x01' : '\x05');
        return false;
      }
      if (
        ev.key === 'Enter' &&
        ev.shiftKey &&
        !ev.metaKey &&
        !ev.ctrlKey &&
        !ev.altKey &&
        term.buffer.active.type === 'alternate'
      ) {
        // 한글 조합 중(isComposing)이면 줄바꿈을 보내지 않고 차단만 한다 — xterm 에
        // 넘기면 CompositionHelper 가 '조합 확정 + \r 전송'으로 처리해 메시지가 그대로
        // 제출됐다(2026-08-12). 조합 확정은 IME/compositionend 가 알아서 하고,
        // 줄바꿈은 조합이 끝난 다음 누름에서 들어간다.
        if (!ev.isComposing) {
          ev.preventDefault(); // 기본 동작(textarea 에 개행 삽입)을 막는다 — 조합 중엔 IME 에 맡긴다
          if (ev.type === 'keydown') writeKeySeq('\x1b\r');
        }
        return false; // keydown 외 keypress·keyup 도 막아야 xterm 이 \r 를 덧보내지 않는다
      }
      return true;
    });
    // ── 휠 스크롤 ──────────────────────────────────────────────────────
    // ⚠️ tmux 백엔드에서는 **tmux 가 스크롤백의 주인**이다 — tmux 클라이언트가 대체 화면
    // 으로 붙어서 xterm 뷰포트에는 스크롤할 것이 아무것도 쌓이지 않는다. 그대로 두면
    // xterm 이 "대체 화면 = 스크롤백 없음" 규칙으로 **휠을 ↑↓ 키로 바꿔 보내** 셸의
    // 이전 명령이 롤링됐다(2026-08-11 사용자 신고). 그래서 휠을 가로채 main 으로 넘기고
    // tmux 의 copy-mode 를 움직인다 — 마우스 트래킹을 켜지 않으므로 xterm 의 드래그 선택·
    // 링크 클릭·⌘F 검색은 그대로다.
    let wheelLines = 0; // 소수 누적 — 트랙패드는 한 틱이 1줄에 못 미친다
    let wheelTimer: number | null = null;
    let wheelBusy = false; // 왕복 중 — 겹쳐 보내지 않고 다음 flush 에 합친다
    const flushWheel = () => {
      wheelTimer = null;
      const scroll = window.oneApp.terminal.scroll;
      if (wheelBusy || !scroll) {
        if (wheelBusy) wheelTimer = window.setTimeout(flushWheel, WHEEL_FLUSH_MS);
        return;
      }
      const n = Math.trunc(wheelLines);
      if (!n) return;
      wheelLines -= n;
      wheelBusy = true;
      void scroll(id, n)
        .then((res) => {
          if (!disposed) onScrolledChangeRef.current(id, res.scrolledUp);
        })
        .finally(() => {
          wheelBusy = false;
        });
    };
    term.attachCustomWheelEventHandler((ev) => {
      // 폴백(tmux 미설치) 세션은 xterm 에 스크롤백이 쌓이므로 기본 동작이 옳다
      if (!tmuxRef.current) return true;
      // ⚠️ 마우스 트래킹을 켠 앱(claude 등)에는 휠을 **그대로 넘긴다** — 그 앱들이 자체
      // 스크롤을 갖고 있고(claude 의 Jump to bottom), 대체 화면이라 tmux 스크롤백도 없다.
      // 단 claude 는 리렌더마다 모드를 껐다 켜서 이 판정이 순간적으로 'none' 일 수 있다
      // (2026-08-12 실측) — 그 틈에 위임된 휠은 tmuxScrollPane 의 마우스 플래그 분기가
      // SGR 휠 주입으로 받아내므로 여기서 추가로 방어할 필요는 없다.
      if (term.modes.mouseTrackingMode !== 'none') return true;
      wheelLines += wheelLinesOf(ev, host.clientHeight / term.rows, term.rows);
      if (wheelTimer === null) wheelTimer = window.setTimeout(flushWheel, WHEEL_FLUSH_MS);
      return false;
    });

    // PTY 크기 전달은 디바운스 — 창 드래그 중엔 매 프레임 크기가 바뀌고, 그때마다
    // SIGWINCH 를 보내면 claude 같은 TUI 가 전체 리렌더를 반복해 화면이 요동친다.
    // 마지막 값만 보내면 드래그가 끝난 크기로 한 번 맞춰진다(last-claim-wins 유지).
    //
    // ⚠️ 다만 **디바운스만 두면 안 된다** — xterm 은 fit 으로 즉시 줄어드는데(rAF) 대체 화면
    // (claude 등)은 리플로우 대상이 아니라 새 영역이 빈칸으로 남고, SIGWINCH 가 나가기 전엔
    // 그 빈칸을 채워 줄 출력이 없다. 드래그를 붙잡고 있는 내내 타이머가 리셋되므로
    // **검은 화면이 드래그 시간만큼 유지됐다**(2026-08-20 사용자 신고). 그래서 디바운스 위에
    // **마지막 전송 시각 기준 스로틀**을 겹친다 — 통과하면 그 자리에서 보내 화면을 채운다.
    // (1회 리렌더는 1.5KB/2 chunk 라 이 주기로는 요동치지 않는다 — terminal-notes.md 실측)
    //
    // ⚠️ 기준은 '대기 시작'이 아니라 **'마지막 전송'** 이어야 한다 — 대기 시작 기준으로 재면
    // 리사이즈를 시작한 직후 첫 THROTTLE 만큼은 여전히 아무도 화면을 안 채운다(실측 270ms).
    // 그렇다고 '타이머가 없으면 즉시'로 짜면 전송 후 타이머가 비어 다음 프레임도 즉시가 되고,
    // 그게 정확히 원래 막으려던 매-프레임 폭주다. 마지막 전송 시각으로만 스로틀이 성립한다.
    let ptyResizeTimer: number | null = null;
    let ptyResizeSentAt = 0;
    const resizeSub = term.onResize(({ cols, rows }) => {
      // ⚠️ 숨은 pane 은 PTY 크기를 주장하지 않는다 — 세션마다 xterm 을 살려 두므로
      // 안 막으면 안 보이는 세션들이 창 리사이즈마다 자기 크기를 밀어넣고,
      // 폰(MO)이 보고 있는 세션의 크기까지 되돌려 버린다(크기 공유는 마지막 주장 기준).
      // 분할로 보이는 pane 들은 각자 **자기 세션**의 크기를 주장하므로 서로 충돌하지 않는다.
      if (!visibleRef.current) return;
      if (ptyResizeTimer !== null) window.clearTimeout(ptyResizeTimer);
      const send = () => {
        ptyResizeTimer = null;
        ptyResizeSentAt = Date.now();
        window.oneApp.terminal.resize(id, cols, rows);
      };
      // 스로틀 통과 — 지금 값이 곧 최신 값이므로 즉시 보낸다(최종값 보장은 이어지는
      // resize 이벤트가 다시 거는 트레일링 타이머가 맡는다)
      if (Date.now() - ptyResizeSentAt >= PTY_RESIZE_THROTTLE_MS) {
        send();
        return;
      }
      ptyResizeTimer = window.setTimeout(send, PTY_RESIZE_DEBOUNCE_MS);
    });

    // 백엔드 확인 — tmux 면 스크롤을 위임한다(위 휠 핸들러). 조회 전에 굴린 휠은
    // 기존 동작(xterm 기본)으로 처리되지만, 사실상 첫 프레임 안에 답이 온다.
    // (앱 수명 동안 불변이라 `terminalBackend` 가 IPC 를 1회만 왕복한다)
    void terminalBackend().then((b) => {
      if (!disposed) tmuxRef.current = b.tmux;
    });

    void window.oneApp.terminal
      .attach(id, term.cols, term.rows)
      .then((res) => {
        if (disposed || !res.ok) return;
        // 대체 화면(TUI) 세션은 replay 가 생략되므로(잔상 방지) 새 xterm 은 화면 전환
        // 시퀀스(?1049h)를 영영 못 본다 — buffer 타입이 'normal' 로 남아 Shift+Enter
        // 줄바꿈 게이트가 꺼졌다(다른 섹션에 갔다 오면 제출로 새던 버그, 2026-08-12).
        // tmux 가 알려준 실제 상태를 합성해 모델을 맞춘다. 내용은 이어지는 리드로가 채운다.
        if (res.alt) term.write('\x1b[?1049h');
        if (res.replay) term.write(res.replay);
        attachSeq = res.seq ?? 0;
        for (const ev of queue) {
          if (ev.seq > attachSeq) term.write(ev.data);
        }
        queue.length = 0;
        if (focusedRef.current) term.focus(); // 포커스 pane 이 아니면 훔치지 않는다
        // 마운트 직후엔 레이아웃이 아직 안정되지 않아 fit 이 좁게 잡힐 수 있다(탭바·스크롤바
        // 확정 전). 다음 프레임에 한 번 더 맞춰 잘못된 크기를 PTY 에 남기지 않는다.
        requestAnimationFrame(() => {
          if (!disposed) fit.fit();
        });
      });

    // 컨테이너 크기가 실제로 바뀔 때만 fit — xterm 내부 리렌더(다른 클라이언트가 보낸
    // resize 등)로 옵서버가 깨어나도 fit 을 돌리면 MO 가 맞춘 PTY 크기를 즉시 되돌려 버린다.
    // fit 자체는 rAF 로 코얼레스한다 — 드래그 중 옵서버는 프레임마다 깨어나고,
    // fit 이 xterm DOM 을 건드려 다시 옵서버를 깨우므로 즉시 실행하면 진동이 커진다.
    let lastBox = `${host.clientWidth}x${host.clientHeight}`;
    let fitRaf: number | null = null;
    const ro = new ResizeObserver(() => {
      const box = `${host.clientWidth}x${host.clientHeight}`;
      if (box === lastBox) return;
      lastBox = box;
      if (fitRaf !== null) return;
      fitRaf = requestAnimationFrame(() => {
        fitRaf = null;
        if (disposed) return;
        lastBox = `${host.clientWidth}x${host.clientHeight}`; // fit 직전 크기로 기준 갱신
        fit.fit();
      });
    });
    ro.observe(host);

    // 창으로 돌아오면 내 화면 크기를 다시 주장한다 — MO 가 폰 크기로 줄여 둔 채면
    // 데스크톱에 빈 공간이 남고 좁게 보인다(크기 공유는 '마지막에 주장한 쪽' 기준).
    const reclaimSize = () => {
      if (!visibleRef.current) return; // 숨은 pane 은 주장하지 않는다 (onResize 와 같은 이유)
      const dims = fit.proposeDimensions();
      if (!dims?.cols || !dims.rows) return;
      if (dims.cols !== term.cols || dims.rows !== term.rows) {
        term.resize(dims.cols, dims.rows); // onResize 가 PTY 까지 전달
      } else {
        // xterm 은 이미 내 크기인데 PTY 만 다른 경우 — 직접 재주장(같으면 main 이 무시)
        window.oneApp.terminal.resize(id, dims.cols, dims.rows);
      }
    };
    reclaimRef.current = reclaimSize;
    window.addEventListener('focus', reclaimSize);

    return () => {
      disposed = true;
      reclaimRef.current = null;
      onScrolledChangeRef.current(id, false); // 상단 바의 [맨 아래로] 잔존 방지
      ro.disconnect();
      if (fitRaf !== null) cancelAnimationFrame(fitRaf);
      if (ptyResizeTimer !== null) window.clearTimeout(ptyResizeTimer);
      if (wheelTimer !== null) window.clearTimeout(wheelTimer);
      window.removeEventListener('focus', reclaimSize);
      composeTarget?.removeEventListener('compositionend', onCompositionEnd);
      // detach — 안 보는 세션의 출력 방송을 멈춘다 (?. 는 구 preload 재시작 전 대비)
      window.oneApp.terminal.detach?.(id);
      offData();
      offResized();
      dataSub.dispose();
      resizeSub.dispose();
      resultSub.dispose();
      scrollSub.dispose();
      bufferSub.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      searchRef.current = null;
    };
  }, [id]);

  // 글자 크기 변경 — xterm 옵션을 바꾼 뒤 fit 을 다시 돌려 행·열을 맞춘다
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    if (term.options.fontSize === fontSize) return;
    term.options.fontSize = fontSize;
    fitRef.current?.fit();
  }, [fontSize]);

  // 보이게 된 순간 — 숨어 있는 동안 크기를 주장하지 않았으므로 여기서 되찾는다.
  // (숨은 pane 도 계속 마운트돼 있어 스크롤백·선택·검색 상태가 그대로 남는다)
  // ⚠️ 여기서 focus() 를 부르면 안 된다 — 분할로 여러 pane 이 동시에 보이게 될 때
  // 마지막에 나타난 pane 이 포커스를 훔친다. 포커스는 아래 focused effect 가 담당.
  useEffect(() => {
    if (!visible) return;
    fitRef.current?.fit();
    reclaimRef.current?.();
    // 숨어 있는 동안 들어온 출력이 그리다 만 프레임으로 남아 있을 수 있어 전체를 다시 그린다.
    //
    // ⚠️ 여기서 `clearTextureAtlas()` 를 부르면 안 된다 — 아틀라스는 pane 사이 공유물이라
    // 탭을 옮길 때마다 **나머지 pane 을 전부 깨뜨린다**(`monoFontLoaded` 주석). 2026-08-06 에
    // 이 자리에 넣었던 clear 는 증상의 해결이 아니라 **깨짐을 옆 pane 으로 옮기는 것**이었다.
    //
    // ⚠️ refresh 한 번으로는 부족할 수 있다 — `RenderService.refreshRows()` 는 동기화 출력
    // (DEC 2026, tmux conf 의 `sync` feature)이 켜져 있는 동안엔 렌더 대신 범위만 버퍼링하고
    // 조용히 돌아간다. claude 의 선택지 대기처럼 **출력이 완전히 멈춘 화면**에서는 그 버퍼를
    // 흘려보낼 다음 출력이 없어 깨진 프레임이 그대로 남는다. 다음 프레임에 한 번 더 건다.
    const term = termRef.current;
    if (!term) return;
    const redraw = () => term.refresh(0, term.rows - 1);
    redraw();
    const raf = requestAnimationFrame(redraw);
    return () => cancelAnimationFrame(raf);
  }, [visible]);

  // 포커스 pane 이 된 순간 — 키보드 입력을 이 xterm 으로 (분할 중에도 항상 하나만)
  useEffect(() => {
    if (!focused || !visible) return;
    termRef.current?.focus();
  }, [focused, visible]);

  // 검색어가 바뀌면 첫 일치로 이동 — incremental 이라 타이핑 중 선택이 자연스럽게 늘어난다
  useEffect(() => {
    const search = searchRef.current;
    if (!search) return;
    if (!searchOpen || !query) {
      search.clearDecorations();
      setHits({ index: -1, count: 0 });
      return;
    }
    search.findNext(query, { incremental: true, decorations: searchDecorations() });
  }, [query, searchOpen]);

  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setQuery('');
    searchRef.current?.clearDecorations();
    termRef.current?.focus();
  }, []);

  const findStep = (back: boolean) => {
    const search = searchRef.current;
    if (!search || !query) return;
    const opts = { decorations: searchDecorations() };
    if (back) search.findPrevious(query, opts);
    else search.findNext(query, opts);
  };

  // ⌘F 로 검색 열기 — 세션마다 pane 이 마운트돼 있으므로 **포커스 pane 만** 바인딩한다
  // (visible 로 걸면 분할 중 보이는 pane 수만큼 핸들러가 붙어 검색이 한꺼번에 열린다).
  // xterm 은 Meta 조합을 셸로 보내지 않으므로 여기서 가로채도 입력을 빼앗지 않는다.
  useEffect(() => {
    if (!focused) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.altKey || e.ctrlKey) return;
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        openSearch();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focused, openSearch]);

  // 상단 공용 바가 이 pane 을 조작할 핸들 — 터미널 인스턴스를 직접 만지는 조작만 올린다
  useEffect(() => {
    onRegisterHandle(id, {
      openSearch,
      focus: () => termRef.current?.focus(),
      scrollToBottom: () => {
        termRef.current?.scrollToBottom(); // 폴백 세션(xterm 스크롤백)
        // tmux 세션은 copy-mode 를 끝내는 것이 곧 맨 아래로다
        if (!tmuxRef.current) return;
        void window.oneApp.terminal
          .scrollToBottom?.(id)
          .then(() => onScrolledChangeRef.current(id, false));
      },
    });
    return () => onRegisterHandle(id, null);
  }, [id, onRegisterHandle, openSearch]);

  // 분할 rect — 인라인 스타일 객체는 여기(컴포넌트 안)에서 조립한다.
  // props 로 객체를 받으면 memo 가 깨지지만 내부 생성은 memo 와 무관하다.
  const split = rectW !== undefined;
  const splitStyle =
    split && visible
      ? {
          left: `${rectLeft}%`,
          top: `${rectTop}%`,
          width: `${rectW}%`,
          height: `${rectH}%`,
        }
      : undefined;

  return (
    <div
      className={[
        'terminal__pane',
        splitStyle ? 'terminal__pane--split' : '',
        !visible ? 'terminal__pane--hidden' : '',
        splitStyle && focused ? 'terminal__pane--focused' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={splitStyle}
      // 어느 세션의 pane 인지 — 분할 화면 디버깅·E2E 조준용.
      // ⚠️ 탭이 쓰는 `data-session` 과 이름을 나눈다 — 탭바의 `overTabArea`(closest 판정)와
      // 셀렉터가 겹치면 드롭 영역 판정을 헷갈리게 만들 수 있다.
      data-pane-session={id}
      // capture — xterm 의 textarea 가 mousedown 을 먼저 소비해도 포커스 전환은 일어나야 한다
      onMouseDownCapture={() => onFocusPane(id)}
      // ── 이미지 붙여넣기 = Ctrl+V 위임 ──────────────────────────────────
      // ⌘V 는 Electron 기본 메뉴의 role:paste 로 처리돼 xterm 의 paste 핸들러에 닿는데,
      // xterm 은 `clipboardData.getData('text/plain')` **한 줄만** 읽는다(Clipboard.ts).
      // 캡처 이미지 클립보드는 평문 타입이 아예 없어(실측: PNGf·TIFF·JPEG… 뿐) 빈 문자열이
      // 그대로 흘러 **아무 일도 일어나지 않았다** — 오류도 로그도 없다(2026-08-13 사용자 신고).
      // Claude Code 는 `Ctrl+V`(0x16)를 받으면 시스템 클립보드를 직접 읽어 이미지를 첨부하므로
      // ⌘V 를 그 경로로 넘긴다. capture 단계라 xterm(element·textarea) 리스너보다 먼저다.
      onPasteCapture={(e) => {
        const items = Array.from(e.clipboardData?.items ?? []);
        if (!items.some((it) => it.kind === 'file' && it.type.startsWith('image/')))
          return;
        // 텍스트가 함께 있으면 그것이 사용자의 의도다 — 기존 경로(xterm)에 그대로 맡긴다
        if (e.clipboardData?.getData('text/plain')) return;
        // ⚠️ 대체 화면(TUI)에서만 개입한다 — 일반 셸에서 0x16 은 zsh 의 quoted-insert 라
        // 다음 키가 리터럴로 먹혀 입력이 깨진다. Shift+Enter 게이트와 같은 조건이다.
        if (termRef.current?.buffer.active.type !== 'alternate') return;
        e.preventDefault();
        e.stopPropagation();
        window.oneApp.terminal.write(id, '\x16');
      }}
      // ── 파일 드래그 앤 드롭 = 경로 입력 (Terminal.app 관례) ──────────────
      // capture 단계로 받는다 — xterm 의 canvas/textarea 가 이벤트를 삼키는 문제를
      // 세션 탭 드래그는 투명 드롭 존 오버레이로 피하지만(features/terminal.md), 파일
      // 드래그는 상시 기능이라 오버레이를 미리 깔 수 없다. 판정은 `Files` 타입 여부라
      // 세션 탭 드래그(커스텀 타입)와 겹치지 않고, 숨은 pane 은 pointer-events: none
      // 이라 이벤트 자체가 오지 않는다.
      onDragOverCapture={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault(); // 드롭 허용 표시 — 없으면 drop 이 발화하지 않는다
        e.dataTransfer.dropEffect = 'copy';
        // dragover 는 고빈도 — 동일값이면 setState 를 건너뛴다 (WorkspaceNav 와 같은 규칙)
        if (!fileDragOver) setFileDragOver(true);
      }}
      onDragLeave={(e) => {
        if (!fileDragOver) return;
        // 자식(xterm·오버레이)으로의 이동은 leave 가 아니다 — 창 밖·드래그 취소만 거둔다
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setFileDragOver(false);
      }}
      onDropCapture={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault(); // 기본 동작 = 창이 file:// 로 내비게이션 — 반드시 막는다
        setFileDragOver(false);
        // 경로는 preload 의 webUtils 경유 — 렌더러의 File 객체엔 경로가 없다(Electron 32+)
        const paths = Array.from(e.dataTransfer.files)
          .map((f) => window.oneApp.getPathForFile?.(f) ?? '')
          .filter(Boolean);
        if (!paths.length) return;
        // 말미 공백 — 경로에 이어서 바로 타이핑할 수 있게 (여러 개는 공백 연결)
        window.oneApp.terminal.write(id, paths.map(shellQuotePath).join(' ') + ' ');
        onFocusPane(id); // 경로를 넣었으니 이어서 입력할 곳도 이 pane 이다
        termRef.current?.focus();
      }}
    >
      {searchOpen && (
        <div className="terminal__search">
          <Input
            small
            autoFocus
            aria-label="터미널 검색"
            placeholder="검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                findStep(e.shiftKey);
              } else if (e.key === 'Escape') {
                closeSearch();
              }
            }}
          />
          <span className="terminal__search-count">
            {query
              ? hits.count > 0
                ? `${hits.index + 1}/${hits.count}`
                : '없음'
              : ''}
          </span>
          <Tooltip label="이전 일치 (⇧⏎)">
            <button
              type="button"
              className="icon-btn"
              aria-label="이전 일치"
              onClick={() => findStep(true)}
            >
              <Icon name="chevron-up" size={14} />
            </button>
          </Tooltip>
          <Tooltip label="다음 일치 (⏎)">
            <button
              type="button"
              className="icon-btn"
              aria-label="다음 일치"
              onClick={() => findStep(false)}
            >
              <Icon name="chevron-down" size={14} />
            </button>
          </Tooltip>
          <Tooltip label="검색 닫기 (Esc)">
            <button
              type="button"
              className="icon-btn"
              aria-label="검색 닫기"
              onClick={closeSearch}
            >
              <Icon name="x" size={14} />
            </button>
          </Tooltip>
        </div>
      )}

      {fileDragOver && (
        <div className="terminal__file-drop">
          <span className="terminal__file-drop-label">놓으면 경로 입력</span>
        </div>
      )}

      <div className="terminal__host" ref={hostRef} />
    </div>
  );
});
