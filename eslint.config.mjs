// ESLint flat config (eslint 9) — 예전 `.eslintrc.json` 을 옮긴 것.
// ⚠️ flat config 는 `.eslintignore` 를 읽지 않는다. 제외는 아래 ignores 에만 쓴다.
// ⚠️ `--ext` 플래그도 사라졌다 — 검사 대상은 각 블록의 files 로 정한다(package.json 은 `eslint .`).
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import importPlugin from 'eslint-plugin-import';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '.vite/**',
      'out/**',
      'dist/**',
      '**/*.d.ts',
    ],
  },

  // ── TS/TSX 만 검사한다 (예전 `--ext .ts,.tsx` 와 같은 범위) ──
  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      importPlugin.flatConfigs.recommended,
      importPlugin.flatConfigs.electron,
      importPlugin.flatConfigs.typescript,
    ],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // ⚠️ 이 두 개만 켠다 — 플러그인 7 의 `recommended` 는 React Compiler 규칙
      // (static-components·use-memo·purity …)까지 함께 켜는데, 그건 별도 판단이 필요한
      // 큰 주제라 훅 의존성 검사와 같이 들어오면 안 된다.
      // ⚠️ 경고 0 을 유지할 것 — 새 경고가 기존 경고 더미에 묻히면 도입한 의미가 없다.
      // 의도적으로 deps 를 좁힌 곳은 이유 주석 + eslint-disable-next-line 을 함께 남긴다.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
    languageOptions: {
      // 메인(Node) · 렌더러(browser) 가 한 리포에 있어 둘 다 열어 둔다
      globals: { ...globals.browser, ...globals.node },
    },
  },
);
