import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config
export default defineConfig({
  plugins: [react()],
  // ⚠️ 상대 base 가 필수 — prod 렌더러는 `loadFile`(= file://)로 뜨므로 기본값 '/' 이면
  // CSS 안의 에셋 URL(번들한 폰트 woff2)이 `file:///assets/…` = 파일시스템 루트로 해석돼
  // 로드에 실패한다. dev 서버는 상대 base 여도 그대로 '/' 로 서빙한다.
  base: './',
  css: {
    preprocessorOptions: {
      // sass-embedded 의 modern API 사용 (레거시 API deprecation 경고 방지)
      scss: { api: 'modern-compiler' },
    },
  },
});
