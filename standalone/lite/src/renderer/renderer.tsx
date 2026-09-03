/**
 * 렌더러 진입점 — Vite 가 이 파일을 브라우저 컨텍스트에서 로드한다.
 * (파일 이름 고정 — index.html 의 script src 와 짝)
 */
import './styles/index.scss';
import { createRoot } from 'react-dom/client';
import { initTheme } from '@one/renderer/lib/theme';
import { App } from './App';

// 첫 페인트 전에 테마 적용 (localStorage 미러 — 플래시 방지). 본체와 같은 유틸.
initTheme();

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<App />);
}
