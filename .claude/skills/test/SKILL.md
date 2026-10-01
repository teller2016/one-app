---
name: test
description: 개발 인스턴스(npm start)를 실제로 띄워 이슈가 없는지 확인한다. main 예외·렌더러 콘솔 에러를 감시하고, 필요하면 puppeteer 로 화면을 직접 조작해 검증한다. 메인 대화에서 직접 실행한다. 사용법 - /test 또는 /test "확인할 것" 또는 /test --fix
argument-hint: [확인할 것] [--fix]
---

# /test — 개발 인스턴스로 실제 구동 테스트

> 💬 **메인 대화에서 직접 실행한다** — 서브에이전트(`tester`)로 넘기지 않는다(2026-10-01 사용자 지시).
> 백그라운드 에이전트는 사용자에게 묻지 못해 dev 재시작 같은 확인 지점에서 구동 없이 멈췄고, 메인이 대신 묻고
> 재개하는 왕복이 생겼다. "사용자에게 확인" 지점에서는 **`AskUserQuestion` 으로 바로 묻고** 이어서 진행한다.
> 확인할 것: $ARGUMENTS

`npm start` 로 앱을 **실제로 띄워** 이슈가 나는지 본다. 정적 검사만으로는 안 보이는 것 — 런타임 예외·렌더 실패·IPC 미연결·콘솔 에러 — 이 대상이다.

> ⚠️ **빌드하지 않는다.** `/build`·`npm run package`·`npm run make` 는 `/Applications` 설치본을 교체하고 서명이 빠지면 저장된 계정이 날아간다. 이 스킬은 **개발 인스턴스만** 쓴다.

## 0. 시작 전에 반드시 알 것

- ⚠️ **개발 인스턴스는 userData(설정)를 빌드 앱과 공유한다.** 상태를 바꾸는 IPC(`set*`·`save*`·`delete*`)를 테스트로 부르면 **사용자의 진짜 설정이 바뀐다.** 부르기 전에 현재 값을 읽어 두고 **끝나면 원복**한다.
- ⚠️ **떠 있는 dev 창에 사용자의 진짜 작업(터미널 세션)이 들어 있을 수 있다.** 말없이 내리지 말 것. 세션을 정리할 때는 내용을 먼저 확인하고(`tmux -L oneapp-dev capture-pane -p -t <이름>`) **내가 만든 것만** 지운다.
- ⚠️ 그룹웨어 결재·근태처럼 **외부에 실제 기록을 남기는 기능**은 묻지 않고 실행하지 않는다. 검증이 필요하면 사용자에게 먼저 묻고, 허락받았을 때만 실행한 뒤 남은 흔적의 정리 방법까지 보고한다.
- ⚠️ **빌드 앱과 dev 가 동시에 떠 있으면 출퇴근 리마인더·알림이 2벌 돈다**(`devInstance` 가 가르는 건 포트·tmux 소켓·창 상태뿐이다). 테스트로 잠깐 띄우는 건 괜찮지만, 오래 켜둘 거면 사용자에게 알린다.
- 끝나면 앱을 **원래 상태로 되돌려 둔다** — 원래 떠 있었으면 `npm start` 로 되살리고, 내가 띄운 것이면 내린다.
- ⚠️ **이 Claude 세션이 설치본 One App 의 터미널 안에서 돌고 있을 수 있다** — 사용자는 One App 의 터미널 섹션에서 `claude` 를 띄운다(`tmux -L oneapp list-sessions` 에 attached 세션). 그때 설치본을 끄면(`osascript quit`·`pkill`) **사용자 화면이 사라지고** 사용자는 앱을 다시 연다(2026-09-07 — 세 번 반복하고서야 알아챔). 설치본을 꺼야만 검증되는 것(VPN 관리 소켓처럼 한 클라이언트만 받는 자원)은 dev 로 검증하지 말고 `/build` 로 설치본에 실어 확인한다.

