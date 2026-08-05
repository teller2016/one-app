---
paths:
  - "**/*.scss"
  - "**/*.css"
  - "DESIGN.md"
---

# 스타일 규칙 (SCSS)

## 기준은 `DESIGN.md`
색·크기·모션은 반드시 `_base.scss` 토큰(`var(--*)`)과 타이포 믹스인(`type-*`)에서 가져온다 — **hex·px 매직넘버 금지**. 토큰 값·무드의 정본은 프로젝트 루트 `DESIGN.md` 이므로, 새 토큰을 만들거나 기존 값을 바꿔야 하면 먼저 `DESIGN.md` 를 읽을 것.

## 작성 방식
- **SCSS** (`sass-embedded`, Vite 기본 지원 — `vite.renderer.config.ts` 에서 modern-compiler API 사용).
- BEM 클래스를 `&__`/`&--` 네스팅으로 작성.
- 새 기능은 `styles/_<기능>.scss` 파일로 분리해 `index.scss` 에 `@use` 추가.
- 믹스인이 필요하면 파일 최상단에 `@use './base' as *;`.

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
