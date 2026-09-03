// vitest 는 exports map 만 노출해 eslint-plugin-import 2.x 의 node resolver 가
// 경로를 못 찾는다 — 실행에는 문제 없다
// eslint-disable-next-line import/no-unresolved
import { defineConfig } from 'vitest/config';

// 순수 로직 단위 테스트만 돌린다 — Electron·DOM 이 필요한 코드는 대상이 아니다.
// (렌더러 컴포넌트 테스트를 붙이려면 environment: 'jsdom' 과 관련 의존성이 따로 필요하다)
export default defineConfig({
  test: {
    include: [
      'src/**/*.test.ts',
      'standalone/lite/src/**/*.test.ts',
      // lite 도달 그래프 불변식(외부 패키지 누출·버전 불일치) — standalone/lite/scripts/reach.test.ts
      'standalone/lite/scripts/**/*.test.ts',
    ],
    environment: 'node',
  },
});
