---
paths:
  - "standalone/**"
---

# 단독 배포판 One App Lite (`standalone/lite`)

동료에게 zip 으로 건네는 Windows·macOS 앱. **결재 3종 + Jira 티켓 보고 + 환경설정**만 담는다.
상세(구조·받는 사람 안내·빌드·함정 표)는 **`standalone/lite/README.md`** 가 정본이다 — 여기는
건드리기 전에 알아야 할 것만 둔다.

## ⚠️ 본체 코드를 **복사하지 않는다** — `@one/*` alias 로 직접 import 한다
`@one` = `../../src`(tsconfig `paths` + 각 vite config `resolve.alias`). 본체를 고치면 다음
빌드에 그대로 실린다. 1.x(`standalone/overtime`)는 복사본이라 드리프트가 났고(야근 시간합계
가드 누락 → '0시간' 기입), 2026-09-03 에 이 구조로 재구성했다. **복사본을 되살리지 말 것.**

- 이 폴더에 있는 것은 **셸뿐**이다 — 창 하나(`src/main/main.ts`)·제목바 세그먼트(`App.tsx`)·
  환경설정 화면(`views/SettingsView.tsx`)·아이콘. 기능 화면은 본체 컴포넌트를 그대로 띄운다.
- 산출물은 본체 없이 단독 실행되지만 **빌드는 리포 안에서** 해야 한다(`../../src` 참조).

## ⚠️ 루트 `npx tsc --noEmit` 은 이 폴더를 검사하지 않는다
루트 tsconfig 의 `include` 가 `src` 뿐이다. 단독판까지 보려면 **`cd standalone/lite && npm run
typecheck`** 를 따로 돌린다(그쪽 tsc 는 `@one` 을 따라가 본체 파일까지 함께 검사한다).
ESLint 는 루트 `npm run lint` 가 함께 본다(`@one/` 미해결 예외 블록이 `eslint.config.mjs` 에 있다).

## ⚠️ `window.oneApp` 은 **부분집합**이다 — 공용 브리지는 본체 `preload/bridges/*` 를 **조립**한다
`src/preload/preload.ts` 와 `src/renderer/types/global.d.ts` 는 이 앱이 쓰는 채널만 노출·선언한다.
일부러 부분집합으로 둔 것이다 — 이 앱에 없는 채널을 부르는 본체 컴포넌트를 들여오면 **빌드 전에**
typecheck 가 잡는다(런타임에 `undefined` 호출로 터지는 대신).

- 본체와 공용인 환경설정·결재·티켓 보고는 **채널 문자열을 복제하지 않는다** — 본체
  `src/preload/bridges/{settings,approval,jiraReport}.ts` 가 `XxxBridge` 인터페이스 + `xxxBridge(ipcRenderer)`
  조립 함수를 내보내고, 본체 preload 와 이 앱 preload 가 **둘 다 그것을 조립**한다. `global.d.ts` 도 그
  인터페이스를 그대로 쓴다. (2.1.0 까지는 손 복제였다 — 채널 이름이 바뀌면 타입은 `shared/types` 에서
  오므로 typecheck 는 통과한 채 팀원 PC 에서 "No handler registered" 로 터지는 구멍. 2026-09-03 정리.)
- 본체 결재·보고 화면이 **새 채널을 쓰게 되면 그쪽 슬라이스에 추가**한다 — 이 앱은 자동으로 따라온다.
  이 앱에 **없는** 기능의 채널(터미널·출퇴근 등)은 여전히 여기 없으므로 typecheck 가 막는다.
- `features/jira` 는 **index 가 아니라 컴포넌트 파일을 직접** import 한다 — index 가
  `JiraSection`(터미널 세션·작업 시작 채널 의존)까지 내보내기 때문이다.
- main 에서 가져오는 본체 모듈은 **electron·node 내장만 쓰는 순수 모듈**이어야 한다
  (터미널·MO 서버처럼 데스크톱 전용 의존이 딸린 기능은 가져오지 않는다). **`npm test` 가 지킨다** — 아래.

## 무엇이 lite 에 실리는지는 `npm run reach` 로 본다 (외우지 말 것)
`scripts/lib/reach.mjs` 가 세 엔트리에서 import(정적·동적·`export from`·SCSS `@use`)를 끝까지 따라가
"lite 에 실리는 파일" 과 "값으로 import 하는 외부 패키지" 를 모은다(2026-09-03 기준 본체 81개 파일).

- `npm run reach` 요약 · `-- --files` 전체 목록 · `-- --hits <경로>...` 준 경로 중 실리는 것만(`/commit` 이 쓴다).
- ⚠️ 본체 파일이 외부 패키지를 import 하면 TS·Vite 모두 **루트 node_modules 를 따라 올라가 해석**하므로
  이 앱 package.json 에 없는 패키지가 **경고 없이** 번들에 들어간다(순수 JS 는 조용히 비대해지고 node-pty 같은
  네이티브는 빌드가 깨진다). `scripts/reach.test.ts`(루트 `npm test`)가 허용 목록(electron·react·react-dom·node 내장)
  밖의 값 import · 데스크톱 전용 기능 도달 · 본체와 다른 패키지 버전 지정을 실패로 만든다.
- 정말 필요한 런타임 의존이 생기면 lite `package.json` `dependencies` 와 그 테스트의 `ALLOWED_BARE` 를 함께 늘린다.

## 배포는 **`/release` 스킬**로 (GitHub Releases)
산출물과 **받는 사람용 안내**는 배포 전용 public 리포 **`teller2016/one-app-lite`** 에 둔다(소스는 안 올린다).
팀원에게 주는 링크는 `.../releases/latest` 하나로 고정이라 다음 배포에도 그대로 유효하다.

