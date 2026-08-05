---
paths:
  - "src/main/**"
  - "src/preload/**"
  - "src/shared/**"
---

# 메인 프로세스 규칙 (main · preload)

## 공통 유틸 재사용 (중복 정의 금지)
- REST 호출은 `main/lib/http.ts` 의 `fetchWithTimeout` — **전역 fetch 직접 사용 금지**(타임아웃이 없어 소켓 hang 시 IPC 가 영영 안 풀린다). `import { fetchWithTimeout as fetch }` 패턴을 쓴다.
- userData JSON·safeStorage 암복호화는 `main/lib/store.ts`(`readUserJson`·`writeUserJson`·`encryptSecret`·`decryptSecret`).
- 전 창 이벤트는 `main/lib/broadcast.ts`.
- `sleep`·`localDateKey` 는 `main/lib/util.ts`.
- 외부 HTML(메일 본문·Jira 이슈 등)은 렌더 전에 `main/lib/sanitize.ts` 의 `sanitizeHtml` 로 정화한다 — 렌더러의 **sandbox iframe 과 함께 이중 방어**이므로 둘 중 하나만 쓰지 말 것.

## IPC 등록
- 기능 모듈은 `features/<기능>/ipc.ts` 에 핸들러를 작성하고 `main.ts` 에서 `register...Ipc()` 로 호출한다. 로직 파일도 같은 폴더에 둔다.
- 렌더러↔메인 통신은 preload 에 노출한 `window.oneApp` API로만. `nodeIntegration` 을 켜지 않는다.
- 공용 타입은 `src/shared/types.ts` 에 두고 3개 컨텍스트에서 import. 추가 시 `src/renderer/types/global.d.ts` 의 `window.oneApp` 타입도 갱신.

## MO(모바일) 노출 — `handleShared`
- `lib/moIpc.ts` 의 **`handleShared(channel, fn)`** 은 `ipcMain.handle` 등록과 동시에 함수를 레지스트리에 잡아 두고, `/rpc` WS 가 그 함수를 그대로 부른다(로직 중복 0).
- ⚠️ 시그니처에서 `IpcMainInvokeEvent` 를 **의도적으로 제거**했다 — `event.sender` 에 의존하는 핸들러를 실수로 폰에 열 수 없게 타입으로 막는다.
- **`handleShared` 로 등록하는 것 자체가 MO 화이트리스트 선언**이다. 폰에 안 여는 채널(`projects:pick-dir`·`settings:theme:set`·`mail:open-web`·vpn·mirror·schedule·nightwatch)은 기존 `ipcMain.handle` 로 남긴다.
- ⚠️ 폰에 열리는 채널은 **클라이언트가 경로를 직접 넘기게 하지 말 것** — 식별자(projectId/sessionId)만 받아 main 이 해석하고, 파일 경로는 저장소 밖 탈출을 검증한다.

## 비밀 정보
- 비밀번호·토큰은 `safeStorage` 로 암호화해 userData 에만 저장. 코드·리포에 하드코딩 금지. `.env`/`settings.json`(계정) 커밋 금지.

## 프로젝트 경로·저장소 정보
- 자체 저장하지 말고 **프로젝트 레지스트리**를 참조한다 — `features/projects/store.ts` 의 조회 헬퍼(`getProject`·`findProjectByPath`·`findProjectByRepo`·`findProjectsByJiraKey`·`remoteOwnerRepo`)를 직접 import. 원격 주소의 owner/repo 파싱은 `shared/types.ts` 의 `ownerRepoFromUrl`(main·렌더러 공용).
