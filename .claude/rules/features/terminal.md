---
paths:
  - "src/main/features/terminal/**"
  - "src/renderer/features/terminal/**"
  - "src/mobile/**"
  - "src/shared/terminal-protocol.ts"
---

# 터미널 + MO(모바일) 연동

`renderer/features/terminal` + `main/features/terminal` + `src/mobile`

Superset(superset.sh) 스타일 **에이전트 세션 오케스트레이터** — 좌측 세션 목록(상태 표시)에서 여러 claude 세션을 병렬로 관리하고, **자리를 비웠을 때 폰으로 같은 세션을 이어서** 쓴다. **메인 프로세스가 PTY 의 단일 소유자**(`pty.ts` — `Map<id, 세션>`)이고 데스크톱 렌더러(IPC)와 모바일 브라우저(WS)가 각자 **attach** 한다. 세션은 창·클라이언트와 무관하게 유지되고(창을 닫아도 트레이 상주), **tmux 백엔드면 앱을 재시작해도 살아남는다**(아래).

## 세션 영속화 — tmux 백엔드 (2026-08)
tmux 설치 시 node-pty 가 `$SHELL -il` 대신 **tmux 클라이언트**(`tmux -L oneapp -f userData/tmux.conf new-session -A -s oneapp-<id>`)를 spawn — 실제 셸은 tmux 서버 소유라 **앱 재시작·크래시에도 세션·에이전트가 살아있고**, 시작 시 `restoreSessions()`(`pty.ts`) 가 `list-sessions` 와 sidecar(`userData/terminal-sessions.json` — 제목·cwd·에이전트·프로젝트 메타, 평문)를 대조해 재접속 복원한다(E2E 실측: 재시작 전 심은 셸 변수가 복원 후 그대로 — 동일 프로세스). 전용 소켓(`-L oneapp`)·전용 conf(`tmux.ts` 가 시작 시 덮어쓰고 **살아있는 서버엔 `source-file` 로 재적용**: `prefix None`·`status off`·`escape-time 0`·truecolor)로 **사용자 개인 tmux 와 분리 + 완전 투명**(상태바·단축키 없음, claude 마우스 트래킹·BEL 은 기존과 동일 패스스루).

- ⚠️ conf 의 `terminal-features ",xterm-256color:RGB:sync:hyperlinks"` 는 **지우면 안 된다** — tmux 기본 features(xterm*)엔 `sync` 가 없어 claude 의 동기화 출력(DEC 2026)이 무력화되고 xterm.js 에 그리다 만 중간 프레임(반쪽 구분선 등)이 노출된다(2026-08-05 실측, hyperlinks 도 없으면 OSC 8 링크 소거).
- attach 시 같은 크기면 rows±1 SIGWINCH 토글 대신 **`refresh-client`**(tmux 가 화면 모델로 전체 재전송 — claude 이중 리플로우 없음)를 쓰고, **마지막 PTY 크기를 sidecar 에 기억**해 복원 attach 를 그 크기로 한다(80x24 왕복 리플로우 제거).
- ⚠️ **tmux 세션이 대체 화면(TUI, `alternate_on=1`)이면 attach replay 를 생략한다** — 옛 프레임을 재생하면 크기가 달랐던 시점의 글자가 우측 끝에 눌어붙고, TUI 는 자기 모델과의 diff 만 그려서 그 잔상을 영영 못 지운다(2026-08-05 실측: ◉ × 조각·잘린 에이전트 칩). 빈 xterm + tmux 전체 리드로 한 프레임이 superset 식 클린 attach 고, 일반 셸은 스크롤백 가치가 있어 replay 유지. alt 질의는 `list-panes -s -t '=이름'`(pane 타깃 명령은 `=세션명` 불가 — 실측) 경유라 `attachSession` 은 **async** 다.
- 세션 [x]=`kill-session`(onExit 흐름으로 정리+sidecar 제거), `before-quit`(`disposeAll`)은 **클라이언트만 끊는다**(detach — sidecar 유지). 외부 detach 로 클라이언트만 죽으면 `has-session` 확인 후 조용히 재attach.
- **미설치면 기존 직접 spawn 폴백**(영속 없음 — 새 세션 모달에 설치 힌트, `terminal:backend` IPC).
- ⚠️ 재시작 후 스크롤백은 현재 화면부터 시작(링버퍼는 앱 메모리라 함께 사라짐 — tmux history 시딩은 미구현).
- ⚠️ tmux 타깃은 `=이름` 정확 매칭을 쓸 것 — 단 target-session 계열(has/kill/attach)에서만 검증됨, 3.7b 에서 `send-keys` 등 pane 타깃엔 `=` 가 안 먹는 것 실측.