## 1. 사전 검사 — 여기서 걸리면 앱을 띄울 이유가 없다

```bash
npx tsc --noEmit        # 실패하면 여기서 멈추고 보고
npm test                # 순수 로직(status·prDraft·layout 등)을 건드렸을 때만
```
`npm run lint` 는 경고만 확인하고 진행을 막지 않는다(훅 규칙 경고는 0 을 유지하는 것이 목표).

## 2. 띄울지 / 재사용할지 판단

```bash
git diff --name-only HEAD; git status --short
pgrep -fl "electron-forge start"
```

| 바뀐 곳 | 판단 |
|---------|------|
| `src/renderer/**` · `src/mobile-app/**` · `*.scss` | **HMR** — 떠 있으면 그대로 재사용 |
| `src/main/**` · `src/preload/**` · `src/shared/**` | **재시작 필요** — 핫리로드 안 됨 |
| `vite.*.config.ts` · `forge.config.ts` · `package.json` | 재시작 필요 |

- 재시작이 필요한데 **이미 떠 있으면** → 작업 세션이 있을 수 있으므로 **말없이 내리지 않는다.** 누가 띄웠는지(아래)와 dev tmux 세션 내용(`tmux -L oneapp-dev list-sessions` → `capture-pane -p`)을 확인해 `AskUserQuestion` 으로 재시작 여부를 묻는다. 거절하면 정적 검사·떠 있는 인스턴스로 볼 수 있는 것까지만 확인한다.
  - 누가 띄웠나: `ps eww -o command= -p <dev Electron pid> | tr ' ' '\n' | grep TERM_PROGRAM` — `Apple_Terminal`·`iTerm.app` 이면 사용자가 직접, `tmux` 면 설치본 터미널(Claude 쪽)에서 띄운 것.
  - ⚠️ dev tmux 서버(`oneapp-dev`)를 claude 세션 안에서 처음 띄우면 `CLAUDE_CODE_CHILD_SESSION` 등을 물려받을 수 있다 — `pty.ts` 의 `inheritableEnv()` 가 걸러내지만, 그 전에 뜬 서버는 옛 env 를 들고 있다. 상속 여부는 `ps eww` 로 판정할 수 없다(env 가 잘려 보인다) — pane 안에서 `env | grep CLAUDE` 또는 claude 기동 문구 "Transcript saving is off" 로 확인한다.
- HMR 로 충분하면 재시작하지 않는다(재시작은 창 상태·세션 복원을 흔든다).

## 3. 띄우기

```bash
npm start -- -- --remote-debugging-port=9333 > <스크래치패드>/dev.log 2>&1
```
- `--` 를 **두 번** 쓴다 — 앱 인자로 전달돼야 Chromium 이 파싱한다.
- Bash 의 `run_in_background` 로 띄우고, 로그는 스크래치패드 파일에 남긴다.
- 기동 완료는 **디버깅 포트가 열리는 것**으로 판정한다 — `sleep` 대신 폴링하고, 이것도 `run_in_background` 로 돌려 기다리는 동안 다른 준비를 한다.
  ```bash
  for i in $(seq 1 120); do lsof -nP -iTCP:9333 -sTCP:LISTEN >/dev/null 2>&1 && exit 0; sleep 0.5; done; exit 1
  ```

- `run_in_background` 로 띄운 dev 는 나중에 내리면(`pkill`) 그 백그라운드 작업 종료 알림이 온다 — 내가 내린 것이니 새로 진단하지 않는다(2026-09-29 하네스가 죽인 것으로 오진한 적 있다).

