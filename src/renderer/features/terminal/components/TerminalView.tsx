// 세션 하나를 xterm 으로 화면에 붙인다 — attach(replay 복원)·입출력·리사이즈 동기화 담당.
// 탭 전환 시 언마운트→재마운트되며, 그때마다 attach 가 링버퍼 replay 로 스크롤백을 복원하고
// SIGWINCH redraw(main 담당)가 현재 화면을 다시 그린다. 모바일(MO)도 같은 방식으로 붙는다.
//
// 상단 툴바(제목 + 검색·글자크기·클리어·맨아래로·Finder·복제)는 터미널 인스턴스를 직접
// 만지므로 이 컴포넌트가 함께 소유한다 — 바깥에서 조작하려면 핸들을 들고 다녀야 한다.
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
import { useToast } from '../../../components/Toast';
import { Tooltip } from '../../../components/Tooltip';
import type { TerminalPreset } from '../../../../shared/types';
import { PresetBar } from './PresetBar';

const cssVar = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// PTY 크기 전달 지연 — 창 드래그가 멈춘 뒤 한 번만 SIGWINCH 를 보낸다
const PTY_RESIZE_DEBOUNCE_MS = 120;

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

/**
 * ⚠️ 세션 객체(TerminalSessionInfo)가 아니라 **id·cwd 만** 받는다 — 세션 목록 브로드캐스트는
 * 상태(busy↔waiting)가 바뀔 때마다 오고 그때마다 객체가 새로 만들어지는데, 객체를 그대로
 * 받으면 memo 가 매번 깨져 살아 있는 모든 pane 이 함께 리렌더된다. 여기서 실제로 쓰는 값은
 * 이 둘뿐이라 원시값으로 쪼개면 memo 가 유지된다(제목·상태는 탭바가 표시한다).
 */
