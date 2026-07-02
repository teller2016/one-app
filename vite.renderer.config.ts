import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config
export default defineConfig({
  plugins: [react()],
  css: {
    preprocessorOptions: {
      // sass-embedded 의 modern API 사용 (레거시 API deprecation 경고 방지)
      scss: { api: 'modern-compiler' },
    },
  },
});