**⚠️ 내릴 때 (가장 크게 시간을 잃는 함정)**
```bash
pkill -f "electron-forge start"; pkill -f "one-app/node_modules/electron/dist"
lsof -nP -iTCP:9333 -sTCP:LISTEN     # ← 반드시 비어 있어야 한다
```
⚠️ **단독 배포판(`standalone/lite`)이 함께 떠 있으면 패턴이 겹친다** — 경로가
`coding/one-app/standalone/lite/node_modules/...` 라서 위 패턴에 걸려 같이 죽는다. 본체만 내릴 때는
`pkill -f "coding/one-app/node_modules/electron/dist"`(중간 경로까지 포함), 단독판만 내릴 때는
`pkill -f "standalone/lite/node_modules/electron/dist"` 를 쓴다. 단독판 디버깅 포트는 9334 로 띄운다.

`electron-forge start` 만 죽이면 **Electron 자식이 고아로 살아남아 디버깅 포트를 쥐고 있다.** 그러면 새로 띄운 인스턴스가 포트를 못 잡고 `puppeteer.connect` 가 **옛 코드를 돌던 앱에 조용히 붙어**, main 수정이 반영 안 된 결과를 보고 "고쳐도 안 고쳐진다"고 오진하게 된다.
`node_modules/electron/dist` 패턴으로 죽여야 `/Applications/One App.app`(사용자 설치본)은 안 건드린다.

## 4. 이슈 감시 — 이 스킬의 본체

### A. main 프로세스
`dev.log` 에서 예외·경고를 찾는다.
```bash
grep -inE "error|exception|unhandled|rejection|EADDRINUSE|failed" <스크래치패드>/dev.log
```
- 정상 기동에도 뜨는 **무해한 노이즈**(Electron 보안 경고·DevTools Autofill 등)와 구분한다. 새로 판명된 노이즈 패턴은 이 파일 하단에 적어 다음 실행에서 오탐하지 않게 한다.

### B. 렌더러 콘솔 — `puppeteer-core` 로 붙어서 수집
```js
import puppeteer from '/Users/sbjung/coding/one-app/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9333' });
// page.on('console', …) 로 error/warning, page.on('pageerror', …) 로 미포착 예외를 모은다
```
- ⚠️ 엔트리는 `lib/puppeteer/…` 다 (`lib/esm/…` 는 **없다**). 스크래치패드에 스크립트를 두면 **절대경로 import** 로 해석 문제를 피한다.
- ⚠️ **`window.oneApp` 은 contextBridge 라 변조되지 않는다** — 대입은 예외 없이 조용히 무시된다. IPC 인자를 후킹으로 계측할 수 없으니 **간접 측정**(응답 시간·결과 차이)으로 확인한다.

### C. 화면 스모크 — **작업한 섹션 + 영향 가는 섹션만** 연다
⚠️ **12개 섹션 전체 순회는 기본이 아니다** — 너무 오래 걸린다(2026-09-30 사용자 지적). 인자로 받은 대상 섹션과,
그 변경이 닿는 곳(공용 컴포넌트·셸·토큰을 바꿨다면 그 부품을 쓰는 대표 화면 몇 개)만 연다.
전체 순회는 인자가 **"전체 스모크"** 를 명시했을 때만 한다.
전체가 필요할 때는 **이 스킬 폴더의 `smoke.mjs` 를 그대로 쓴다**(위 B 의 수집까지 포함되어 있다 — 실측 검증됨).
```bash
node .claude/skills/test/smoke.mjs <스크래치패드>/shot.png
```
- 사이드바 항목(`.sidebar__nav .sidebar__item`)을 순회 클릭하고, **`.err-box` 가 뜬 섹션 = ErrorBoundary 가 잡은 렌더 예외** → 즉시 🔴 이슈로 보고한다.
- 섹션별로 새로 뜬 콘솔 에러를 함께 세고, `.main` 레이아웃을 수치로 확인한다.
- 특정 화면을 더 깊게 봐야 하면 이 스크립트를 스크래치패드로 복사해 고쳐 쓴다(리포에는 만들지 않는다).