## 세션 오케스트레이터 (2026-08 개편)
상단 탭바 → **좌측 세션 패널**(행 = 상태점 + 제목 + `에이전트 · 상태` 서브라벨) + 우측 xterm. 새 세션은 [+] 모달에서 **위치(프로젝트 레지스트리) + 에이전트**(`agents.ts` — 셸·claude·femc·codex·gemini, `zsh -lc "whence -p"` 1회 캐시로 설치 감지 → **미설치는 선택지에서 조용히 제외**, 안내 문구 없음) 선택 → 셸 spawn 후 명령을 자동 입력(에이전트가 죽어도 셸 세션은 유지).

- 에이전트를 추가할 때는 `shared/types.ts` 의 `TerminalAgentId`·`TERMINAL_AGENT_NAMES`(3 컨텍스트 공용 표시명)와 `agents.ts` 의 `AGENTS` 두 곳만 손대면 된다.
- ⚠️ **spawn 직후 즉시 `write` 하면 zsh 초기화(ZLE)가 입력 버퍼를 비우며 명령을 버린다**(2026-08 실측) — `launchAgent()` 가 **첫 출력 후 350ms 잠잠해지면**(프롬프트 완성) 보내고 상한 3초를 둔다.
- `TerminalSessionInfo` 는 `agentId/projectId/projectName/status/createdAt` 을 포함하고, `terminal:sessions` 브로드캐스트는 **payload(전체 목록)** 를 실어 재조회가 없다.

## 데스크톱 세션 화면 구조 (2026-08-05)
`TerminalSection` 이 **세션마다 `TerminalView` 를 만들고 보이지 않는 것도 언마운트하지 않는다**(`--hidden` = `visibility:hidden` + `position:absolute; inset:0`). 예전엔 `key={activeId}` 로 xterm 을 매번 파괴해 전환마다 attach 왕복 + TUI 전체 리렌더를 다시 겪고 선택 영역·검색 상태가 사라졌다.

- ⚠️ **숨은 pane 은 PTY 크기를 주장하지 않는다**(`activeRef` 로 `onResize` 전달·`reclaimSize` 차단) — 안 막으면 안 보이는 세션들이 창 리사이즈마다 자기 크기를 밀어넣어 **폰(MO)이 보고 있는 세션 크기까지 되돌린다**(크기 공유는 마지막 주장 기준). 보이게 된 순간 `fit`+재주장+포커스를 한다.
- ⚠️ `display:none` 금지 — 크기가 0 이 되어 다시 보일 때 80x24 를 거치며 TUI 가 두 번 리플로우한다. `inset:0` 이면 숨은 pane 도 활성과 **같은 크기**라 전환 시 리사이즈가 0이다(실측: 세션 4개 전환 왕복에 PTY 301x62 불변).
- 글자 크기(`fontSize`)는 pane 이 여러 개 살아 있으므로 **TerminalSection 이 한 곳에서** 들고 내려준다(각자 들면 세션마다 어긋난다).
- 세션 행은 래퍼 `div` + `[선택 button][닫기 button]` 형제다 — 예전엔 닫기가 선택 버튼 **안**의 `span[role=button]` 이라 마크업이 유효하지 않고 키보드로 종료할 수 없었다. 활성 표시는 `aria-current`.
- 세션 이름은 행 **더블클릭 → 인라인 편집**(`terminal:rename` → sidecar 반영이라 재시작 후에도 남는다). 진입 시 `select()` 로 전체 선택하지 않으면 타이핑이 기존 이름에 덧붙는다.
- 단축키: `⌘T` 새 세션 · `⌘1..9` 전환 · `⌃Tab`/`⌃⇧Tab` 순환 · `⌘⇧W` 종료 · `⌘F` 검색. **capture 단계에서 `stopPropagation`** 으로 잡는다(bubble 로 잡으면 xterm textarea 가 먼저 처리해 같은 키가 셸에도 간다). ⚠️ `⌘W`(창 닫기)·`⌘+/-`(전체 UI 줌)는 Electron 기본 메뉴가 선점하므로 쓰지 않는다. 입력창(`INPUT`)에 포커스가 있으면 전부 넘긴다.