export const TerminalView = memo(function TerminalView({
  sessionId: id,
  cwd,
  active,
  fontSize,
  onFontSize,
  presets,
  onRunPreset,
  onEditPresets,
}: {
  sessionId: string;
  /** 세션의 작업 폴더 — 프리셋 실행 위치·툴팁에 쓴다 */
  cwd: string;
  /** 지금 보이는 세션인지 — 숨은 pane 은 크기를 주장하지 않는다(아래 activeRef 참고) */
  active: boolean;
  fontSize: number;
  onFontSize: (n: number) => void;
  /** 프리셋 바 칩 — 이 세션의 워크스페이스에 해당하는 것만 (Superset 동일) */
  presets: TerminalPreset[];
  /** 칩 클릭 = 같은 위치의 새 세션에서 명령 실행 (Superset executionMode: new-tab).
   *  cwd 를 함께 넘겨 상위가 세션마다 다른 화살표를 만들지 않아도 되게 한다(memo 유지) */
  onRunPreset: (cwd: string, preset: TerminalPreset) => void;
  onEditPresets: () => void;
}) {
  const toast = useToast();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const reclaimRef = useRef<(() => void) | null>(null);
  // 콜백 안에서 최신 active 를 봐야 한다 — 마운트 effect 는 세션당 한 번만 돌기 때문
  const activeRef = useRef(active);
  activeRef.current = active;

  const fontSizeRef = useRef(fontSize);
  fontSizeRef.current = fontSize;

  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState({ index: -1, count: 0 });
  // 스크롤백을 위로 올린 상태에서만 [맨 아래로] 를 띄운다.
  // 대체 화면(claude 등 TUI)은 스크롤백이 없고 자체 'Jump to bottom' 이 있어 대상이 아니다.
  // ⚠️ tmux 백엔드에서는 tmux 클라이언트가 화면 전체를 직접 그려 **xterm 쪽 스크롤백이
  // 아예 쌓이지 않는다**(2026-08-05 실측: viewport scrollHeight == clientHeight, 슬라이더 0px).
  // 즉 이 버튼은 tmux 미설치 폴백 세션에서만 실제로 등장한다.
  const [scrolledUp, setScrolledUp] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    const term = new Terminal({
      fontFamily: cssVar('--font-mono') || 'ui-monospace, Menlo, monospace',
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
    void document.fonts.ready.then(() => {
      if (disposed) return;
      term.clearTextureAtlas();
      fit.fit();
    });

    const resultSub = search.onDidChangeResults((e) =>
      setHits({ index: e.resultIndex, count: e.resultCount })
    );
    // 스크롤 위치 추적 — xterm 6 은 네이티브 스크롤 영역이 없어 buffer 좌표로 판정한다
    const atBottom = () => {
      const b = term.buffer.active;
      return b.type === 'alternate' || b.viewportY >= b.baseY;
    };
    const syncScrolled = () => setScrolledUp(!atBottom());
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
    const dataSub = term.onData((data) => window.oneApp.terminal.write(id, data));
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
    // PTY 크기 전달은 디바운스 — 창 드래그 중엔 매 프레임 크기가 바뀌고, 그때마다
    // SIGWINCH 를 보내면 claude 같은 TUI 가 전체 리렌더를 반복해 화면이 요동친다.
    // 마지막 값만 보내면 드래그가 끝난 크기로 한 번 맞춰진다(last-claim-wins 유지).
    let ptyResizeTimer: number | null = null;
    const resizeSub = term.onResize(({ cols, rows }) => {
      // ⚠️ 숨은 pane 은 PTY 크기를 주장하지 않는다 — 세션마다 xterm 을 살려 두므로
      // 안 막으면 안 보이는 세션들이 창 리사이즈마다 자기 크기를 밀어넣고,
      // 폰(MO)이 보고 있는 세션의 크기까지 되돌려 버린다(크기 공유는 마지막 주장 기준).
      if (!activeRef.current) return;
      if (ptyResizeTimer !== null) window.clearTimeout(ptyResizeTimer);
      ptyResizeTimer = window.setTimeout(() => {
        ptyResizeTimer = null;
        window.oneApp.terminal.resize(id, cols, rows);
      }, PTY_RESIZE_DEBOUNCE_MS);
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
        if (activeRef.current) term.focus(); // 숨은 pane 이 포커스를 훔치지 않게
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
      if (!activeRef.current) return; // 숨은 pane 은 주장하지 않는다 (onResize 와 같은 이유)
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
      ro.disconnect();
      if (fitRaf !== null) cancelAnimationFrame(fitRaf);
      if (ptyResizeTimer !== null) window.clearTimeout(ptyResizeTimer);
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

  // 보이게 된 순간 — 숨어 있는 동안 크기를 주장하지 않았으므로 여기서 되찾고 포커스를 준다.
  // (숨은 pane 도 계속 마운트돼 있어 스크롤백·선택·검색 상태가 그대로 남는다)
  useEffect(() => {
    if (!active) return;
    fitRef.current?.fit();
    reclaimRef.current?.();
    // ⚠️ 숨어 있는 동안 WebGL 텍스처 아틀라스가 깨진 채 남을 수 있다(글자가 조각나거나
    // 엉뚱한 위치에 그려짐 — 2026-08-06 사용자 보고, 리사이즈로만 복구되던 증상).
    // 활성화 때 아틀라스를 버리고 전체를 다시 그려 리사이즈와 같은 복구를 강제한다
    // (아틀라스는 lazy 재생성이라 비용은 첫 프레임 글리프 다시 굽기 정도).
    const term = termRef.current;
    if (term) {
      try {
        term.clearTextureAtlas();
      } catch {
        // WebGL 폴백(DOM 렌더러) 상태면 no-op — 아래 refresh 만으로 충분
      }
      term.refresh(0, term.rows - 1);
    }
    term?.focus();
  }, [active]);

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

  // ⌘F 로 검색 열기 — 세션마다 pane 이 마운트돼 있으므로 **보이는 pane 만** 바인딩한다
  // (안 그러면 세션 수만큼 핸들러가 붙어 숨은 pane 의 검색까지 함께 열린다).
  // xterm 은 Meta 조합을 셸로 보내지 않으므로 여기서 가로채도 입력을 빼앗지 않는다.
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.altKey || e.ctrlKey) return;
      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        openSearch();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, openSearch]);

  const reveal = async () => {
    const res = await window.oneApp.terminal.revealCwd(id);
    if (!res.ok) toast('위치를 열지 못했습니다.', 'fail');
  };

  // 프리셋 실행 — 위치(cwd)는 이 pane 이 알고 있으므로 여기서 붙인다
  const runPreset = useCallback(
    (p: TerminalPreset) => onRunPreset(cwd, p),
    [cwd, onRunPreset]
  );

  return (
    <div className={`terminal__pane${active ? '' : ' terminal__pane--hidden'}`}>
      <div className="terminal__bar">
        {/* 세션 제목은 상단 탭이 이미 보여주므로 바에 중복 표기하지 않는다.
            바 자체는 '세션 없음' 화면과 공용(PresetBar) — 같은 자리에 계속 떠 있다 */}
        <PresetBar
          presets={presets}
          cwd={cwd}
          onRun={runPreset}
          onEdit={onEditPresets}
        />
        {/* 아이콘만으로는 무슨 기능인지 알 수 없어 전부 Tooltip 으로 감싼다.
            네이티브 title 은 지연이 길고 어두운 툴바에서 눈에 안 띈다(2026-08-05 사용자 지적).
            접근성 이름은 툴팁이 아니라 각 버튼의 aria-label 이 담당한다. */}
        <span className="terminal__bar-actions">
          <Tooltip label="검색 (⌘F)">
            <button
              type="button"
              className="icon-btn"
              aria-label="검색"
              onClick={openSearch}
            >
              <Icon name="search" size={14} />
            </button>
          </Tooltip>
          <Tooltip label="글자 작게">
            <button
              type="button"
              className="icon-btn"
              aria-label="글자 작게"
              disabled={fontSize <= FONT_SIZE_MIN}
              onClick={() => onFontSize(Math.max(FONT_SIZE_MIN, fontSize - 1))}
            >
              <Icon name="minus" size={14} />
            </button>
          </Tooltip>
          <Tooltip
            label={`글자 크기 ${fontSize}px — 눌러서 기본(${FONT_SIZE_DEFAULT}px)으로`}
          >
            <button
              type="button"
              className="icon-btn"
              aria-label={`글자 크기 ${fontSize}px — 기본으로 되돌리기`}
              onClick={() => onFontSize(FONT_SIZE_DEFAULT)}
            >
              <span className="terminal__bar-size">{fontSize}</span>
            </button>
          </Tooltip>
          <Tooltip label="글자 크게">
            <button
              type="button"
              className="icon-btn"
              aria-label="글자 크게"
              disabled={fontSize >= FONT_SIZE_MAX}
              onClick={() => onFontSize(Math.min(FONT_SIZE_MAX, fontSize + 1))}
            >
              <Icon name="plus" size={14} />
            </button>
          </Tooltip>
          {scrolledUp && (
            <Tooltip label="맨 아래로">
              <button
                type="button"
                className="icon-btn"
                aria-label="맨 아래로"
                onClick={() => termRef.current?.scrollToBottom()}
              >
                <Icon name="arrow-down-to-line" size={14} />
              </button>
            </Tooltip>
          )}
          <Tooltip label="세션 위치를 Finder 에서 열기">
            <button
              type="button"
              className="icon-btn"
              aria-label="Finder 에서 열기"
              onClick={() => void reveal()}
            >
              <Icon name="folder" size={14} />
            </button>
          </Tooltip>
        </span>
      </div>

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
