import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// 폰(MO) 앱 셸 — 데스크톱 렌더러의 기능 화면(src/renderer/features/*)을 그대로 재사용하고,
// preload 가 없는 브라우저 환경이라 `window.oneApp` 은 shim(WS RPC)이 채운다.
// 창으로 띄우지 않고 main 의 HTTP 서버가 `/` 로 정적 서빙한다.
// https://vitejs.dev/config
export default defineConfig({
  root: path.resolve(__dirname, 'src/mobile-app'),
  // 터미널 페이지는 base '/terminal/' — 두 엔트리의 asset 경로가 겹치지 않게 나눈다
  base: '/',
  // ⚠️ 엔트리별 의존성 캐시 분리 — 기본값을 공유하면 재최적화가 서로를 무효화해
  // `504 (Outdated Optimize Dep)` 로 화면이 비어 버린다(vite.mobile.config.ts 주석 참고)
  cacheDir: path.resolve(__dirname, 'node_modules/.vite-mobile-app'),
  plugins: [react()],
  css: { preprocessorOptions: { scss: { api: 'modern-compiler' } } },
  // root 밖(src/renderer, src/shared)을 import 하므로 dev 서버에 접근 허용이 필요하다
  server: { fs: { allow: [path.resolve(__dirname)] } },
  build: {
    // outDir 는 root 상대라 절대경로로 고정해야 산출물이 .vite 아래로 나온다
    // (packagerConfig.ignore 가 /.vite 시작 경로만 패키지에 포함한다)
    outDir: path.resolve(__dirname, '.vite/renderer/mobile_app_window'),
    emptyOutDir: true,
  },
});
