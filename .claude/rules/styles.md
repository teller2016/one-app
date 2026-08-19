---
paths:
  - "**/*.scss"
  - "**/*.css"
  - "DESIGN.md"
---

# 스타일 규칙 (SCSS)

## 기준은 `DESIGN.md`
색·크기·모션은 반드시 `_base.scss` 토큰(`var(--*)`)과 타이포 믹스인(`type-*`)에서 가져온다 — **hex·px 매직넘버 금지**. 토큰 값·무드의 정본은 프로젝트 루트 `DESIGN.md` 이므로, 새 토큰을 만들거나 기존 값을 바꿔야 하면 먼저 `DESIGN.md` 를 읽을 것.

⚠️ **`type-caption` 은 `text-transform: uppercase` + 자간 0.05em 을 포함한다** — 라벨용이라 그렇다. 브랜치명·경로·파일명처럼 **대소문자가 구분되는 식별자**에 쓰면 조용히 대문자로 바뀌어 오해를 부른다(2026-08-06 PR 목록에서 발견). 그 경우 `text-transform: none; letter-spacing: normal;` 로 함께 끄거나 `type-small` 을 쓸 것.

## 모션 (진입 애니메이션) — 정본은 `DESIGN.md` §3
공용 믹스인은 `_base.scss` 에 있다: **`rise-in`**(아래→제자리 — 섹션 전환·모달·토스트·배너) · **`fade-in`**(넓은 면·오버레이) · **`pop-in`**(팝오버·툴팁·메뉴). 키프레임을 새로 만들지 말고 이것들을 쓴다.

- ⚠️ **목록 항목(카드·행)에는 걸지 말 것** — 조회 결과는 사용자가 기다린 것이라 즉시 보여야 한다. 계단(stagger)까지 만들어 PR·Jira·메일·프로젝트 등 11곳에 넣었다가 **전면 제거**했다(2026-08-14 사용자 지적: "상단 8개만 애니메이션되는데 목록엔 굳이 필요 없다" — 앞 N개에만 지연을 주면 딱 그렇게 읽힌다). 목록의 모션은 컨테이너인 섹션 하나가 대표한다. `stagger` 믹스인도 함께 지웠으니 되살리지 말 것.
- ⚠️ **진입 믹스인의 `fill-mode` 는 `backwards` 다 — `both`(=forwards 포함)로 되돌리지 말 것.** forwards 면 모션이 끝난 뒤에도 `transform` 이 애니메이션 제어 속성으로 남아, 그 요소가 **자손 `position: fixed` 의 containing block** 이 된다. `.main > 섹션` 의 `rise-in` 탓에 그 안의 `.jira-view`(고정 상세 패널)가 뷰포트가 아니라 섹션 박스에 갇혀 **세로로 잘렸다**(2026-08-19 사용자 신고 → headless 실측: `both` top=100/h=132, `backwards` top=56/h=832). 키프레임에 `to` 가 없어 forwards 의 시각적 이득은 0이다.
- **떠 있는 레이어(모달·팝오버·상세 패널)는 `body` portal 로 띄운다** — `Modal`·`Select`·`Tooltip`·`DatePicker`·`TimePicker`·`ContextMenu`·`MultiSelect`·`ChangesOverlay` 가 모두 그렇다. 섹션 안에 `position: fixed` 로 두면 위 함정처럼 조상 transform 에 갇힌다(`.jira-view` 만 아직 예외다).
- **애니메이션은 요소가 마운트될 때 실행된다** — React 가 `key` 로 재마운트하는 지점이 곧 애니메이션 지점이다. 섹션 전환(`.main > :not(.main__keep)`)과 탑바 제목이 이 방식이고, 그래서 `App.tsx` 의 `topbar__icon`·`__title` 에 **`key={active.id}` 가 붙어 있다**(지우면 제목이 툭 바뀐다).
- ⚠️ **`prefers-reduced-motion` 에서 `animation: none` 금지** — 믹스인이 `fill-mode` 를 쓰므로 상태가 어긋날 수 있다. `_base.scss` 하단 블록처럼 `animation-duration: .01ms !important` 로 즉시 끝낼 것. 스피너 계열(`.spinner`·`.btn__spin`·`.icon-btn__spin`)만 회전을 되살린다.
- **펼침 높이**는 `:root { interpolate-size: allow-keywords }` + `<details>` 의 `::details-content`(Chromium 129/131+, 이 앱은 150 — 실측 확인). `content-visibility` 전환에 **`allow-discrete` 가 없으면 닫는 순간 내용이 사라져** 애니메이션이 한 프레임도 안 보인다. JS 로 높이를 재지 말 것.
- **팝오버의 `transform-origin` 은 `usePopover` 가 인라인으로 준다**(flip 되면 반대편) — SCSS 에서 고정하지 말 것. 훅을 안 쓰는 `ContextMenu` 만 직접 `top left` 를 지정한다.
- ⚠️ **드래그로 폭을 바꾸는 패널은 드래그 중 `transition: none`** — 앱 사이드바(`.sidebar--dragging`)·터미널 세션 패널(`.terminal--dragging`) 둘 다 그렇게 돼 있다. 안 끄면 패널이 손끝을 뒤따라온다. **한쪽을 고치면 다른 쪽도 볼 것.**
- 진입은 `opacity`·`transform` 만 쓴다(합성 단계에서 끝난다). ⚠️ `translateY(+n)` 은 **스크롤 가능 영역을 늘린다** — 스크롤 컨테이너 안에서 이동 거리를 키우면 진입 중 스크롤바가 번쩍인다(`--lift` 6px 에서는 실측상 발생하지 않음).