## xterm addon 구성 (2026-08-05)
`fit`(기존) + `unicode11` + `webgl` + `web-links` + `search`. 전부 xterm 6.0.0 과 같은 릴리스 배치이고 Vite 가 번들하므로 **devDependencies** 에 둔다(prod 의존성에 넣으면 `copyRuntimeDeps` 가 패키지에 복사한다).

- ⚠️ **`allowProposedApi: true` 없으면 앱이 죽는다** — `unicode11` 이 쓰는 `term.unicode` 가 proposed API 라 addon load 가 throw 하고, 그 예외가 effect 를 타고 올라가 **React 루트가 통째로 언마운트**된다(터미널 섹션에 들어가면 화면이 하얗게 빔 — 2026-08-05 실측).
- `webgl` 은 `term.open()` **이후에만** 붙는다. `onContextLoss` 에서 `dispose()`(공식 권장 = DOM 렌더러 폴백), 생성 실패는 try/catch 로 조용히 넘긴다. 투명 배경(`allowTransparency`)과 문제없이 공존함을 실측했다(세션 4개까지 canvas 유지, DOM 폴백 0).
- OSC 8 링크는 `linkHandler`, 평문 URL 은 `web-links` — 둘 다 `window.oneApp.openExternal` 로 보낸다(앱 창에서 열면 워크스페이스가 깨진다). ⚠️ `app:openExternal` 은 http(s) 만 허용하므로 **Finder 열기는 `terminal:reveal-cwd`**(세션 id 만 받아 main 이 cwd 를 해석 — 임의 경로 열기 방지).
- 검색 하이라이트는 `#RRGGBB` 만 받는다(알파 불가) → 액센트를 패널 배경에 **미리 합성**해 쓴다(`mixHex`). ⚠️ 비활성 22% / 활성 85% 처럼 **크게 벌려야 한다** — xterm 이 현재 일치에 선택 틴트까지 겹쳐 그려서, 비활성 색을 선택 틴트(액센트 35%)와 비슷하게 잡으면 셋이 똑같이 보여 몇 번째를 보고 있는지 알 수 없다. 밝은 경고색(노랑)을 배경으로 쓰면 그 위 밝은 글자가 안 읽힌다.
- ⚠️ **검색바는 세로 스택이 아니라 오버레이**(absolute)다 — 한 줄을 끼우면 host 높이가 줄어 **PTY 행이 바뀌고**(62→60 실측) 검색을 열고 닫을 때마다 claude 가 전체 리플로우한다.

## ⚠️ tmux 백엔드에선 xterm 스크롤백이 쌓이지 않는다 (2026-08-05 실측)
tmux 클라이언트가 화면 전체를 직접 그리므로 xterm 뷰포트에 스크롤백이 남지 않는다(`scrollHeight == clientHeight`, 슬라이더 0px). 그래서 툴바의 **[맨 아래로] 는 tmux 미설치 폴백 세션에서만 등장**하고, **화면 지우기(`term.clear()`)도 tmux 가 곧 다시 그려 영구 삭제가 아니다**. 스크롤백을 되살리려면 tmux history 시딩(`capture-pane`)이 필요하다 — 미구현.

## 상태 휴리스틱
`pty.ts` — 상수는 파일 상단, `ONEAPP_TERM_DEBUG=1` 로 전이 로그.

`busy`(출력 있음 — claude 스피너는 ~1Hz 로 계속 그리므로 작업 중엔 busy 유지) / `waiting`(에이전트 세션이 **완전 침묵 2.5초** + 입력 후 출력 ≥50B — 입력 대기, 뱃지·알림 대상) / `idle`(그 외 — **셸 세션은 waiting 없음**). bare BEL(OSC 종결자 필터 후)은 조기 판정(0.3초)+바이트 면제.

