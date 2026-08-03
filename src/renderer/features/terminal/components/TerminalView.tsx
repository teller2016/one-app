// 세션 하나를 xterm 으로 화면에 붙인다 — attach(replay 복원)·입출력·리사이즈 동기화 담당.
// 탭 전환 시 언마운트→재마운트되며, 그때마다 attach 가 링버퍼 replay 로 스크롤백을 복원하고
// SIGWINCH redraw(main 담당)가 현재 화면을 다시 그린다. 모바일(MO)도 같은 방식으로 붙는다.
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef } from 'react';

const cssVar = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

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

export function TerminalView({ id }: { id: string }) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let disposed = false;
    const term = new Terminal({
      fontFamily: cssVar('--font-mono') || 'ui-monospace, Menlo, monospace',
      fontSize: 13, // 앱 본문(type-body)과 같은 크기 — 12px 는 터미널로 쓰기엔 작다
      lineHeight: 1.35,
      cursorBlink: true,
      macOptionIsMeta: true, // Option 을 Meta 로 — CLI 단어 이동(⌥←/→ 등)
      scrollback: 5000,
      allowTransparency: true, // 배경을 패널 CSS 에 맡긴다 (buildTheme 주석 참고)
      theme: buildTheme(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();

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
    const resizeSub = term.onResize(({ cols, rows }) =>
      window.oneApp.terminal.resize(id, cols, rows)
    );

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
        term.focus();
        // 마운트 직후엔 레이아웃이 아직 안정되지 않아 fit 이 좁게 잡힐 수 있다(탭바·스크롤바
        // 확정 전). 다음 프레임에 한 번 더 맞춰 잘못된 크기를 PTY 에 남기지 않는다.
        requestAnimationFrame(() => {
          if (!disposed) fit.fit();
        });
      });

    // 컨테이너 크기가 실제로 바뀔 때만 fit — xterm 내부 리렌더(다른 클라이언트가 보낸
    // resize 등)로 옵서버가 깨어나도 fit 을 돌리면 MO 가 맞춘 PTY 크기를 즉시 되돌려 버린다.
    let lastBox = `${host.clientWidth}x${host.clientHeight}`;
    const ro = new ResizeObserver(() => {
      const box = `${host.clientWidth}x${host.clientHeight}`;
      if (box === lastBox) return;
      lastBox = box;
      fit.fit();
    });
    ro.observe(host);

    // 창으로 돌아오면 내 화면 크기를 다시 주장한다 — MO 가 폰 크기로 줄여 둔 채면
    // 데스크톱에 빈 공간이 남고 좁게 보인다(크기 공유는 '마지막에 주장한 쪽' 기준).
    const reclaimSize = () => {
      const dims = fit.proposeDimensions();
      if (!dims?.cols || !dims.rows) return;
      if (dims.cols !== term.cols || dims.rows !== term.rows) {
        term.resize(dims.cols, dims.rows); // onResize 가 PTY 까지 전달
      } else {
        // xterm 은 이미 내 크기인데 PTY 만 다른 경우 — 직접 재주장(같으면 main 이 무시)
        window.oneApp.terminal.resize(id, dims.cols, dims.rows);
      }
    };
    window.addEventListener('focus', reclaimSize);

    return () => {
      disposed = true;
      ro.disconnect();
      window.removeEventListener('focus', reclaimSize);
      offData();
      offResized();
      dataSub.dispose();
      resizeSub.dispose();
      term.dispose();
    };
  }, [id]);

  return <div className="terminal__host" ref={hostRef} />;
}