## 작성 방식
- **SCSS** (`sass-embedded`, Vite 기본 지원 — `vite.renderer.config.ts` 에서 modern-compiler API 사용).
- BEM 클래스를 `&__`/`&--` 네스팅으로 작성.
- 새 기능은 `styles/_<기능>.scss` 파일로 분리해 `index.scss` 에 `@use` 추가.
- 믹스인이 필요하면 파일 최상단에 `@use './base' as *;`.

## 고정폭 폰트는 앱에 번들 (`--font-mono`)
`src/renderer/assets/fonts/` 의 **JetBrains Mono NL**(No Ligatures, OFL-1.1 — 같은 폴더 `OFL.txt`) 4종(Regular/Bold/Italic/BoldItalic woff2)을 `_base.scss` 상단 `@font-face` 로 싣고 `--font-mono` 의 첫 후보로 둔다.

- **왜 번들인가**: 예전 첫 후보였던 **SF Mono 는 macOS 기본 설치 폰트가 아니다**(실측 — `/System/Library/Fonts` 엔 `Menlo.ttc` 만). 조용히 Menlo 로 폴백돼 맥마다 렌더가 달라졌다.
- NL(리가처 없음)을 고른 이유 — xterm 은 ligatures addon 없이 리가처를 그리지 않으므로, 리가처가 아예 없는 쪽이 폰트와 화면이 일치한다. 공식 배포에 **NL 은 ttf 만** 있어 woff2 는 `fontTools` 로 변환해 넣었다.
- `font-display: block` 필수 — 폴백으로 먼저 그리면 xterm 이 그 폭으로 셀을 재고 굳는다(`features/terminal.md` 참고).
- ⚠️ **`vite.renderer.config.ts` 의 `base: './'` 를 지우지 말 것** — prod 렌더러는 `loadFile`(= `file://`)이라 기본값 `'/'` 이면 CSS 안의 폰트 URL이 `file:///assets/…` 로 해석돼 로드에 실패한다.
- `mobile-app/styles/mo.scss` 가 `_base.scss` 를 `@use` 하므로 **폰 셸도 같은 폰트를 받는다**(MO 서버 MIME 맵에 `.woff2` 가 이미 있다). `src/mobile` 의 MO 터미널 페이지는 별도 CSS 라 해당 없음.

## 공통 레이아웃 클래스 (`_base.scss`)
섹션 컨테이너 `.section`, 폼 액션 `.form-actions`, 독립 라벨 `.form-label`, 힌트 `.hint`, 주석 `.note`, 아이콘 버튼 `.icon-btn`, 중첩 패널 `.panel-sunken(--log)`, 빈 상태 `.empty-state`, 스피너 `.spinner`, 진행바 `.progress`, **사이드바 위젯 `.sbw`**(VPN·미러링·근태 공용 — `[아이콘][점+텍스트][우측 액션]` 한 줄 + `__sub`/`__error` 확장).

## 비브런시 셸 주의
창은 `vibrancy: 'sidebar'` — html/body/.sidebar 는 **투명 유지**, 불투명 채색은 `.content`(--bg)에서만. **BrowserWindow 에 backgroundColor 지정 금지**(재질이 가려진다). 탑바는 `.content` 위 absolute 프로스트 오버레이(--frost + backdrop-blur)라 높이(44px) 변경 시 `.main` padding-top 을 동기화해야 한다.

## 다크 테마
다크 토큰은 `_base.scss` 의 `:root[data-theme='dark']` 블록. main 은 창 생성 시 `theme`+`nativeTheme` 으로 backgroundColor 를 선택한다.

## 폰(MO) 스타일 — `mobile-app/styles/mo.scss`
- 데스크톱 SCSS 는 **무수정**, 폰 차이만 `html.mo` 스코프로 덮는다.
- ⚠️ `<html>` 에 붙이는 이유 — 공용 `Modal` 이 `document.body` 로 portal 하므로 셸 div 스코프면 모달 오버라이드가 전부 빗나간다.
- 실측으로 덮어야 했던 것: `.jira-view` 의 `calc(100vw - 220px - 48px)`(사이드바 폭 하드코딩 → 폰에서 144px), `.mail-list__top` 의 `display:contents` 트릭(발신자 200px 고정이 제목을 130px 로 만든다 → 2줄 전환), `.mail-list__subject` 는 `display:flex` 라 `text-overflow` 가 안 먹어 블록으로, 메일 오버레이는 **탭바 위에서 끝내기**(안 하면 portal 이 탭바를 덮어 탭 전환 불가), 각 행의 `flex-wrap`.
- ⚠️ `@use '../../renderer/styles/index'` 만으로는 **믹스인이 전달되지 않는다**(`Undefined mixin`) — `base` 를 따로 `as *` 로 함께 불러온다.

## MO 터미널 CSS (`src/mobile/mobile.css`)
- 앱 토큰 체계 밖의 모바일 전용 최소 CSS.
- **첫 페인트 깜빡임(FOUC)**: `mobile.css` 는 `mobile.ts` 가 `import` 하므로 **dev 모드에선 JS 실행 후에야 주입**되고 그 사이 흰 배경·정렬 안 된 바가 한 프레임 보인다(prod 빌드는 Vite 가 head 에 `<link>` 를 넣어 대체로 없다). 그래서 `index.html` `<head>` 에 **크리티컬 CSS**(배경·색·flex 골격 최소)를 인라인으로 둔다 — 정본은 여전히 `mobile.css` 이고, **여기 규칙을 늘리지 말 것**(두 곳이 어긋나면 디버깅이 어려워진다).
