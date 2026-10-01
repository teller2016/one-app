---
paths:
  - "src/mobile-app/**"
  - "src/main/lib/moIpc.ts"
  - "src/main/features/terminal/rpc.ts"
  - "src/main/lib/broadcast.ts"
  - "src/shared/mo-protocol.ts"
---

# MO 앱 셸 (폰 — 터미널 중심 · 변경·Jira·PR·더보기(근태·배포·메일))

`src/mobile-app` + `main/lib/moIpc.ts` + `main/features/terminal/rpc.ts`

핵심은 **데스크톱 기능 화면(`renderer/features/*`)을 한 줄도 고치지 않고 재사용**하는 것 — 폰에는 preload 가 없으니 `window.oneApp` 을 **WS RPC shim**(`mobile-app/shim/`)이 만든다. 렌더러는 electron/node 를 직접 import 하지 않으므로(실측 0건) 브라우저 번들이 된다.

## 브리지 — `handleShared`
`ipcMain` 에는 등록된 handle 을 main 에서 호출하는 API 가 없다 → `lib/moIpc.ts` 의 **`handleShared(channel, fn)`** 이 `ipcMain.handle` 등록과 동시에 함수를 레지스트리에 잡아 두고, `/rpc` WS 가 그 함수를 그대로 부른다(로직 중복 0).

- ⚠️ 시그니처에서 `IpcMainInvokeEvent` 를 **의도적으로 제거**했다 — `event.sender` 에 의존하는 핸들러를 실수로 폰에 열 수 없게 타입으로 막는다.
- **`handleShared` 로 등록하는 것 자체가 MO 화이트리스트 선언**이고, 안 여는 채널(`projects:pick-dir`·`settings:theme:set`·`mail:open-web`·vpn·mirror·schedule·nightwatch)은 기존 `ipcMain.handle` 로 남긴다. 2026-09-10 에 `jira:report:*`(보고)와 `mail:authcode:accounts`·`fetch`(인증코드 조회)를 열었다 — 폰이 같은 화면을 마운트하는데 닫혀 있어 죽던 것.

## push — broadcast fan-out
WS 클라이언트는 BrowserWindow 가 아니라 `broadcast()` 로도 안 닿는다 → `lib/broadcast.ts` 에 **fan-out 훅(`onBroadcast`)** 을 두고 `rpc.ts` 가 구독한다(구독한 채널만 전달 — `terminal:data` 같은 고빈도가 새지 않게).

그래서 `deploy:status`(예전 `event.sender.send`)와 `attendance:changed/stamping`(예전 `getNotifyWindow()`)을 **broadcast 로 전환**했다. 창이 하나뿐이라 데스크톱 동작은 동일하고, 빌드 중 창을 닫았다 열면 상태를 못 받던 버그가 함께 고쳐졌다.

- ⚠️ `getNotifyWindow()` 자체는 지우지 말 것 — 알럿의 부모 창으로 쓰인다.

## 폰 셸 (`mobile-app/`) — 2026-10-01 재구성 (목업: 캔버스 'MO(폰)' 페이지)
하단 탭 5개 **터미널(첫 화면) · 변경 · Jira · PR · 더보기**. 더보기 = 근태 카드 + 배포·메일 하위 화면(머리 [뒤로] + 폰 뒤로가기).
화면 머리(52 · 제목 16/600 · 연결 점)는 셸이 그리고, 섹션 컨트롤은 지금처럼 `TopbarSlot` 제자리(`.topbar-inline`) 줄이다.

