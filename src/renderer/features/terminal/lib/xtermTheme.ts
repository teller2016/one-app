// xterm 색 — 데스크톱(`TerminalView`)과 MO(`mobile-app/terminal/controller`)가 함께 쓰는 **한 벌**.
// ⚠️ 두 곳에 복사본을 다시 두지 말 것 — 2026-09-30 Signal 리디자인(액센트 애플 블루 → 인디고) 뒤
// MO 만 선택 영역 색을 고쳤고, 데스크톱은 옛 `#2997ff` 틴트로 남아 검색 하이라이트(인디고)와
// 어긋났다(2026-10-01 점검). 선택 틴트도 하드코딩하지 않고 액센트 토큰에서 만든다.
// xterm 을 값으로 import 하지 않는 순수 모듈이라(`ITheme` 은 타입뿐) MO 번들에 짐을 더하지 않는다.
import type { ITheme } from '@xterm/xterm';

const cssVar = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const parseHex = (h: string) => {
  const v = parseInt(h.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};

/** #RRGGBB 두 색을 비율로 섞는다 (ratio = 앞 색의 비중) */
const mixHex = (fg: string, bg: string, ratio: number) => {
  const a = parseHex(fg);
  const b = parseHex(bg);
  return `#${a
    .map((x, i) =>
      Math.round(x * ratio + b[i] * (1 - ratio))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
};

/** #RRGGBB → 알파를 얹은 rgba() — 선택 영역처럼 아래 글자가 비쳐야 하는 틴트용 */
const withAlpha = (hex: string, alpha: number) => `rgba(${parseHex(hex).join(', ')}, ${alpha})`;

/**
 * 터미널 색 — DESIGN.md 의 **다크 패널(panel-dark)** 토큰에서 가져온다.
 * 로그·코드 패널과 같은 계열이라 라이트/다크 테마 모두에서 앱의 일부처럼 보인다.
 *
 * ⚠️ 배경은 여기서 칠하지 않고 `rgba(0,0,0,0)` + `allowTransparency` 로 두어 **패널의 CSS 배경**
 * (`--surface-dark`)이 그대로 비치게 한다. xterm 은 생성 후 `options.theme` 을 바꿔도 뷰포트
 * 배경을 다시 칠하지 않아서, JS 로 동기화하면 테마 전환 시 패널과 터미널(검정)이 어긋난다(2026-08 실측).
 * `'transparent'` 는 xterm 색 파서가 못 읽고 검정으로 폴백한다.
 * 마젠타·시안·bright 일부는 대응 토큰이 없어 시스템 색을 그대로 쓴다(그것들만 예외).
 */
export const buildTerminalTheme = (): ITheme => ({
  background: 'rgba(0, 0, 0, 0)',
  foreground: cssVar('--on-dark-2'),
  cursor: cssVar('--on-dark'),
  cursorAccent: cssVar('--surface-dark'),
  selectionBackground: withAlpha(cssVar('--accent-on-dark'), 0.35),
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
export const searchDecorations = () => {
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
