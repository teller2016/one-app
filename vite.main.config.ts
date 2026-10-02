import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      // node-pty(네이티브)·ws 는 번들하지 않고 런타임에 node_modules 에서 로드한다.
      // web-push(폰 푸시)도 — CommonJS 의존성(https-proxy-agent·debug 등)을 번들러에 태우지 않는다.
      // 런타임 의존성은 forge.config.ts 의 copyRuntimeDeps 가 패키지에 채워 넣는다.
      // (puppeteer 는 2026-08 전환으로 앱에서 빠졌다 — E2E 검증용 devDependency 로만 남는다)
      external: ['node-pty', 'ws', 'web-push'],
    },
  },
});
