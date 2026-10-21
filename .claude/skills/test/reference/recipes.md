# /test 레시피 — 자주 쓰는 셀렉터·IPC·절차

> 매번 grep 으로 다시 찾던 것들이다(10-02~10-21 기록에서 약 18회). 화면 구조가 바뀌면 여기를 고친다.

## 셀렉터

| 대상 | 셀렉터 / 방법 |
|------|---------------|
| 사이드바 섹션 | `.sidebar__nav .sidebar__item` · 라벨 `.sidebar__item-label` · 현재 `.sidebar__item--active` |
| 숨긴 섹션 | 접힌 사이드바에선 DOM 에 **없다** → `lib.gotoSection` 이 ⌘P 팔레트로 연다 |
| 명령 팔레트 | `.palette` · 섹션 항목 `.palette__item[id^="palette-nav-"]` · 라벨 `.palette__label` |
| 렌더 예외 | `.main .err-box` (ErrorBoundary) |
| 본문 영역 | `.main` — `left + width === innerWidth` 면 레이아웃 정상 |
| 모달 | `.modal-overlay` · `.modal__title` |
| 토스트 | `.toast__title` · `.toast__msg` |
| Select | 트리거 `.picker--select .select` · 옵션 `.picker__option` — ⚠️ **onMouseDown** 이라 `el.click()` 무반응 → `lib.realClick` |

## 터미널 pane 띄우기 (순서가 틀리면 포커스·입력 검증이 전부 헛돈다)
1. 사이드바 '터미널' (`lib.gotoSection(page, '터미널')`)
2. `.terminal__ws-hit` — 워크스페이스. `aria-expanded` 확인 후 펼치기
3. `.terminal__wt-hit` — 워크트리 선택. **그 요소 `title` 첫 줄이 워크트리 절대경로**.
   리포 자체는 `one-app — local` 워크트리다(10-13·10-19 둘 다 probe 3~4회로 다시 알아냈다)
4. 세션을 **그 경로를 cwd 로** 만든다 — 탭 목록은 선택 워크트리로 걸러진다
5. 탭은 바깥 `[data-session]` 이 아니라 안쪽 `.terminal__tab-hit` 을 클릭
6. pane 입력창: `[data-pane-session="<id>"] .xterm-helper-textarea`

## 터미널 IPC (`window.oneApp.terminal.*`)
| 메서드 | 용도 |
|--------|------|
| `list()` | 세션 목록 |
| `create({ cwd, agentId, command, title })` | 세션 생성 — `command` 를 주면 그 명령으로(가짜 에이전트) |
| `kill(id)` | 세션 종료 + sidecar 항목 제거 — **테스트 세션은 반드시 이걸로 지운다** |
| `write(id, data)` · `resize(id, cols, rows)` | 입력·크기 |
| `server.status()` | MO 서버 — `urls[0]` 이 폰 접속 주소 |

## 테스트용 세션 — 진짜 claude 가 꼭 필요한가?
- 출력·대기 상태만 보면 되면 **가짜 에이전트**(`command: 'for i in 1 2 3 4 5 6 7; do echo …; sleep 1; done'`)가 빠르고 안전하다.
  입력대기(waiting) 알림을 만들려면 출력 간격 **2.5초 미만**, 생성 후 20초(grace)·입력 후 5초(게이트)를 기다린다.
- 진짜 claude 를 띄우면 **계정 선택 화면**("사용하실 Claude 계정을 선택하세요")에서 멈춘다(3회 반복) →
  `tmux -L oneapp-dev send-keys -t oneapp-<id> 1 Enter` 후 `❯` 프롬프트가 보일 때까지 폴링.
- ⚠️ tmux 대상 표기 `-t =oneapp-<id>` 는 **zsh 가 `=단어` 를 명령 경로로 확장**해 깨진다 → `=` 없이 쓰거나 `'=oneapp-<id>'` 로 따옴표.
- ⚠️ **끝나면 `terminal.kill(id)` 로 지운다.** `pkill` 로 dev 를 내려도 tmux 세션과 sidecar(`terminal-sessions-dev.json`)가
  남고, 재부팅으로 tmux 가 사라지면 다음 dev 기동 때 `resume` 이 있는 세션이 **`claude --resume` 으로 되살아난다**
  (10-19 — 10-13 에 남긴 테스트 세션 2개가 부활해 출처를 찾느라 6호출). `dev.sh status` 에 sidecar 가 보인다.
