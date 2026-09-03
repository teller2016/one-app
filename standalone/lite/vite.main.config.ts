import path from 'node:path';
import { defineConfig } from 'vite';

// `@one/*` = One App 본체 소스(../../src). 이 앱은 본체의 main 모듈(결재·Jira 보고·설정)을
// 복사하지 않고 직접 import 해 번들한다 — 빌드 산출물은 본체 없이도 단독으로 돈다.
const ONE_SRC = path.resolve(__dirname, '../../src');

// https://vitejs.dev/config
export default defineConfig({
  resolve: {
    alias: { '@one': ONE_SRC },
  },
  build: {
    // 자동화 코드는 함수를 문자열로 만들어 페이지에 주입한다(본체 lib/browser.ts 의 evalInPage).
    // 압축을 끄면 주입되는 소스가 원본 그대로라 디버깅·동작 예측이 쉽다.
    minify: false,
  },
});