- ⚠️ **바이트 문턱을 크게(600) 잡으면 claude 래퍼의 계정 선택 프롬프트(145B) 같은 작은 입력 대기를 놓친다**(실측).
- ⚠️ **attach/resize 의 SIGWINCH redraw 를 grace 로 걸러내면 안 된다** — 터미널 섹션을 열어둔 채 세션을 만들면 즉시 attach 되어 첫 렌더가 통째로 먹히고 **영영 idle 에 갇힌다**(실측). 대신 redraw 는 busy 로 흘려보내고, **알림음 중복은 `notifiedSinceInput`(입력=턴당 알림 1회, attach/resize 시 busy 가 아니면 선소진)** 이 막는다.
- 알림은 **입력대기 수 뱃지(사이드바 액센트 + 독)** 상시 + 강도 선택(`terminal.json` `notifyLevel`: badge/sound(기본)/alert — **환경설정 → 터미널** 그룹의 Segment, 테마처럼 즉시 저장): 생성 후 20초·직전 입력 5초 내 전이는 소리 생략.

## ⚠️ 리사이즈 — SIGWINCH 폭주 주의
창 리사이즈 중 터미널이 요동치던 원인은 SIGWINCH 폭주였다 — 드래그 중 프레임마다 PTY resize 를 보내면 claude 가 매번 전체 리렌더를 한다(실측: 20회 연속 resize → **28.3KB/38 chunk** vs 마지막 1회만 → **1.5KB/2 chunk**). 그래서 `TerminalView` 는 **PTY resize IPC 를 120ms 디바운스**(마지막 값만 — last-claim-wins 유지)하고 **fit 을 rAF 로 코얼레스**한다.

더불어 세션 패널 도입으로 생긴 래퍼 `.terminal__main` 에는 **`min-width/min-height: 0` + `overflow: hidden` 이 필수** — flex 아이템의 기본 `min-*: auto` 는 콘텐츠 기반이라 xterm 이 커지면 래퍼가 늘고 host(flex:1)도 커져 fit→resize→더 큰 xterm 무한 성장 루프가 된다.

## attach 프로토콜
세션별 **링버퍼(512KB, chunk 단위)** 를 replay 로 보내 스크롤백을 복원하고, **현재 화면의 진실은 SIGWINCH redraw** 가 담당한다(크기가 다르면 resize 자체가, 같으면 `rows+1` → 40ms 후 원복 토글 → TUI 가 전체 리렌더). 출력은 **16ms 배칭** + `seq` 를 실어 보내고, 클라이언트는 `seq ≤ attach 시점 seq` 를 버려 replay 와 라이브 출력의 중복을 막는다.

## 크기 공유 — last-claim-wins
보고 있는 쪽이 주장한다 — 새로 붙은 쪽 크기로 PTY 를 맞추고 `resized` 로 전 클라이언트에 알려 `term.resize()` 로 동기화한다. 여기에 **재주장 규칙**을 더한다: 데스크톱은 **창 포커스** 시(`window 'focus'` → `fit.proposeDimensions()` 와 다르면 재주장), MO 는 **보이는 상태(`visibilityState==='visible'`)에서 `resized` 를 받았을 때** 자기 크기를 되찾는다. 없으면 폰이 줄여 둔 크기로 데스크톱에 빈 공간이 남고(반대로 데스크톱이 키우면 폰은 오른쪽이 잘려 못 읽는다).

- ⚠️ 데스크톱의 `ResizeObserver` 는 **컨테이너 크기가 실제로 바뀔 때만 fit** 해야 한다(무조건 fit 하면 xterm 내부 리렌더에 반응해 MO 가 맞춘 크기를 즉시 되돌린다 — 2026-08 실측).

## claude CLI 의 화면 모드
**claude CLI 는 대체 화면(`?1049h`) + 전체 마우스 트래킹(`?1000/1002/1003/1006h`)을 세션 내내 유지**한다(2026-08 실측). 그래서 ①터미널 스크롤백이 존재하지 않고 ②휠은 앱으로 전달돼 **claude 가 자체 스크롤**한다(자체 `Jump to bottom` 표시). 즉 터미널 쪽에서 스크롤을 흉내내면 안 되고 **휠 이벤트를 그대로 넘겨야** 한다.

