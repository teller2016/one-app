/**
 * 렌더러 진입점.
 * Vite가 이 파일을 렌더러(브라우저) 컨텍스트에서 로드한다.
 * React 앱을 #root 에 마운트한다.
 */
import './styles/index.scss';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { initTheme } from './lib/theme';

// 첫 페인트 전에 테마 적용 (localStorage 미러 — 플래시 방지)
initTheme();

// 파일 드래그 전역 가드 — 드롭 대상 밖(어느 pane 도 아닌 곳)에 떨어지면 Chromium 기본
// 동작이 창을 file:// 로 내비게이션시켜 앱 화면이 통째로 사라진다. Files 드래그만 막고
// 세션 탭 드래그(커스텀 타입)에는 관여하지 않는다.
// ⚠️ 이미 처리된 이벤트(defaultPrevented — 터미널 pane 의 드롭)는 건드리지 않는다 —
// window 는 bubble 의 마지막이라 여기서 dropEffect 를 덮어쓰면 pane 의 copy 커서가 죽는다.
window.addEventListener('dragover', (e) => {
  if (e.defaultPrevented) return;
  if (!e.dataTransfer?.types.includes('Files')) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'none'; // 놓을 수 없음 커서 — 드롭 자체가 발화하지 않는다
});
window.addEventListener('drop', (e) => {
  if (e.defaultPrevented) return;
  if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
});

const container = document.getElementById('root');
if (container) {
  // 팝아웃 창 — main(features/terminal/windows.ts)이 같은 엔트리를 `?popout=<id>` 로
  // 로드한다(새 Vite 엔트리 금지 — cacheDir 분리 함정). 마운트 전에 배정(init)을
  // 받아야 해서 비동기 마운트 함수를 쓴다.
  const popoutId = new URLSearchParams(location.search).get('popout');
  if (popoutId) {
    void import('./features/terminal/components/TerminalPopoutApp').then((m) =>
      m.mountTerminalPopout(container, popoutId)
    );
  } else {
    createRoot(container).render(<App />);
  }
}