### D. 바뀐 기능 직접 검증 (인자로 지시받았거나, UI 로 확인 가능할 때)
`window.oneApp.<기능>.<메서드>()` 를 `page.evaluate` 로 직접 불러 main 로직을 단독 검증할 수 있다.
- ⚠️ **상태를 바꾸는 호출은 전/후 값을 읽어 원복**한다(§0).
- ⚠️ 외부에 기록이 남는 호출은 사용자 확인 후에만.

### E. MO(폰) 화면 — 헤드리스 Chrome 으로 (2026-10-01 실측)
- 별도 프로필로 `--headless=new --window-size=390,844 --ignore-certificate-errors` Chrome 을 띄우고, 접속 주소는
  `window.oneApp.terminal.server.status()` 의 `urls[0]` 에서 **호스트만 `127.0.0.1:18318`(dev MO 포트)** 로 바꾼다.
- ⚠️ **내릴 때는 자기 스크래치패드 전체 경로로만** — `pkill -f "user-data-dir=<내 스크래치패드>/<프로필>"`. 병렬 세션도
  같은 스킬로 같은 이름의 프로필(`chrome-mo` 등)을 쓰고, 스크래치패드 경로 앞부분(`/private/tmp/claude-501/-Users-…`)도
  같아서 **프로필 이름이나 짧은 패턴으로 죽이면 다른 세션의 Chrome 까지 내린다**(2026-10-01 — 남은 프로세스를 `pkill -9 -f chrome-mo`
  로 지웠다가 다른 세션이 16:30 에 띄운 Chrome 을 끊었다). 내 것이 다 죽었는지는 띄운 백그라운드 작업의 종료 알림으로 판정한다.
  디버깅 포트도 9444 고정이면 세션끼리 부딪히니 비어 있는지(`lsof -iTCP:<포트> -sTCP:LISTEN`) 먼저 본다.
- `puppeteer.connect` 에 `defaultViewport: null` — 안 주면 800x600 으로 덮어써 폰 레이아웃이 아니다.
- WS 프로토콜 단정(resize·attach·chat-*)은 CDP `Network.webSocketFrameSent/Received` 로 수집한다.
- ⚠️ **claude 세션 테스트에서 `/model` 을 쓰지 말 것** — Claude Code 2.1.286 은 `/model` 선택을 "saved as your default
  for new sessions" 로 **사용자 기본 모델에 저장**한다. `settings.json` 을 원복해도 새 세션이 Haiku 로 떴다
  (로컬 파일에서 출처를 못 찾음 — 계정 쪽 저장으로 추정, 사용자가 `/model` 로 되돌려야 했다). 비용을 줄이려면
  메시지를 짧게 하고, 모델은 사용자 기본값 그대로 둔다.

## 5. 창이 가려졌을 때의 함정 — 앱 버그로 오진하기 쉽다

Electron 창이 다른 창에 가려지면 **앱은 멀쩡한데 테스트만 실패**한다.

| 증상 | 원인 | 대응 |
|------|------|------|
| `waitForSelector` 가 영영 안 풀림 | RAF 스로틀 (기본 폴링이 RAF) | 짧은 `evaluate` 를 `setTimeout` 루프로 폴링 |
| 크기 변화에 반응하는 코드만 안 돎 | `ResizeObserver` 콜백 미발화 | 창 실제 활성화 |
| xterm 등 DOM 갱신이 멈춤 | 완전히 가려지면 `document.hidden` | DOM 대신 IPC 스트림으로 단정 |

`page.bringToFront()` 로는 안 풀린다 — `osascript -e 'tell application "Electron" to activate'` 로 실제 활성화한다.
또 `evaluate(() => el.click())` 은 **click 이벤트만** 보낸다. pointerdown 기반 외부클릭 닫힘을 검증하려면 `page.mouse.click(x, y)` 좌표 클릭을 쓴다.

## 6. 정리