## ⚠️ xterm 6 함정 3가지 (전부 2026-08 실측)
1. **네이티브 스크롤 영역이 없다** — 5.x 의 `.xterm-scroll-area` 가 사라져 `viewport.scrollTop` 조작이 안 먹는다. 스크롤백 스크롤은 `term.scrollLines(n)`·`scrollToBottom()`, 위치 판정은 `buffer.active.viewportY >= baseY`, 변화 감지는 `term.onScroll`.
2. **스크롤바도 자체 구현**(`.xterm-scrollable-element > .scrollbar > .slider`)이라 전역 `::-webkit-scrollbar` 규칙이 안 먹는다.
3. 번들 `xterm.css` 가 `.xterm .xterm-viewport` 배경을 **#000 하드코딩**해서 테마를 안 따르고, `theme.background` 를 바꿔도 생성 후엔 다시 칠하지 않는다 → 배경은 `theme.background: 'rgba(0,0,0,0)'`(`'transparent'` 는 파서가 못 읽고 검정 폴백) + `allowTransparency` 로 비우고 **패널 CSS**(`panel-dark`)에 맡긴다.

②③ 의 오버라이드는 xterm 선택자와 **동률 특정도면 나중에 주입되는 xterm.css 가 이기므로** 한 단계 더 좁게 쓴다.

## 색·글꼴
데스크톱 터미널 색은 `TerminalView.buildTheme()` 이 **다크 패널 토큰**(`--on-dark-*`·`--ok/danger/warning-on-dark`·`--accent-on-dark`)에서 읽는다 — hex 하드코딩 금지(마젠타·시안만 대응 토큰이 없어 예외). 글자는 `--font-mono`(= 번들한 **JetBrains Mono NL**, `styles.md` 참고) **13px/1.0**.

### ⚠️ `lineHeight` 는 fontSize 가 아니라 **폰트의 자연 줄높이**에 곱해진다
그래서 폰트를 바꾸면 같은 `lineHeight` 여도 행간이 통째로 달라진다. 13px 기준 실측 자연 줄높이는 **JetBrains Mono 17.5px(1.346배)** vs **Menlo 15px(1.154배)** — 자폭(7.7 vs 7.73)은 거의 같은데 세로만 17% 크다.

- 그래서 폰트 교체와 함께 1.35 → 1.2 로 낮췄을 때 셀 종횡비가 **개선되지 않았다**(1:2.60 → 1:2.67). 사용자가 "왜 이리 길쭉하냐"고 지적해 재측정하고 1.0 으로 다시 낮췄다(2026-08-06).
- **xterm 은 `lineHeight < 1` 을 거부한다**(`_sanitizeAndValidateOption` 이 throw) — 이 폰트에서 가능한 최소가 1.0 이고 그때 셀이 **1:2.22** 다. 블록 문자 그림의 정사각 픽셀(1:2)은 이 폰트로는 도달할 수 없다(Menlo 는 1.0 에서 1:2.0).
- 실측값(fontSize 15 기준): `1.0 → 9x20px(1:2.22)` · `1.1 → 9x22(1:2.44)` · `1.2 → 9x24(1:2.67)`.
- 셀 크기를 잴 때는 `.xterm-screen` 의 `clientWidth/Height ÷ term.cols/rows` 를 쓴다(캔버스 렌더러라 DOM 행이 없다).
- 폰트 로드 완료(`document.fonts.ready`) 후 `clearTextureAtlas()` + `fit()` 를 한 번 더 돌린다 — 폴백 폰트 폭으로 셀을 재고 굳으면 커서·박스 드로잉이 어긋난다.

### ⚠️ 에이전트 실행은 `TMUX` 를 지우고 띄운다 (트루컬러)
**Claude Code 는 `TMUX` 환경변수가 있으면 트루컬러를 포기하고 256색 팔레트로 폴백한다**(2026-08-06 실측). 그래서 시작 로고가 브랜드 코랄(`#d77757`) 대신 팔레트 174번(`#d78787`)으로 나와 **분홍빛으로 보였다**.

