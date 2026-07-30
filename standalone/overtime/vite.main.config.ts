import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    // 자동화 코드는 함수를 문자열로 만들어 페이지에 주입한다(browser.ts 의 evalInPage).
    // 압축을 끄면 주입되는 소스가 원본 그대로라 디버깅·동작 예측이 쉽다.
    minify: false,
  },
});
