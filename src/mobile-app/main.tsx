// 폰(MO) 앱 셸 진입점.
// ⚠️ 순서가 중요하다 — 기능 컴포넌트는 마운트되는 순간 `window.oneApp` 을 부르므로
// shim 설치가 React 마운트보다 **먼저** 끝나야 한다.
import { installOneAppShim } from './shim/oneApp';
import { startRpc } from './shim/rpc';
import { initTheme } from '../renderer/lib/theme';
import { App } from './App';
import './styles/mo.scss';
import { createRoot } from 'react-dom/client';

// 1) 폰 전용 CSS 스코프 — Modal 이 body 로 portal 하므로 html 에 붙인다
document.documentElement.classList.add('mo');

// 2) 주소창의 토큰 제거 (서버가 쿠키로 승격했다 — 공유·스크린샷 노출 방지)
if (new URLSearchParams(location.search).has('token')) {
  history.replaceState(null, '', location.pathname);
}

// 3) window.oneApp 준비 → 그 다음에야 렌더러 컴포넌트를 마운트할 수 있다
installOneAppShim();
startRpc();

// 4) 테마 (데스크톱과 같은 모듈 — data-theme + localStorage 미러)
initTheme();

createRoot(document.getElementById('root') as HTMLElement).render(<App />);
