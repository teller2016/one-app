/**
 * 렌더러 진입점.
 * Vite가 이 파일을 렌더러(브라우저) 컨텍스트에서 로드한다.
 * React 앱을 #root 에 마운트한다.
 */
import './styles/index.css';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(<App />);
}