- **터미널 탭만 keep-alive**(`hidden` 으로 숨김 — xterm·attach 를 탭 전환마다 다시 하지 않게). 나머지는 **활성 탭만 렌더**한다(데스크톱과 같은 규칙 — 동시에 마운트하면 각 섹션 폴러가 사내 서버를 동시에 두드린다).
- 탭 배지: 터미널 = 입력 대기 수(`moTerminal` 상태 — 주황), 더보기 = 안 읽은 메일(셸이 `mail.getUnreadCount` 를 데스크톱 상태바와 같은 30초 `usePolling`). 더보기의 '빌드 중 N' 은 `deploy:status` push 만 센다(셸 폴링 없음).
- 키보드가 열리면 터미널이 `html.mo-kbd` + `--mo-vh` 를 건다 → 셸 높이 = `--mo-vh`, 탭바 숨김.
- **변경 탭은 터미널에서 보는 워크트리를 따라간다**(`{workspaceId, worktreePath}` — main 이 워크트리 목록과 대조 검증). [바꾸기]로 프로젝트 레지스트리 대상도 고른다.
- **Jira 는 내 이슈만**(`<JiraSection mineOnly />` — 주간·보고는 필터·템플릿·일괄 복사가 많은 데스크톱 작업이라 폰에서 뺐다).
- 폰에서 **동작하지 않는** 진입점은 숨긴다(`mo.scss`): 배포 [프로젝트 추가]·카드 [편집]·[삭제](`deploy:projects:save/delete` 는 MO 에 안 열린 쓰기 채널), 메일 "비즈박스 메일함 열기"(`mail:open-web` 없음 — 예전엔 눌러도 undefined 호출로 무반응이었다).
- `openExternal` 은 RPC 로 보내지 않고 **`window.open`** 으로 폰에서 연다(맥에서 열리면 폰은 무반응).
- optional 후행 인자는 **`undefined` 를 잘라내 보낸다** — JSON 직렬화가 `null` 로 바꾸면 기본 파라미터(`getInbox(q = {})`)가 무력화돼 터진다.
- 폰은 평문 http = insecure context 라 **`navigator.clipboard` 가 없다** → `lib/useCopy.ts` 에 `execCommand` 폴백을 넣었다(데스크톱은 기존 경로).
- ⚠️ **shim 의 채널 표(`SPEC`)는 수동이다 — PC 가 preload 에 메서드를 더하면 여기도 더해야 한다.** 빠지면 폰에서 그 버튼을 누르는 순간 `undefined is not a function` 으로 탭 전체가 ErrorBoundary 오류 카드가 된다(2026-09-10 감사: Jira [보고]·[+ 티켓]·PR [새 PR]·메일 [인증코드] 네 곳이 8월 셸 이후 이렇게 죽어 있었다 — 타입·빌드 어디서도 안 잡힌다). **`shim/oneApp.test.ts`** 가 폰 셸(`main.tsx`)에서 import 로 도달하는 렌더러 소스의 `window.oneApp.X.Y` 호출 ↔ SPEC ↔ main 의 `handleShared`/`broadcast` 를 대조한다. 데스크톱 전용이라 폰에서 진입점을 숨기는 흐름은 그 테스트의 `DESKTOP_ONLY` 에 **이유와 함께** 적는다. 표는 중첩 네임스페이스(`jira.added.*`·`jira.report.*`)를 지원한다.
- **폰에서 숨기는 데스크톱 전용 진입점**(`mo.scss`): `.sbw__overtime`(야근 결재 — 상신 흐름) · `.jira__work`/`.jira-view__work`(Jira 작업 시작 — 맥에 femc 세션을 만든다).

스타일 오버라이드(`mobile-app/styles/mo.scss`)는 스타일 규칙 문서 참고 — 데스크톱 SCSS 무수정, `html.mo` 스코프로만 덮는다.

