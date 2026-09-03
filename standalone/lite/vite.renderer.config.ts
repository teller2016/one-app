import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const REPO_ROOT = path.resolve(__dirname, '../..');

// https://vitejs.dev/config
export default defineConfig({
  plugins: [react()],
  // ⚠️ 상대 base 가 필수 — prod 렌더러는 `loadFile`(= file://)로 뜨므로 기본값 '/' 이면
  // 본체 _base.scss 가 싣는 폰트(woff2) URL 이 파일시스템 루트로 해석돼 로드에 실패한다.
  base: './',
  resolve: {
    // `@one/*` = One App 본체 소스 — 렌더러 컴포넌트·기능(결재 섹션·티켓 보고)을 직접 import 한다
    alias: { '@one': path.join(REPO_ROOT, 'src') },
    // ⚠️ 본체 파일은 본체 node_modules 의 react 를, 이 앱 파일은 이 앱 node_modules 의 react 를
    // 각자 해석하면 React 가 **두 벌** 실행돼 훅이 깨진다("Invalid hook call"). 항상 이 앱의
    // 것으로 모은다 — 그래서 package.json 의 react 버전을 본체와 같게 유지해야 한다.
    dedupe: ['react', 'react-dom'],
  },
  server: {
    // 본체 소스(../../src)는 이 프로젝트 루트 밖이다 — dev 서버가 그 경로를 서빙하도록 허용
    fs: { allow: [REPO_ROOT] },
  },
  css: {
    preprocessorOptions: {
      // sass-embedded 의 modern API 사용 (레거시 API deprecation 경고 방지)
      scss: { api: 'modern-compiler' },
    },
  },
});