- 실측 근거: 출력 바이트에 `38;2;…`(트루컬러) 가 **0개**이고 `38;5;174` 만 왔다. `FORCE_COLOR=3` 도, `TERM=xterm-256color` 도 소용없었고 **`TMUX` 를 지운 경우에만** 트루컬러가 나왔다(`#d77757` 12회).
- 그래서 `agents.ts` 의 `agentCommand()` 가 실행 명령을 **`env -u TMUX -u TMUX_PANE <cmd>`** 로 감싼다. 설치 감지(`detectAgents`)는 원시 `command` 를 쓰므로 영향받지 않는다.
- tmux 는 사용자에게 보이지 않는 영속화 백엔드라 에이전트가 그 안에 있음을 알 이유가 없고, 지워도 세션·pane 동작에는 영향이 없다(실측). **셸 세션(`shell`)은 감싸지 않아 `TMUX` 가 그대로 남는다.**
- 앱 렌더링(xterm)은 무관하다 — 같은 화면에서 직접 보낸 `\033[38;2;…` 코랄 블록은 정확히 코랄로 그려졌다. 색이 이상해 보이면 **먼저 출력 바이트의 SGR 유형부터 확인할 것.**

## MO 접속
툴바 폰 아이콘 → 서버 on/off + 접속 URL·QR + 토큰 재발급. 도달·암호화는 **Tailscale**(맥·폰에 설치 전제, URL 은 100.64.0.0/10 주소 우선 정렬)이 담당하고 앱은 **토큰 인증**만 한다 — `?token=` 1회 → `timingSafeEqual` 검증 → **HttpOnly 쿠키 승격**, WS(`/term`) upgrade 에서 재검증, 30초 ping 으로 죽은 소켓 회수. 토큰은 `safeStorage` 로 `userData/terminal.json`(포트 기본 18317·자동 시작 여부)에 저장하고, 켜둔 상태면 앱 재시작 시 자동으로 다시 켜진다.

### HTTPS (Tailscale 인증서)
`terminal/tls.ts` 가 `tailscale cert` 로 MagicDNS 이름(`<host>.<tailnet>.ts.net`) 인증서를 받아 `userData/mo-cert/` 에 두고, 서버는 그게 있으면 `https`, 없으면 기존 `http` 로 뜬다(폴백).

**왜 필요한가**: Chrome 은 **HTTPS 를 설치형 PWA 의 필수 조건**으로 본다(2025 년부터 서비스 워커 요구는 없어졌지만 HTTPS 는 예외 없음) — 평문 HTTP 로 '홈 화면에 추가' 하면 그냥 탭 바로가기가 되어 **주소창이 남는다**. HTTPS 면 `display: standalone` 이 실제 적용돼 주소창 없이 앱처럼 열리고, secure context 라 `navigator.clipboard` 도 정식 동작한다.

- ⚠️ 접속 URL 은 **인증서 도메인만** 준다(IP 로 접속하면 이름이 안 맞아 경고 + 설치 조건 깨짐).
- 클라이언트 WS 는 `location.protocol` 을 따라 `wss` 로 붙어야 한다(https 페이지의 `ws://` 는 mixed content 로 차단).
- 인증서는 90일이라 하루 1회 `ensureTls()` → `setSecureContext()` 로 **재시작 없이 갱신**한다.
- 전제: 사용자가 Tailscale 관리 콘솔 DNS 탭에서 **HTTPS Certificates 활성화**(안 켜져 있으면 발급 실패 → HTTP 폴백).
- ⚠️ `tailscale cert` 는 출력 경로를 안 주면 **현재 디렉터리**에 파일을 쓴다 — 항상 `--cert-file/--key-file` 을 명시할 것.

### QR 은 처음 한 번만
쿠키에 `Max-Age`(1년)를 줘 **지속 쿠키**로 만들었다(안 주면 세션 쿠키가 되어 브라우저를 닫을 때 사라지고, 그러면 매번 QR 을 다시 찍어야 한다). `SameSite=Lax` 는 북마크·QR 스캐너 같은 최상위 이동에서 쿠키가 확실히 실려 가도록 한 선택(`Strict` 는 외부 앱에서 진입할 때 빠질 수 있다). 페이지는 진입 후 `history.replaceState` 로 주소창의 토큰을 지우므로, **홈 화면에 추가**하면 토큰 없는 주소가 저장되고 인증은 쿠키가 맡는다 — 아이콘 탭 = 바로 터미널.

