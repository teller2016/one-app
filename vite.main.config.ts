import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      // node-pty(네이티브)·ws 는 번들하지 않고 런타임에 node_modules 에서 로드한다.
      // (puppeteer 는 2026-08 전환으로 앱에서 빠졌다 — E2E 검증용 devDependency 로만 남는다)
      external: ['node-pty', 'ws'],
    },
  },
});
