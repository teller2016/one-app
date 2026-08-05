---
name: new-section
description: One App 에 새 기능(사이드바 섹션 또는 사이드바 위젯)을 추가하는 절차. 렌더러 컴포넌트·SECTIONS 등록·SCSS·IPC·preload·타입까지 빠짐없이 연결한다. 사용법 - /new-section 또는 /new-section "기능 이름"
argument-hint: [기능 이름]
---

# /new-section — 새 기능(섹션) 추가

One App 에 기능을 하나 추가할 때 손대야 할 곳을 순서대로 처리한다. 빠뜨리기 쉬운 연결(타입 갱신·`@use` 추가·IPC 등록)이 핵심이다.

## 0. 먼저 확인
- 기능 이름(kebab-case 폴더명)을 정한다. 인자로 주어졌으면 그것을 쓰고, 없으면 사용자에게 묻는다.
- **섹션**(메인 영역 화면)인지 **사이드바 위젯**인지 확인한다 — 위젯이면 2번(SECTIONS 등록) 대신 사이드바 배치를 손댄다.
- 파일·프로세스·네이티브 작업이 필요한지(= main 쪽이 필요한지) 확인한다. 순수 UI 면 4번을 건너뛴다.

## 1. 렌더러 컴포넌트
- `src/renderer/features/<기능>/components/<기능>Section.tsx` 작성
- `src/renderer/features/<기능>/index.ts` 로 export (**공개 API — 다른 기능은 이 파일로만 참조한다**)
- 화면이 커지면 `components/` 를 Section(오케스트레이션)·Card·Form 등으로 나누고, 포맷 헬퍼는 `lib/` 로 분리한다(deploy 기능이 참고 사례).

## 2. 앱 셸에 등록
- `src/renderer/app/App.tsx` 의 `SECTIONS` 에 항목 추가 — `render` 필드에 컴포넌트를 넣는다(switch 분기 없음).

## 3. 스타일
- `src/renderer/styles/_<기능>.scss` 작성
- `src/renderer/styles/index.scss` 에 `@use` 추가
- 믹스인이 필요하면 파일 최상단에 `@use './base' as *;`
- 색·크기는 `_base.scss` 토큰만 사용(hex·px 매직넘버 금지). 기준은 `DESIGN.md`.

## 4. 메인 프로세스 (필요할 때만)
- `src/main/features/<기능>/ipc.ts` 에 핸들러 작성 (로직 파일도 같은 폴더에)
- `src/main/main.ts` 에서 `register...Ipc()` 호출
- 폰(MO)에서도 써야 하면 `ipcMain.handle` 대신 `handleShared` 로 등록 (= MO 화이트리스트 선언). 이때 클라이언트가 경로를 직접 넘기지 않도록 식별자만 받는다.
- 저장이 필요하면 `main/lib/store.ts` 의 `readUserJson`/`writeUserJson`, 비밀은 `encryptSecret`/`decryptSecret`.
- REST 호출은 `main/lib/http.ts` 의 `fetchWithTimeout`(전역 fetch 금지).
- 프로젝트 경로·저장소 정보가 필요하면 자체 저장하지 말고 프로젝트 레지스트리(`features/projects/store.ts`)를 참조한다.

## 5. 브리지·타입
- `src/preload/preload.ts` 에 API 노출
- `src/shared/types.ts` 에 공용 타입 추가
- `src/renderer/types/global.d.ts` 의 `window.oneApp` 타입 갱신

## 6. 마무리
- `npx tsc --noEmit` 으로 타입 검사
- 기능에 함정·실측 지식이 생겼으면 `.claude/rules/features/` 에 해당 규칙 파일을 추가하거나 갱신한다(paths 프론트매터로 그 기능 경로에 스코프). **CLAUDE.md 에 기능 상세를 쓰지 않는다.**
- 커밋은 `/commit` 스킬 사용.
