---
paths:
  - "src/mobile-app/**"
  - "src/main/lib/moIpc.ts"
  - "src/main/features/terminal/rpc.ts"
  - "src/main/lib/broadcast.ts"
  - "src/shared/mo-protocol.ts"
---

# MO 앱 셸 (폰에서 근태·Jira·PR·배포·메일)

`src/mobile-app` + `main/lib/moIpc.ts` + `main/features/terminal/rpc.ts`

핵심은 **데스크톱 기능 화면(`renderer/features/*`)을 한 줄도 고치지 않고 재사용**하는 것 — 폰에는 preload 가 없으니 `window.oneApp` 을 **WS RPC shim**(`mobile-app/shim/`)이 만든다. 렌더러는 electron/node 를 직접 import 하지 않으므로(실측 0건) 브라우저 번들이 된다.

## 브리지 — `handleShared`
`ipcMain` 에는 등록된 handle 을 main 에서 호출하는 API 가 없다 → `lib/moIpc.ts` 의 **`handleShared(channel, fn)`** 이 `ipcMain.handle` 등록과 동시에 함수를 레지스트리에 잡아 두고, `/rpc` WS 가 그 함수를 그대로 부른다(로직 중복 0).

- ⚠️ 시그니처에서 `IpcMainInvokeEvent` 를 **의도적으로 제거**했다 — `event.sender` 에 의존하는 핸들러를 실수로 폰에 열 수 없게 타입으로 막는다.
- **`handleShared` 로 등록하는 것 자체가 MO 화이트리스트 선언**이고, 안 여는 채널(`projects:pick-dir`·`settings:theme:set`·`mail:open-web`·vpn·mirror·schedule·nightwatch)은 기존 `ipcMain.handle` 로 남긴다.

## push — broadcast fan-out
WS 클라이언트는 BrowserWindow 가 아니라 `broadcast()` 로도 안 닿는다 → `lib/broadcast.ts` 에 **fan-out 훅(`onBroadcast`)** 을 두고 `rpc.ts` 가 구독한다(구독한 채널만 전달 — `terminal:data` 같은 고빈도가 새지 않게).

그래서 `deploy:status`(예전 `event.sender.send`)와 `attendance:changed/stamping`(예전 `getNotifyWindow()`)을 **broadcast 로 전환**했다. 창이 하나뿐이라 데스크톱 동작은 동일하고, 빌드 중 창을 닫았다 열면 상태를 못 받던 버그가 함께 고쳐졌다.

- ⚠️ `getNotifyWindow()` 자체는 지우지 말 것 — 알럿의 부모 창으로 쓰인다.

## 폰 셸 (`mobile-app/`)
하단 탭바 5개 + 터미널 링크.

- **활성 탭만 렌더**한다(데스크톱과 같은 규칙 — 5개를 동시에 마운트하면 각 섹션 폴러가 사내 서버를 동시에 두드린다).
- `openExternal` 은 RPC 로 보내지 않고 **`window.open`** 으로 폰에서 연다(맥에서 열리면 폰은 무반응).
- optional 후행 인자는 **`undefined` 를 잘라내 보낸다** — JSON 직렬화가 `null` 로 바꾸면 기본 파라미터(`getInbox(q = {})`)가 무력화돼 터진다.
- 폰은 평문 http = insecure context 라 **`navigator.clipboard` 가 없다** → `lib/useCopy.ts` 에 `execCommand` 폴백을 넣었다(데스크톱은 기존 경로).

스타일 오버라이드(`mobile-app/styles/mo.scss`)는 스타일 규칙 문서 참고 — 데스크톱 SCSS 무수정, `html.mo` 스코프로만 덮는다.
