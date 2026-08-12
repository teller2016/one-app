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
    term.attachCustomKeyEventHandler((ev) => {
      if (
        ev.key === 'Enter' &&
        ev.shiftKey &&
        !ev.metaKey &&
        !ev.ctrlKey &&
        !ev.altKey &&
        !ev.isComposing && // 한글 조합 확정용 Enter 는 IME 에 맡긴다
        term.buffer.active.type === 'alternate'
      ) {
        if (ev.type === 'keydown') window.oneApp.terminal.write(id, '\x1b\r');
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
    let ptyResizeTimer: number | null = null;
    const resizeSub = term.onResize(({ cols, rows }) => {
      // ⚠️ 숨은 pane 은 PTY 크기를 주장하지 않는다 — 세션마다 xterm 을 살려 두므로
      // 안 막으면 안 보이는 세션들이 창 리사이즈마다 자기 크기를 밀어넣고,
      // 폰(MO)이 보고 있는 세션의 크기까지 되돌려 버린다(크기 공유는 마지막 주장 기준).
      // 분할로 보이는 pane 들은 각자 **자기 세션**의 크기를 주장하므로 서로 충돌하지 않는다.
      if (!visibleRef.current) return;
      if (ptyResizeTimer !== null) window.clearTimeout(ptyResizeTimer);
      ptyResizeTimer = window.setTimeout(() => {
        ptyResizeTimer = null;
        window.oneApp.terminal.resize(id, cols, rows);
      }, PTY_RESIZE_DEBOUNCE_MS);
    });

    // 백엔드 확인 — tmux 면 스크롤을 위임한다(위 휠 핸들러). 조회 전에 굴린 휠은
    // 기존 동작(xterm 기본)으로 처리되지만, 사실상 첫 프레임 안에 답이 온다.
    void window.oneApp.terminal.backend().then((b) => {
      if (!disposed) tmuxRef.current = b.tmux;
    });

    void window.oneApp.terminal
      .attach(id, term.cols, term.rows)
      .then((res) => {
        if (disposed || !res.ok) return;
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

      <div className="terminal__host" ref={hostRef} />
    </div>
  );
});