- ⚠️ **데스크톱 화면을 개편하면 그 기능의 MO 오버라이드도 함께 봐야 한다** — 오버라이드는 클래스 이름으로 붙어 있어서, 개편으로 클래스가 바뀌면 **조용히 아무 일도 하지 않는다**(에러도 경고도 없다). PR 섹션을 마스터-디테일로 개편했을 때 `prs__meta`·`prs__quick-row`·`prs__main`·`prs__title` 오버라이드가 통째로 죽어 폰에서 화면이 깨졌다(2026-08-08 사용자 지적). 의심되면 `mo.scss` 의 선택자를 그 기능의 실제 클래스와 대조할 것.
- 데스크톱이 이미 좁은 창을 처리한다면(예: `prs__body` 는 1080px 이하에서 1열로 스택) 그 규칙을 다시 쓰지 말고, **폰에서만 어긋나는 것**만 덮는다 — 데스크톱 탑바 기준의 `sticky top`·고정폭(`width: 200px`) 같은 것들이다.
- ⚠️ **오버라이드는 그 클래스를 쓰는 다른 화면에도 샌다** — 내 이슈 행용 `.jira__title { white-space: normal; flex: 1 1 100% }` 이 보고 표의 제목 셀에도 걸려 240px 트랙 안에서 제목이 5줄로 감싸졌다(2026-09-10 실측, 493행 중 58%). 공용 요소 클래스(`jira__title`·`chip` 등)를 덮을 때는 그 클래스의 사용처를 grep 하고, 화면 컨테이너로 스코프를 좁히거나 다른 사용처에서 되돌리는 규칙을 함께 둔다.

## 뒤로가기로 오버레이 닫기
공용 `useBackClose`(`renderer/lib/useBackClose.ts`)가 **모든 모달**(`Modal`)과 **확인 다이얼로그**(`ConfirmDialog`)에 걸려 있다 — 폰에서 모달을 띄운 채 뒤로가기를 누르면 앱을 벗어나던 것을 막는다(2026-08-08, MO 터미널에서 먼저 겪고 공통화).

- 열릴 때 `history.pushState` 로 항목을 쌓고, **뒤로가기로 닫히면** `popstate` 가 `onClose` 를, **UI 로 닫히면** 언마운트 cleanup 이 `history.back()` 을 부른다. ⚠️ 후자를 빼먹으면 유령 항목이 쌓여 나중에 뒤로가기를 두 번 눌러야 나간다.
- ⚠️ `onClose` 는 렌더마다 새 함수일 수 있어 **ref 로 참조**한다 — deps 에 넣으면 항목이 계속 쌓인다.
- ⚠️ **데스크톱에서는 아무 일도 하지 않는다**(`html.mo` 가 있을 때만 동작). 처음엔 양쪽에 걸었는데, 데스크톱에서 히스토리 항목을 쌓으니 **마우스 X1/X2 의 Electron 기본 앞/뒤 동작과 겹쳐 섹션 이동이 뒤엉켰다** — "앞으로 가기하면 뒤로 간다"는 증상으로 나타났다(2026-08-08 사용자 지적). 데스크톱은 뒤로가기 버튼이 없어 이 기능이 필요 없고, 모달은 Escape·오버레이 클릭으로 닫는다.
- 터미널 탭의 시트·메뉴도 이 `useBackClose` 를 쓴다(옛 `src/mobile` 페이지의 자체 구현은 셸 탭으로 합치며 없앴다).
- ⚠️ **닫자마자 다른 오버레이를 여는 흐름**(메뉴 → 확인창, 새 세션 시트 → 작업 영역 시트) — UI 로 닫을 때의 `back()` 을 **50ms 미루고**, 그 사이 열린 오버레이가 **그 항목을 물려받는다**(back·push 둘 다 생략). 바로 back() + 새 push 를 하면 ① 뒤늦은 popstate 가 새 확인창을 즉시 닫고 ② 새 오버레이의 항목이 사라져 닫는 순간 **앱 밖으로 나갔다**(2026-10-01 /test). 미룬 back 의 popstate 는 모듈 전역 리스너가 한 번 삼킨다(1초 만료) — 중첩 모달의 바깥이 함께 닫히는 것도 이것이 막는다. 검증은 `navigation.currentEntry.index` 가 오버레이마다 +1 → 닫으면 기준값인지로.
- dev 에서 폰 화면(Tailscale 도메인:18318)을 볼 때의 `wss://…:18318` 403 · `wss://localhost:5173` SSL · `[vite] failed to connect to websocket` 은 HMR 클라이언트가 터널 너머로 붙으려다 나는 **무해한 노이즈**다(`/test` 에서 무시).