- ⚠️ **`npm run release` 를 직접 부르지 말 것** — `require-build-skill.mjs` 훅이 막는다. `/release` 스킬이
  변경점 정리·버전 판단·승인을 거친 뒤 부른다(public 릴리스는 팀원이 곧바로 받아 가 되돌리기 어렵다).
- `scripts/release.mjs` — gh 인증 확인 → typecheck → 버전 결정·bump → **`CHANGELOG.md` 의 `## Unreleased` 를 그 버전으로 찍어 릴리스 노트로** →
  win·mac 빌드 → **macOS 서명 검증** → `gh release create` + CHANGELOG 업로드 → 링크 출력.
  **커밋·태그는 하지 않는다**(`package.json`·`CHANGELOG.md` 는 `/commit` 으로). 같은 태그가 있으면 업로드 전에 멈추고,
  서명이 빠졌으면 중단한다(`--allow-unsigned` 로만 강행). Unreleased 가 비어 있으면 중단한다(`--notes` 로만 대체).
- **CHANGELOG 는 커밋할 때 쓴다** — lite 에 실리는 코드를 건드린 커밋은 `## Unreleased` 에 받는 사람 말로 한 줄(`/commit` 절차 4).
  `/release` 는 그 절을 `## x.y.z — 날짜` 로 **찍기만** 한다. **버전 자리 = 표기**: `[주의]` → major · `[추가]`/`[변경]` → minor ·
  `[개선]`/`[수정]` → patch — 자리 인자가 없으면 스크립트가 표기대로 올린다. 구현어·파일명 금지.
- **앱 안의 새 버전 확인 + 자동 설치(2.0.1~)**: `update.ts`(`update:check`)가 최신 릴리스를 현재 버전과 비교 →
  셸 배너 [지금 업데이트] → `updateInstall.ts` 가 zip 을 받아 검증·압축 해제 → 헬퍼 스크립트(`updateCore.ts`)가
  앱 종료 후 교체·재실행. Squirrel 은 못 쓴다(mac Developer ID 서명·win Setup.exe 필요). 상세 흐름·차단 조건은 README.
  - 종료 **전** 실패는 값으로 돌려 배너가 폴백([받은 폴더 열기]·[릴리스 페이지])을 안내하고, 종료 **후** 실패는 헬퍼가 `.bak` 을 원복한다.
  - ⚠️ **Windows 헬퍼는 이 맥에서 실행할 수 없다** — 순서·안전장치는 `updateCore.test.ts`(루트 `npm test`)가 유일한 방어선이다. 헬퍼 스크립트를 고치면 테스트도 같이.
  - 테스트 훅 `ONE_APP_LITE_FORCE_UPDATE_TAG=v2.0.0` 으로 그 태그를 새 버전으로 취급해 흐름을 돌려볼 수 있다(README). dev 는 교체 직전에 멈춘다.
  - 조회 실패는 조용히 무시한다(사내망에서 GitHub 이 막혀도 앱은 돈다).
- ⚠️ 리포 주소는 `scripts/release.mjs` 와 `src/main/update.ts` **두 곳의 `REPO` 상수**에 있다 — 바꾸면 함께.
- ⚠️ **사용법 문서의 정본은 배포 리포의 README** 다. 화면 사용법이 바뀌면 `standalone/lite/README.md` 가 아니라 그쪽을 고친다.
- ⚠️ 자가서명은 **받는 맥에서 검증되지 않는다** — 목적은 빌드 간 서명 고정(계정 유실 방지)이지 Gatekeeper 통과가 아니다.
  받는 사람 안내는 `xattr -dr com.apple.quarantine <앱>` 이 정답이다(macOS 15+ 는 우클릭 → 열기도 막힌다).

## 설정·저장 위치
`userData` 가 **`OneAppLite`** 다(본체 `One App` 과 별개) — 계정·결재 소속·Jira 토큰·보고 조건이
따로 저장된다. 저장 코드는 본체와 같은 파일이라 형식도 같다.

- ⚠️ **`forge.config.ts` 의 `EXECUTABLE` 을 바꾸지 말 것** — userData 경로와 safeStorage 키체인
  항목 이름이 그 값에서 나온다. 바꾸면 받는 사람의 저장된 계정이 전부 사라진다(2.0 에서 한 번
  바꿨고 그때 계정 재입력을 안내했다).
- macOS 는 자가서명 `One App Sign` 으로 서명한다 — adhoc 이면 리빌드마다 계정이 날아간다.

## 아이콘
본체 `assets/icon.png` 의 **색만 바꿔** 쓴다(`npm run icon` — 그린). PNG 코덱은 본체
`scripts/lib/png.mjs` 공용이고, `.icns`·`.ico` 는 `sips`·`iconutil` + 직접 조립으로 만든다.
⚠️ hue 만 돌리면 초록·노랑이 형광색처럼 뜬다 — **원본과 같은 휘도**를 유지한다(README 참고).
개발 인스턴스는 앱 번들이 없어 `main.ts` 가 `app.dock.setIcon` 으로 직접 올린다.

## ⚠️ 개발 인스턴스를 죽일 때 pkill 패턴이 겹친다
경로가 `coding/one-app/standalone/lite/node_modules/...` 라서 본체용 패턴에 함께 걸린다.

```bash
# 본체만            (standalone 은 남는다)
pkill -f "coding/one-app/node_modules/electron/dist"
# 단독판만
pkill -f "standalone/lite/node_modules/electron/dist"
```
`pkill -f "one-app/node_modules/electron/dist"` 처럼 쓰면 **둘 다 죽는다.** 본체와 단독판을
나란히 띄워 비교하는 것이 기본 사용법이므로(포트·userData 가 갈린다) 패턴을 정확히 줄 것.