- ⚠️ 테스트 claude 에서 `/model` 금지 — 사용자 기본 모델로 저장된다(2026-10-01, Haiku 로 바뀐 사고).
- 사용자 세션과 구분: `tmux -L oneapp-dev capture-pane -p -t <이름>` 으로 내용을 보고 **내가 만든 것만** 지운다.
- ⚠️ dev tmux 서버(`oneapp-dev`)를 claude 세션 안에서 처음 띄우면 `CLAUDE_CODE_CHILD_SESSION` 등을 물려받을 수 있다 —
  `pty.ts` 의 `inheritableEnv()` 가 걸러내지만 그 전에 뜬 서버는 옛 env 를 들고 있다. `ps eww` 로는 판정 못 한다(env 가 잘린다) —
  pane 안에서 `env | grep CLAUDE` 또는 claude 기동 문구 "Transcript saving is off" 로 확인한다.

## 디버깅 포트 없이 떠 있는 dev 에 붙기 (재시작 없이)
사용자가 그냥 `npm start` 로 띄운 dev 는 9333 이 없다. 재시작을 묻기 전에 main 의 Node 인스펙터로 들어갈 수 있다.
1. `kill -USR1 <dev Electron pid>` → `curl -s http://127.0.0.1:9229/json/list` 로 열림 확인
2. 그 `webSocketDebuggerUrl` 에 `ws`(`/Users/sbjung/coding/one-app/node_modules/ws`)로 붙어 `Runtime.evaluate`:
   `(async()=>{ const {BrowserWindow}=require('electron'); const w=BrowserWindow.fromId(1); return await w.webContents.executeJavaScript(\`…\`) })()`
   (`awaitPromise:true, returnByValue:true, includeCommandLineAPI:true` — `require` 는 CommandLineAPI 로 잡힌다)
3. 콘솔 수집은 `w.webContents.on('console-message', fn)` — **끝나면 반드시** 리스너를 떼고 인스펙터를 닫는다:
   `const insp = require('inspector'); setTimeout(() => insp.close(), 100)` — ⚠️ `require` 는 **평가 중에만** 잡힌다.
   타이머 안에서 `require(...)` 를 부르면 dev main 에 `uncaughtException: require is not defined` 가 나고 9229 가 열린 채 남는다(2026-10-21).
   닫힌 것은 `lsof -nP -iTCP:9229 -sTCP:LISTEN` 이 비는 것으로 확인.
4. 숨은 창이면 `capturePage` 가 낡은 프레임을 준다 → 수치로만 판정
> ⚠️ 사용자가 쓰고 있는 창이다. 창 크기·화면을 바꿨으면 원복한다.

## MO(폰) 화면 — 헤드리스 Chrome
- 별도 프로필로 `--headless=new --window-size=390,844 --ignore-certificate-errors`. 접속 주소는
  `window.oneApp.terminal.server.status()` 의 `urls[0]` 에서 **호스트만 `127.0.0.1:18318`(dev MO 포트)** 로 바꾼다.
- ⚠️ 내릴 때는 **자기 스크래치패드 전체 경로로만** `pkill -f "user-data-dir=<내 스크래치패드>/<프로필>"` —
  병렬 세션도 같은 프로필 이름을 쓴다(10-01 다른 세션 Chrome 을 끊었다). 디버깅 포트(9444 등)도 비어 있는지 먼저 본다.
- `puppeteer.connect` 에 `defaultViewport: null`. WS 프로토콜 단정은 CDP `Network.webSocketFrameSent/Received`.
- 웹 푸시: CDP 로 준 알림 권한은 **연결을 끊으면 사라진다** — 끊지 않은 채 검증을 끝낸다
  (안 그러면 `DELIVERY_PERMISSION_DENIED`).
- ⚠️ 폰 페이지엔 HMR 이 오지 않는다 — 렌더러를 고친 뒤 **새로고침**해야 새 코드가 돈다.
- 측정 직전 dev 생존부터(`dev.sh status`) — 죽은 줄 모르고 붙으면 설치본(18317)의 옛 빌드에 붙어 오진한다.

## 창 크기 바꾸기
CDP(`Browser.getWindowForTarget`)는 Electron 이 지원하지 않는다. osascript 는 **pid 로**:
`tell application "System Events" to tell (first process whose unix id is <pid>) to set size of window 1 to {1440, 900}`
(`tell process "Electron"` 은 이름이 같은 다른 IDE 창을 잡는다). 끝나면 원래 크기로.
