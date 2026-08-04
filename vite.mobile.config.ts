import { defineConfig } from 'vite';
import path from 'node:path';

// 모바일(MO) 터미널 페이지 빌드 — 창으로 띄우지 않고 main 의 HTTP 서버가 정적 서빙한다.
// https://vitejs.dev/config
export default defineConfig({
  root: path.resolve(__dirname, 'src/mobile'),
  // `/` 는 폰 앱 셸이 쓰므로 터미널 페이지는 `/terminal/` 로 서빙된다.
  // base 를 맞춰야 asset 경로(`/terminal/assets/*`)가 앱 셸(`/assets/*`)과 겹치지 않는다.
  base: '/terminal/',
  // ⚠️ 엔트리별 의존성 캐시 분리 — 기본값(node_modules/.vite)을 세 dev 서버가 공유하면
  // 한쪽이 재최적화할 때 다른 쪽 페이지가 이미 받아 간 URL 이 무효화돼
  // `504 (Outdated Optimize Dep)` 로 화면이 비어 버린다(2026-08 실측).
  cacheDir: path.resolve(__dirname, 'node_modules/.vite-mobile'),
  build: {
    // outDir 는 root 상대라서 절대경로로 고정해야 산출물이 .vite 아래로 나온다
    // (packagerConfig.ignore 가 /.vite 시작 경로만 패키지에 포함하기 때문).
    outDir: path.resolve(__dirname, '.vite/renderer/mobile_window'),
    emptyOutDir: true,
  },
});
