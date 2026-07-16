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

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<App />);
}
