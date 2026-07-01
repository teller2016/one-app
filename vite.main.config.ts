import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      // puppeteer 는 번들하지 않고 런타임에 node_modules 에서 로드한다.
      external: ['puppeteer'],
    },
  },
});
