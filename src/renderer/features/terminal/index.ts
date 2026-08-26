export { TerminalSection } from './components/TerminalSection';
// ⚠️ 여기서 무언가를 더 내보내기 전에 — 이 배럴은 TerminalSection(→ xterm 5종)을
// 끌고 온다. 순수 헬퍼를 다른 기능이 쓰려면 배럴에 얹지 말고 `shared/types.ts` 로 옮길 것
// (worktreeName 이 그렇게 갔다 — MO 폰 번들에 xterm 499KB 가 딸려오던 원인, 2026-08-26).
