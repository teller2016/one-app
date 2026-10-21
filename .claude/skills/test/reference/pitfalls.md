# /test 함정 — 앱 버그로 오진하기 쉬운 것들

## 창이 가려졌을 때 — 앱은 멀쩡한데 테스트만 실패한다

| 증상 | 원인 | 대응 |
|------|------|------|
| `waitForSelector` 가 영영 안 풀림 | RAF 스로틀 (기본 폴링이 RAF) | `lib.waitFor` (evaluate + setTimeout 폴링) |
| 크기 변화에 반응하는 코드만 안 돎 | `ResizeObserver` 콜백 미발화 | 창이 보이게 한 뒤 다시 (아래) |
| xterm 등 DOM 갱신이 멈춤 | 완전히 가려지면 `document.hidden` | DOM 대신 IPC 스트림으로 단정 |
| `page.screenshot` 이 60초 매달림 | 가려진 창은 프레임이 안 나온다 | `lib.shot` 이 먼저 판정해 바로 실패시킨다 |
| 스크린샷 배경이 흰색 | CDP 캡처는 비브런시(반투명 배경)를 못 찍는다 | 색·질감 확인은 `lib.realShot` (screencapture -l, 덮여 있어도 그 창만 찍힘) |
| 측정값이 들쭉날쭉 | transition 중간값 | `lib.noMotion(page)` 후 측정, 끝나면 되돌리기 |

- **먼저 `lib.visibility(page)` 로 판정한다** — `state: 'hidden'` 이면 완전히 가려진 것. 일부만 덮인 창은 `visible` 이고 정상 렌더된다.
- ⚠️ **창을 프로그램으로 앞으로 가져오는 건 믿을 수 없다**(2026-10-21 실측):
  - `page.bringToFront()` 는 OS 가려짐을 못 푼다.
  - `tell application "Electron"` 은 이름이 같은 다른 앱(사용자 IDE)을 잡는다.
  - main 에서 `app.focus({ steal: true })` 를 불러도 macOS 가 포커스 뺏기를 막는다(`hasFocus` false 그대로).
  → `hidden` 이면 사용자에게 "dev 창을 잠깐 앞으로" 부탁하거나, IPC·수치·`realShot` 으로 판정하고 보고에 "가려져 못 본 것" 을 적는다.
- **셸이 launchd Background 세션이면**(`launchctl managername` → `Background`, 설치본 터미널의 tmux) Bash 로 직접 띄운 dev 는
  창이 안 보인다 — `document.hidden=true`·dpr 1·System Events 목록에도 없음, xterm 이 안 그려진다(2026-10-21 실측).
  → `dev.sh up` 이 `launchctl bootstrap gui/<uid>` 로 **GUI(Aqua) 세션의 LaunchAgent** 로 띄워 해결한다(창 없이 — 예전엔 Terminal.app 에
  `do script` 로 띄워 사용자 화면에 터미널 창이 떴다). System Events `do shell script` 는 **안 된다** — osascript 자신의 세션(Background)에서 돈다.
- launchd 로 띄운 dev 는 macOS 권한(TCC)을 **`node_modules` 의 Electron 기준**으로 본다(Terminal.app 으로 띄우면 Terminal 기준이었다) —
  dev 에서 독 패널을 처음 테스트할 때 접근성 허용을 한 번 더 요구할 수 있다(`dock.ts` 의 `isTrustedAccessibilityClient`).

## 클릭
- `evaluate(() => el.click())` 은 **click 이벤트만** 보낸다. onMouseDown·pointerdown 기반(Select 옵션·외부클릭 닫힘·TimePicker)은
  `lib.realClick(page, sel)` 좌표 클릭으로.
- `ElementHandle.click()` 은 요소가 가려지거나 화면 밖이면 실패한다 — `realClick` 이 scrollIntoView 후 좌표로 누른다.
- 팝오버·메뉴를 열어 둔 채 끝내지 말 것 — 사용자 dev 화면에 남는다(09-29 정리에 3호출).

## dev 기동·종료
- `electron-forge start` 만 죽이면 **Electron 이 고아로 남아 디버깅 포트를 쥔다** → 새 dev 가 포트를 못 잡고
  `puppeteer.connect` 가 **옛 코드를 돌던 앱에 조용히 붙는다** → "고쳐도 안 고쳐진다" 오진. `dev.sh down` 이 포트가 빌 때까지 확인한다.
- 디버깅 포트가 열린 직후에도 화면은 아직 비어 있을 수 있다 — `lib.ready(page)` 로 사이드바 렌더까지 기다린다(고정 sleep 금지).
- `pkill -f "electron-forge start"` 는 **단독판 lite 도 같이 죽인다**(lite 도 같은 start 스크립트). `dev.sh` 는 작업 폴더로 걸러낸다.
- `run_in_background` 로 띄운 dev 를 내리면 그 작업의 종료 알림이 온다 — 내가 내린 것이니 새로 진단하지 않는다.

## 셸 (macOS · zsh) — 각각 1~2회씩 재실행을 부른 것
- **`timeout` 명령이 없다** → 스크립트는 `lib.attach({ deadlineSec })` 의 자체 타임아웃으로.
- **zsh `=단어` 확장**: `echo ====`·`tmux -t =이름` 이 "not found" 로 깨진다 → 따옴표로 감싼다.
- **zsh glob 불일치는 에러**: `grep --include=*.tsx`·`ls main-errors*` 가 "no matches found" → 패턴을 따옴표로.
- **포그라운드 `sleep` 은 막힌다** → 기다림은 폴링 루프(`dev.sh wait`) 나 `run_in_background`.
- `pgrep -f` 패턴의 괄호는 정규식이다 — `Electron Helper (Renderer)` 는 이스케이프하거나 피한다.
- 통합 로그는 `/usr/bin/log` 로 (zsh 내장 `log` 가 가로챈다).

## 판정
- **스크린샷은 축소되어 표시된다** — 2560px 원본이 2000px 로 보이면 좌표에 1.28 을 곱한다. 넓은 창의 오른쪽 빈 영역은
  렌더 실패가 아니라 배경 여백이다. 레이아웃이 의심되면 눈 대신 `.main` 수치로.
- `window.oneApp` 은 contextBridge 라 **대입이 조용히 무시**된다 — IPC 인자를 후킹으로 계측할 수 없다. 간접 측정(응답 시간·결과 차이)으로.
- 레이스·stale 응답을 재현할 때는 **고치기 전 코드에서 테스트가 실패하는지 먼저** 본다(렌더러는 파일만 되돌리면 HMR 로 즉시 반영).
