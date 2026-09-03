import path from 'node:path';
import { defineConfig } from 'vite';

// preload 는 본체에서 타입만 가져오므로(`import type … from '@one/shared/types'`) 런타임 의존은
// 없지만, 값 import 가 생길 때를 대비해 같은 alias 를 둔다.
const ONE_SRC = path.resolve(__dirname, '../../src');

// https://vitejs.dev/config
export default defineConfig({
  resolve: {
    alias: { '@one': ONE_SRC },
  },
});
