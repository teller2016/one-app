---
paths:
  - "src/main/**"
  - "src/preload/**"
  - "src/shared/**"
---

# 메인 프로세스 규칙 (main · preload)

## 공통 유틸 재사용 (중복 정의 금지)
- REST 호출은 `main/lib/http.ts` 의 `fetchWithTimeout` — **전역 fetch 직접 사용 금지**(타임아웃이 없어 소켓 hang 시 IPC 가 영영 안 풀린다). `import { fetchWithTimeout as fetch }` 패턴을 쓴다.
- **Gitea REST 는 `main/lib/gitea.ts`**(`giteaFetch`·`giteaJson`·`giteaAuthHeaders`) — 인증 헤더와
  실패 문구(연결 실패·인증 실패·404·기타)가 여기 한 곳에 있다. deploy·prs 두 기능이 공유한다.
  상태코드별 문구는 `errors: { auth, notFound, byStatus }`, 실패를 조용히 넘길 조회는 `raw: true`.
- **Jira 인증 헤더는 `features/jira/jira.ts` 의 `jiraAuth()`** — Basic 헤더를 직접 조립하지 말 것
  (jira·work·nightwatch 세 곳이 각자 만들던 것을 단일화했다).
- **날짜·시간 문자열은 `shared/date.ts`**(`pad2`·`dayKey`·`todayKey`·`monthKey`·`parseDayKey`·
  `toMinutes`·`fromMinutes`·`WEEKDAY_KO`) — main·preload·렌더러 공용. `String(n).padStart(2,'0')` 을
  새로 쓰지 말 것. ⚠️ 예외 하나: `lib/util.ts` 의 `localDateKey` 는 0패딩 없는 레거시 형식이고
  저장본(`reminder-state.json`) 호환 때문에 남아 있다 — 새 코드에서 쓰지 않는다.
- **결재 표기 규칙은 `shared/approval-format.ts`**(`vacationTitle`·`formatHoursTotal`·
  `KIND_DAY_FACTOR`) — 렌더러 폼 미리보기와 main 자동화가 **같은 문자열**을 만들어야 한다.
- 원격 주소의 owner/repo 파싱은 `shared/types.ts` 의 `ownerRepoFromUrl`(문자열)·
  `ownerRepoPartsFromUrl`(조각). ⚠️ `new URL()` 로 파싱하지 말 것 — ssh 주소에서 던진다.
- userData JSON·safeStorage 암복호화는 `main/lib/store.ts`(`readUserJson`·`writeUserJson`·`encryptSecret`·`decryptSecret`).
- 전 창 이벤트는 `main/lib/broadcast.ts`.
- `sleep`·`localDateKey`·`withTimeout` 은 `main/lib/util.ts`.
- **브라우저 자동화는 `main/lib/browser.ts`** (Electron BrowserWindow — `openPage`·`goto`·
  `evalInPage`·`waitInPage`·`fireInPage`·`waitForPopup`·`releasePage`·`closePage`).
  ⚠️ **`puppeteer` 를 새로 쓰지 말 것** — 2026-08-10 전환으로 앱에서 완전히 빠졌다(시스템 Chrome
  의존 제거). 그룹웨어 페이지가 필요하면 `groupware/session.ts` 의 `gotoWithSessionInWindow` 로
  쿠키를 주입해 로그인 화면을 건너뛴다. 상세는 `groupware-session` 규칙.
- 창 크기·위치 기억은 `main/lib/windowState.ts`(`loadWindowState`·`trackWindowState`·`WINDOW_MIN`) — `userData/window-state.json`.
  - ⚠️ **`getBounds()` 가 아니라 `getNormalBounds()`** 로 저장한다 — 최대화·전체화면 상태에서 저장하면 화면 전체 크기가 잡혀 **되돌릴 크기를 잃는다**.
  - ⚠️ 복원 전 **화면 밖인지 검사**한다(`isReachable`) — 외부 모니터에 두고 껐다가 노트북만으로 켜면 창이 보이지 않는다(있긴 한데 손이 닿지 않는다). 이때 좌표만 버리고 크기는 살린다.
  - resize/move 는 드래그 중 초당 수십 번 오므로 500ms 디바운스 + `close` 에서 확정. ⚠️ **SIGTERM 으로 죽이면 `close` 가 안 탄다**(2026-08-09 실측) — 창을 한 번이라도 움직였으면 디바운스 저장분이 남으므로 실사용에는 문제없다.
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
- ⚠️ **`encryptSecret` 은 키체인을 못 쓰면 throw 한다** — 평문 base64 폴백을 없앴다(2026-09-03 보안 검토).
  환경을 통제할 수 없는 단독 배포판에서 그룹웨어 비밀번호가 평문으로 쌓이는 것을 막기 위함이다.
  호출부는 저장 실패를 사용자에게 알려야 한다(환경설정은 `secureStorage` 배너 + 토스트로 처리 중).
  복호화(`decryptSecret`)의 평문 폴백은 예전 저장본 호환용으로 남겨 둔다.
- **연동 주소(`jiraUrl`·`giteaUrl`)는 `settings/store.ts` 의 `normalizeEndpoint` 로 검증**한다 —
  `http(s)` 외 스킴을 막는다. 그 주소에 **인증 헤더가 실려 나가기** 때문이다. `http:` 자체는
  막지 않지만(사내 Gitea 가 평문 HTTP) 환경설정 화면이 경고 문구를 띄운다.
- **자동화 창(`lib/browser.ts`)은 그룹웨어 도메인만 앱 창으로 연다**(`isInternalUrl`) — 그 밖의
  주소는 `shell.openExternal` 로 넘긴다. 앱 창에는 주소창이 없어 목적지를 확인할 수 없다.
  ⚠️ 빈 URL·`about:blank` 는 반드시 허용 — 지출결의서 '찾기' 도움창이 빈 창부터 연다.

## 프로젝트 경로·저장소 정보
- 자체 저장하지 말고 **프로젝트 레지스트리**를 참조한다 — `features/projects/store.ts` 의 조회 헬퍼(`getProject`·`findProjectByPath`·`findProjectByRepo`·`findProjectsByJiraKey`·`remoteOwnerRepo`)를 직접 import. 원격 주소의 owner/repo 파싱은 `shared/types.ts` 의 `ownerRepoFromUrl`(main·렌더러 공용).
