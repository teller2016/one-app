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

## ⚠️ `window.oneApp` 은 **부분집합**이다
`src/preload/preload.ts` 와 `src/renderer/types/global.d.ts` 에 이 앱이 쓰는 채널만 선언해 둔다.
일부러 부분집합으로 둔 것이다 — 이 앱에 없는 채널을 부르는 본체 컴포넌트를 들여오면 **빌드 전에**
typecheck 가 잡는다(런타임에 `undefined` 호출로 터지는 대신).

- 본체 결재·보고 화면이 **새 채널을 쓰게 되면 그 두 파일도 함께 늘린다.** 채널 이름·인자·반환
  모양은 본체 preload 와 똑같이 맞춘다.
- `features/jira` 는 **index 가 아니라 컴포넌트 파일을 직접** import 한다 — index 가
  `JiraSection`(터미널 세션·작업 시작 채널 의존)까지 내보내기 때문이다.
- main 에서 가져오는 본체 모듈은 **electron·node 내장만 쓰는 순수 모듈**이어야 한다
  (터미널·MO 서버처럼 데스크톱 전용 의존이 딸린 기능은 가져오지 않는다).

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