### 홈 화면 아이콘
`src/mobile/public/manifest.webmanifest` + `icon-192/512.png`(앱 아이콘을 `sips` 로 리사이즈): `display: standalone` 이라 주소창 없이 앱처럼 열린다.

- ⚠️ 브라우저는 manifest·아이콘을 **쿠키 없이** 받아갈 수 있어(스펙상 credentials 모드가 다름) 그 세 경로만 `PUBLIC_PATHS` 로 인증에서 제외했다 — 비밀이 없는 파일이고, 앱 화면(`/`·`mobile.ts`)은 그대로 403 이다.
- Vite `publicDir`(= `src/mobile/public`)이라 해시 없이 고정 경로로 서빙되고, `.webmanifest` MIME 은 `server.ts` 의 MIME 맵에 있다.

## MO 터미널 페이지 UI (`src/mobile`)
별도 Vite 엔트리(`mobile_window`, base `/terminal/`). 폰에서 `/` 는 **앱 셸**이고 터미널은 `/terminal/` 이다(MO 앱 셸 규칙 참고).

UI 는 세션 선택(`<option>` 은 스타일 불가라 상태를 **텍스트 글리프**로 — waiting `●`·busy `◐`·idle `○` + 에이전트명) + **새 세션 시트**(같은 바텀시트에서 ①위치(홈+프로젝트 레지스트리, WS `cwds`) → ②에이전트(WS `agents`, 설치된 것만) 2단계 — 에이전트 목록이 없으면 셸로 즉시 생성) + **글자 크기 조절(A－/A＋, `localStorage` 저장 — 기본값은 최소 6px: claude 같은 넓은 TUI 를 폰에서 통째로 보는 게 첫 화면의 목적이고, 잘려 있으면 무엇을 키울지조차 안 보인다)** + 키바(esc·tab·⇧tab·ctrl 토글·방향키·⏎ — claude CLI 용)이며 재접속은 1→2→4→5초 백오프 + `visibilitychange`(탭 슬립) 즉시 재연결 = 재attach = replay 복원.

**터치 스크롤은 직접 구현** — xterm 은 폰에서 손가락 스크롤을 지원하지 않는다. 드래그를 **합성 `WheelEvent` 로 바꿔 `.xterm-screen` 에 디스패치**하고(`#term` 은 `touch-action: none`), 처리는 xterm 에 맡긴다: 일반 화면이면 스크롤백을 스크롤하고, **마우스 트래킹을 켠 TUI(claude 등)면 xterm 이 마우스 이벤트로 인코딩해 앱에 전달**한다 — 데스크톱에서 휠을 돌린 것과 완전히 같은 경로. ⚠️ `scrollLines()` 를 직접 부르면 **claude 안에서 스크롤이 안 된다**(claude 는 대체 화면이라 스크롤백이 없음 — 2026-08 실측). 일반 화면에서 위로 올린 동안은 **[맨 아래로]** 버튼이 뜬다(대체 화면에서는 claude 자체의 `Jump to bottom` 이 담당).

### 소프트 키보드 대응 (iOS·안드로이드 공통)
Chrome 108+ 안드로이드도 iOS Safari 처럼 **visual viewport 만 줄이는 게 기본**이라 키바가 키보드에 가려질 수 있다 → ①viewport 메타에 `interactive-widget=resizes-content`(안드로이드는 레이아웃 뷰포트까지 줄어 flex 가 스스로 맞음, iOS 는 이 키를 무시) ②`visualViewport`·`innerHeight` 중 **작은 값**으로 body 높이 보정 — 둘을 함께 쓴다. pull-to-refresh(안드로이드)로 세션 화면이 리로드되지 않게 `overscroll-behavior: none` 필수. 한글은 직접 입력·**IME 조합**(Gboard) 둘 다 셸까지 전달됨을 확인(xterm 이 textarea 의 `autocapitalize/autocorrect/spellcheck` 를 이미 off 로 설정한다). CJK 가 2셀 폭으로 보이는 건 터미널 정상 동작.
