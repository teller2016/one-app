// 작성만 해두고 사용자에게 남겨두는 자동화 창을 한 곳에서 관리한다.
// (야근 결재 미리보기 · 지출결의서 작성 — 한 번에 하나만 열린다)
import { closePage, closePopups, type Page } from './browser';

let kept: Page | null = null;
/**
 * 남겨둔 창의 opener 창 (숨겨둔 결재양식 목록).
 * 지출결의서 팝업의 [결재상신] 이 opener 에게 다음 팝업을 열어달라고 요청하므로
 * 사용자가 작업을 마칠 때까지 함께 살아 있어야 한다.
 */
let keptOpener: Page | null = null;

/**
 * 창을 사용자에게 남긴다.
 * 닫기는 browser.ts 의 will-prevent-unload 처리로 이미 보장되므로 강제 파괴는 걸지 않는다.
 * (강제 파괴를 걸면 결재상신처럼 창 전환이 있는 흐름을 잡아먹는다 — 2026-07 실측)
 */
export function keepPage(page: Page, opener: Page | null = null) {
  kept = page;
  keptOpener = opener;
  page.win.on('closed', () => {
    if (kept !== page) return;
    kept = null;
    // 사용자가 작업 창을 닫으면 숨겨둔 opener 도 함께 정리한다
    closePage(keptOpener);
    keptOpener = null;
  });
}

/** 남겨둔 창 닫기 (앱 UI 버튼·다음 실행 전·앱 종료 시) */
export function closeKeptPage(): { closed: boolean } {
  const had = !!kept && !kept.win.isDestroyed();
  if (kept) closePopups(kept);
  closePage(kept);
  closePage(keptOpener);
  kept = null;
  keptOpener = null;
  return { closed: had };
}