- [ ] 테스트로 바꾼 설정을 **원복**했는가
- [ ] **사용자의 빌드 앱이 그대로 살아 있는가** — `pgrep -f "/Applications/One App.app/Contents/MacOS"` (pkill 패턴을 잘못 쓰면 이걸 죽인다)
- [ ] 내가 만든 터미널 세션만 정리했는가 (사용자 것은 그대로 — `pkill` 로 dev 를 내려도 tmux 세션은 살아남으니 건드릴 필요 없다)
- [ ] 외부(그룹웨어 등)에 남긴 기록을 보고했는가
- [ ] 앱을 원래 상태로 되돌렸는가 (내렸으면 `npm start` 로 되살려 둔다)
- [ ] 스크래치패드의 임시 스크립트·로그는 남겨둬도 되지만 리포에는 만들지 않았는가

## 7. 보고

```
🔴 이슈 — 재현됨. 무엇이 / 어디서(파일:줄 또는 화면) / 어떻게 재현하는지
🟡 의심 — 로그에 보이지만 원인 미확정. 무해한 노이즈일 가능성 명시
✅ 확인됨 — 실제로 돌려서 정상임을 본 것 (대상 섹션 렌더·해당 기능 동작 등)
```
- **테스트하지 못한 것을 분명히 적는다** — 외부 기록이 남아 건너뛴 기능, 창이 가려져 확인 못 한 것 등. 안 본 것을 본 것처럼 쓰지 않는다.
- 새로 알아낸 함정은 `.claude/rules/` 의 해당 파일에 기록할지 제안한다.

## 8. 수정

- 기본: 보고 뒤 `AskUserQuestion` 으로 고칠지 묻는다.
- `--fix`: 다시 묻지 않고 🔴 부터 고친 뒤 **같은 확인을 다시 돌려** 사라졌는지 본다(렌더러는 HMR 로 즉시 반영, main/preload 는 재시작 — 재시작은 §2 규칙대로).
- **커밋하지 않는다.** 커밋은 `/commit` 으로 지시받았을 때만.

---
## 무해한 노이즈 — 실측 기준선 (2026-09-01)

정상 기동·정상 종료에서 나오는 것들이다. **이것들은 이슈가 아니다.** 새로 판명될 때마다 추가한다.

### 기동 시 `dev.log`
```
Port 5173 is in use, trying another one...     ← 3줄. Vite 엔트리가 renderer·mobile·mobile_app
Port 5174 is in use, trying another one...        3개라 한 프로세스가 5173·5174·5175 를 차례로 잡는다
DevTools listening on ws://127.0.0.1:9333/...  ← --remote-debugging-port 를 준 결과
```
(메뉴바 트레이 아이콘은 제거됐다 — 예전 `[tray] …` 줄은 더 이상 나오지 않는다)
✅ **정상 기동 구간에는 `error|exception|unhandled|rejection|EADDRINUSE|failed` grep 이 0건이다.** 즉 기동 로그에서 뭔가 걸리면 진짜 이슈일 가능성이 높다.

### 렌더러 콘솔 (정상값)
| 종류 | 내용 |
|------|------|
| debug | `[vite] connecting...` · `[vite] connected.` |
| info | `Download the React DevTools for a better development experience…` |
| **error·pageerror** | **0건이 정상** |

### 종료 시에만 (`pkill` 직후) — ⚠️ grep 전에 이 구간을 배제할 것
```
GPU process exited unexpectedly: exit_code=15          ← 15 = SIGTERM, 내가 죽인 결과
Network service crashed or was terminated, restarting
Error sending from webFrameMain: Render frame was disposed before WebFrameMain could be accessed
    at broadcast (.vite/build/main.js:…)  ← 스택에 broadcast·node-pty flush 가 찍힌다
```
`electron-forge start` 를 먼저 죽이면 Vite 서버가 사라져 렌더러 재로드가 실패한 줄도 함께 찍힌다(2026-09-17 실측) —
```
[main] 렌더러 종료: killed 15
(node:<pid>) electron: Failed to load URL: http://localhost:5173/ with error: ERR_CONNECTION_REFUSED
```
Electron 본체는 SIGTERM 뒤 몇 초 살아 있을 수 있으니 `pkill` 뒤 3초쯤 기다렸다가 `pgrep` 으로 확인하고 남았으면 한 번 더 보낸다.

