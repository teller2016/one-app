---
paths:
  - "forge.config.ts"
  - "vite.*.config.ts"
  - "package.json"
---

# 빌드·패키징 규칙 (Electron Forge + Vite)

## 네이티브·무거운 의존성은 external
- `node-pty`·`ws` 는 `vite.main.config.ts` 에서 **external 처리**(번들 제외, 런타임 로드 — `forge.config.ts` 의 `copyRuntimeDeps` 훅이 패키지에 채워 넣는다). 무거운 네이티브 의존성을 추가할 때도 동일하게 external 을 고려할 것.
- ⚠️ **`puppeteer` 는 2026-08-10 전환으로 앱에서 빠졌다** — 브라우저 자동화는 Electron BrowserWindow(`lib/browser.ts`)로 하고, puppeteer 는 **devDependency**(E2E 검증용)로만 남는다. `copyRuntimeDeps` 는 `npm ls --omit=dev` 로 계산하므로 자동으로 제외된다(패키지 약 8.4MB 감소, 시스템 Chrome 의존도 소멸).
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

## 개발 인스턴스와 빌드 앱을 **동시에** 띄운다 (2026-08-11)
실사용은 `/Applications/One App.app`, 확인은 `npm start`(HMR) — 두 개를 나란히 켜 두는 것이 기본 사용법이다.
설치·교체는 **`/build` 스킬**(`.claude/skills/build/SKILL.md`)이 맡는다.

**설정은 공유하고 런타임 상태만 가른다** — 판정은 `main/lib/devInstance.ts` 의 `IS_DEV_INSTANCE`(= `!app.isPackaged`) 하나뿐이다.

| 대상 | 처리 | 이유 |
|------|------|------|
| userData 의 설정 JSON 전부 | **공유** (`~/Library/Application Support/One App`) | 개발에서 손본 설정·프로젝트·작업영역이 빌드 앱에 그대로 반영되길 원한다(사용자 결정) |
| MO 서버 포트 | dev 는 **+1** (`terminal/store.ts` `getPort`) | 같은 포트를 두 프로세스가 bind 할 수 없다 |
| tmux **소켓** (`-L`) | dev 는 `oneapp-dev` | 세션 이름만 갈라선 부족하다 — 한 세션에 동시 attach 하면 tmux 가 **작은 클라이언트 크기로 화면을 맞추고** 입력이 양쪽에 미러링된다 |
| `terminal-sessions.json`·`window-state.json` | dev 는 `-dev` 접미사 (`runtimeFile`) | 서로의 세션을 죽은 것으로 오해해 지우고, 창이 정확히 겹쳐 뜬다 |

- ⚠️ **`app.setName()`·`app.setPath('userData')` 로 프로필을 가르지 말 것** — 앱 이름이 바뀌면 `safeStorage` 가 쓰는 키체인 항목(`<앱이름> Safe Storage`)도 달라져 **저장된 계정·비밀번호를 전부 복호화하지 못한다.**
- ⚠️ **공유 userData 에서는 파일 캐시를 그냥 믿으면 안 된다** — `lib/store.ts` 의 `readUserJson` 은 매 읽기마다 mtime·size 를 확인한다. 없으면 상대가 저장한 변경을 못 보고 **오래된 값으로 통째 덮어쓴다**.
- **Dock 구분**: 아이콘 하단 오렌지 `DEV` 밴드(`assets/icon-dev.png` — `npm run icon:dev` 로 생성, 원본 아이콘을 바꾸면 다시 돌린다) + Dock 뱃지 `DEV` + 창 제목 `One App — DEV`.
  - 뱃지는 터미널 입력대기 수와 자리를 나눠 쓰므로 **`lib/dockBadge.ts` 한 곳에서만** `setBadge` 를 부른다(각자 부르면 서로를 지운다 — 대기 0 이 되는 순간 DEV 표식이 사라졌다).
  - 창 제목은 `page-title-updated` 를 `preventDefault` 해야 유지된다 — 안 하면 `index.html` 의 `<title>One App</title>` 이 덮어쓴다.
- `scripts/make-dev-icon.mjs` 는 Node 내장 `zlib` 만으로 PNG 를 디코드·합성·인코드한다(sharp·jimp 등 **의존성 추가 없음**, macOS `sips` 는 합성을 못 한다). 원본은 8bit RGBA·비인터레이스 PNG 여야 하고 아니면 명시적으로 실패한다.
