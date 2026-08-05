---
paths:
  - "forge.config.ts"
  - "vite.*.config.ts"
  - "package.json"
---

# 빌드·패키징 규칙 (Electron Forge + Vite)

## 네이티브·무거운 의존성은 external
- `puppeteer`·`node-pty`·`ws` 는 `vite.main.config.ts` 에서 **external 처리**(번들 제외, 런타임 로드 — `forge.config.ts` 의 `copyRuntimeDeps` 훅이 패키지에 채워 넣는다). 무거운 네이티브 의존성을 추가할 때도 동일하게 external 을 고려할 것.
- `node-pty` prebuild 의 `spawn-helper` 는 **실행 권한이 없는 채로 설치**돼 `posix_spawnp failed` 가 난다 → `package.json` 의 `postinstall` 이 `chmod +x` 로 보정한다(`npm i` 후 오류 시 이 스크립트 확인).

## ⚠️ node-pty 패키징
- `packagerConfig.asar.unpack` 으로 **통째 unpack** 해야 한다 — macOS 의 `spawn-helper` 는 확장자가 없어 AutoUnpackNatives 의 `*.node` 글롭에 안 걸리고, asar 안에 갇히면 PTY 생성이 전부 실패한다.
- `postPackage` 는 앱 서명 **전에** unpacked 바이너리를 같은 identity 로 선서명하는데, **Mach-O 만** 서명할 것 — 함께 담긴 win32 prebuild(PE)를 서명하면 codesign 이 서명을 `com.apple.cs.*` 확장 속성으로 붙이고 그게 detritus 로 잡혀 앱 `--deep` 서명이 실패한다(2026-08 실측).

## ⚠️ Vite 엔트리별 cacheDir 분리
렌더러 엔트리가 3개(`main_window`·`mobile_window`·`mobile_app_window`)인데 Vite 의존성 캐시 기본값(`node_modules/.vite`)을 공유하면 한 서버의 재최적화가 다른 서버 페이지의 URL 을 무효화해 **dev 모드에서 빈 화면(`504 Outdated Optimize Dep`)** 이 된다. 그래서 각 설정에 **`cacheDir` 을 분리**해 뒀다(`.vite-mobile`·`.vite-mobile-app`). **엔트리를 더 추가할 때도 반드시 분리할 것.** 그래도 빈 화면이 나면 `rm -rf node_modules/.vite*` 후 재시작.

## 진입점 파일명 고정
`src/main/main.ts`, `src/preload/preload.ts`, `src/renderer/renderer.tsx` 의 **파일 이름**이 빌드 산출물 이름(`main.js`/`preload.js`)이 된다. 바꾸면 실행이 깨진다.

## MO 페이지 서빙
모바일 페이지는 별도 Vite 엔트리(`forge.config.ts` renderer 배열의 `mobile_window`, base `/terminal/`) — prod 는 main 이 asar 안 산출물을 `fs` 로 읽어 서빙(경로 정규화로 루트 밖 차단), dev 는 Vite dev 서버로 프록시한다.