마지막 것은 **코드 결함이 아니다.** `main/lib/broadcast.ts` 는 이미 `isDestroyed()` 체크 + `try/catch` 를 하고 있는데, `webContents.send` 는 동기로 던지지 않고 **Electron 내부가 자체 `console.error` 로 찍는다** — 그래서 잡히지 않는다. 종료 중 렌더러가 먼저 죽고 pty flush 가 남아 발생한다.
> ⚠️ 단, **종료가 아닌 평상시에 이 로그가 반복되면 조사할 것** — 팝아웃 창을 닫은 뒤에도 그 창으로 계속 보내고 있다는 신호일 수 있다.

로그를 볼 때는 종료 시각 이후를 잘라내고 grep 한다(줄머리 타임스탬프 `[pid:MMDD/HHMMSS…]` 로 구분된다).

### 스크린샷 판독
⚠️ **스크린샷은 축소되어 표시된다** — 2560px 원본이 2000px 로 보이면 좌표에 1.28 을 곱해야 실제 값이다. 환산을 잊으면 **정상 레이아웃을 "오른쪽이 안 그려졌다"고 오판한다**(2026-09-01 실제로 그럴 뻔했다). 넓은 창의 오른쪽 빈 영역은 렌더 실패가 아니라 **다크 테마 배경 여백**이다.
레이아웃이 의심되면 눈이 아니라 수치로 확인한다 — `.main` 의 `getBoundingClientRect()` 가 `left + width === innerWidth` 면 정상이다.

### macOS 시스템 노이즈 (2026-09-03 추가)
```
Electron[<pid>:...] error messaging the mach port for IMKCFRunLoopWakeUpReliable
```
macOS 입력기(InputMethodKit)가 찍는 것으로 **앱 코드와 무관**하다. 창이 포커스를 주고받을 때
나오며, `error` 라는 낱말 때문에 grep 에 걸린다. 이슈로 세지 말 것.

### MO(폰) 페이지 — dev 에서만 나는 노이즈 (2026-10-01)
MO 페이지를 열 때마다(=로드 1회당) 나온다. **이번 변경과 무관한 dev 전용 노이즈**다(`mo-app` 규칙의 HMR 항목과 같은 것).
- 폰 콘솔 3건: Vite HMR 소켓이 MO 서버에서 `403` → `wss://localhost:5173` `ERR_SSL_PROTOCOL_ERROR` → `[vite] failed to connect to websocket`
- main `dev.log`: `[term:upgrade] read ECONNRESET` 한 줄 (HMR 소켓이 끊기는 것 — `server.ts` upgrade 핸들러)
- 첫 로드 때 404 1건이 Vite 의 `optimized dependencies changed. reloading` 과 같은 시각에 날 수 있다
- ⚠️ 그래서 **폰 페이지에는 HMR 이 오지 않는다** — 렌더러(`mobile-app/**`·`*.scss`)를 고친 뒤에는 폰 페이지를 **새로고침**해야 새 코드가 돈다.
  안 하면 옛 JS 로 돌아 "서버는 보냈는데 화면에 없다"로 보인다(2026-10-01 — WS 프레임엔 `chat-prompt` 가 있는데 카드가 안 그려졌다).

### 확인된 기준값
- 사이드바 섹션 **12개**: 터미널 / Jira / Nightwatch / PR / 배포 / 포트 / 프로젝트 / 딥링크 / 결재 / 일정 등록 / 주간보고 / 환경설정 (`App.tsx` 의 `SECTIONS` 가 정본 — 개수가 다르면 먼저 그걸 확인)
- 연 섹션마다 `.err-box` 0건 · 콘솔 에러 0건 이 정상 (전체 순회는 "전체 스모크" 지시가 있을 때만)
