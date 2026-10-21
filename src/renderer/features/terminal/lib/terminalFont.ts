// xterm 글꼴 — 데스크톱(`TerminalView`)과 MO(`mobile-app/terminal/controller`)가 함께 쓰는 **한 벌**.
// 스택의 정본은 `_base.scss` 의 `--font-terminal`(첫 후보 = 번들 Nordwand Mono).
//
// ⚠️ xterm 6 은 **웹폰트 로드를 감지하지 않는다** — `open()` 때 canvas `measureText('W')` 로 셀을
// 한 번 재고 끝이다. 번들 폰트가 오기 전에 열면 폴백(Menlo)의 줄높이로 셀이 굳는다
// (13px 실측: 정상 17px → 15px, 같은 pane 이 45행 → 51행 — 2026-10-21). `fit()` 은 다시 재지 않고,
// `fontFamily` 옵션이 **바뀔 때만** 다시 잰다. 그래서 아직 안 왔으면 첫 후보를 뺀 스택으로 열고
// (`openingStack`), 로드되면 원래 스택을 넣는다(`whenBundledFontLoaded`). 옵션이 바뀌면 WebGL 렌더러가
// 그 글꼴의 아틀라스를 새로 받으므로 공유 아틀라스를 지우지(`clearTextureAtlas`) 않아도 된다.
// xterm 을 import 하지 않는 순수 모듈이라 MO 번들에 짐을 더하지 않는다.

const FALLBACK_STACK = 'ui-monospace, Menlo, monospace';

/** 터미널 글꼴 스택 — 토큰을 못 읽으면 시스템 고정폭 */
export const terminalFontStack = () =>
  getComputedStyle(document.documentElement).getPropertyValue('--font-terminal').trim() ||
  FALLBACK_STACK;

const firstFamily = (stack: string) => stack.split(',')[0].trim();

/**
 * 번들 폰트(스택 첫 후보)가 **이미 로드돼 있는지** — 첫 후보만 본다
 * (뒤의 시스템 폰트는 항상 available 이라 스택 전체를 넘기면 판정이 무의미해진다).
 */
export const bundledFontLoaded = (stack: string, size: number) => {
  try {
    return document.fonts.check(`${size}px ${firstFamily(stack)}`);
  } catch {
    return false; // check 가 파싱에 실패하면 보수적으로 '아직 아니다'
  }
};

/** 처음 열 때 쓸 스택 — 번들 폰트가 아직이면 첫 후보를 뺀다(로드 뒤 옵션을 바꿔야 셀을 다시 재므로) */
export const openingStack = (stack: string, ready: boolean) =>
  ready ? stack : stack.split(',').slice(1).join(',').trim() || FALLBACK_STACK;

/** 번들 폰트를 불러온 뒤 `apply` — 실패하면 열 때의 스택 그대로 둔다 */
export const whenBundledFontLoaded = (stack: string, size: number, apply: () => void) => {
  void document.fonts
    .load(`${size}px ${firstFamily(stack)}`)
    .then(apply)
    .catch(() => {});
};
