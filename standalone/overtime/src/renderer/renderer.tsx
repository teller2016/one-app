/**
 * 렌더러 진입점 — Vite 가 이 파일을 브라우저 컨텍스트에서 로드한다.
 * (파일 이름 고정 — index.html 의 script src 와 짝)
 */
import './styles/index.scss';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<App />);
}
