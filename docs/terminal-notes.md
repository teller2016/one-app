# 터미널 + MO 연동 — 상세 노트 (경위·실측 기록)

> `.claude/rules/features/terminal.md` 의 원본 전문이다 (2026-08-13 이관).
> 규칙 파일은 불변식·함정 요약만 남기고, **왜 그렇게 됐는지**(실측 수치·시도와 폐기·사용자 지적 경위)는 여기에 남긴다.
> 새 함정을 발견하면: 규칙 파일에 한 줄 요약 + 이 파일에 상세를 쓴다.

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

### ⚠️ 자동 실행 명령은 **입력으로 주입하지 않는다** (2026-08-08)
tmux 백엔드에서는 `new-session` 의 **shell-command 인자**로 넘겨 pane 이 처음부터 그 명령으로 뜬다(`launchShellCommand()`). 예전처럼 셸을 띄운 뒤 PTY 에 `write` 하면, 그 시점이 **zsh 의 ZLE 초기화·히스토리 로드**와 **tmux 의 터미널 능력 협상**(xterm 이 되돌리는 DA 응답 `ESC[?1;2c`)에 겹쳐 **입력이 뒤섞인다** — `env` 가 `v`·`nv` 로 잘리고 뒷부분이 중복돼 `zsh: command not found: v` 가 났다(2026-08-08 실측). 같은 프리셋이 어떤 때는 되고 어떤 때는 깨지는 전형적인 경합이었고, **폰에서 특히 잦았다**(attach 가 늦게 와 협상 구간이 뒤로 밀린다).

- ⚠️ `tmux send-keys` 로 바꿔도 결국 같은 pane tty 에 쓰는 것이라 **해결되지 않는다**(실측 — 그 시도는 되돌렸으니 다시 가지 말 것).
- 생성 인자로 넘기면 주입 자체가 없어 경합이 사라진다. `-ic` 로 실행해야 rc 가 로드돼 PATH 가 잡힌다(GUI 앱이 물려주는 PATH 는 빈약하다). 명령이 끝나거나 실패해도 `exec <shell> -il` 로 셸이 남는다 — **단 그 `exec` 는 명령과 같은 셸 안에 있어야 한다**(아래 tty pgrp).
- ⚠️ **`env -u TMUX …` 는 셸 바깥에 둘 것** — `zsh -ic 'env -u TMUX … <명령>'` 처럼 안에 넣으면 **pane 이 즉시 종료된다**(실측 t5). 바깥(`env -u TMUX … zsh -ic '<명령>'`)이면 정상이다. 원인은 규명하지 못했다.
- 그래서 `agents.ts` 의 `agentCommand()` 는 **원시 명령**을 반환하고, TMUX 제거 래핑은 `pty.ts` 가 위치를 정해 붙인다.
- **tmux 미설치 폴백 세션만** 예전 방식(`launchAgent` → PTY write)을 쓴다 — 거기엔 다른 경로가 없다. ⚠️ spawn 직후 즉시 write 하면 zsh 초기화가 입력을 버리므로, **첫 출력 후 350ms 잠잠해지면** 보내고 상한 3초를 둔다.
- `ONEAPP_TERM_DEBUG=1` 로 켜지는 `[term:life]` 로그(create·launch·pty-exit·pty-exit:tmux)가 이 계열 문제의 진단 도구다.
- `TerminalSessionInfo` 는 `agentId/projectId/projectName/status/createdAt` 을 포함하고, `terminal:sessions` 브로드캐스트는 **payload(전체 목록)** 를 실어 재조회가 없다.

### ⚠️ 명령과 `exec` 는 **같은 셸 안에서** 이어야 한다 — tty pgrp (2026-08-10 실측)
`<sh> -ic '<명령>'; exec <sh> -il` 로 **셸을 두 번** 띄우면 `git pull` 처럼 **끝나는 프리셋**에서 pane 이 즉시 죽었다(`zsh: can't set tty pgrp: Input/output error` → `error on TTY read` → status 1 — 사용자 신고). 앞 셸이 인터랙티브라 job control 을 켜고 tty 소유권(foreground pgrp)을 명령의 프로세스 그룹에 넘긴 뒤 **되돌려주지 않고 죽어서**, 뒤이은 `exec <sh> -il` 이 tty 를 못 잡는다. 지금은 한 셸이 명령을 돌리고 그 자리에서 exec 한다 — `env -u TMUX -u TMUX_PANE <sh> -ic 'trap '\''true'\'' INT; <명령>; exec <sh> -il'`.

- ⚠️ **git 문제가 아니다** — `ls` 로도 100% 재현된다. `claude`·`gradlew bootRun`·`npm run dev` 는 계속 살아 있어 이 경로에 도달하지 않아 안 드러났을 뿐이고, **claude 를 Ctrl+C 로 끝냈을 때도 같은 이유로 세션이 통째로 죽고 있었다.**
- `trap 'true' INT` 는 **셸만** SIGINT 를 무시하게 한다(자식은 정상 수신 — 실행 중 Ctrl+C 로 `sleep` 이 `^C` 취소되고 셸은 남는 것 실측). 없으면 명령 실행 중 Ctrl+C 가 셸까지 끊어 `exec` 에 도달하지 못한다. ⚠️ `trap '' INT`(무시)는 **자식이 상속**하므로 쓰면 안 된다.
- 부수 효과로 명령 뒤에 남는 셸도 `TMUX` 가 지워진 상태를 물려받는다(`env` 가 바깥에 있으므로).
- 진단 재현법: `tmux -L ptest -f <userData>/tmux.conf new-session -d -s t -c <경로> "<pane 명령>"` + `set -g remain-on-exit on` 후 `capture-pane -p` — 죽은 pane 의 마지막 출력과 종료 코드를 그대로 볼 수 있다.

## 데스크톱 세션 화면 구조 (2026-08-05, pane 상한은 2026-08-09)
`TerminalSection` 이 **본 적 있는 세션마다 `TerminalView` 를 만들고 보이지 않게 돼도 언마운트하지 않는다**(`--hidden` = `visibility:hidden` + `position:absolute; inset:0`). 예전엔 `key={activeId}` 로 xterm 을 매번 파괴해 전환마다 attach 왕복 + TUI 전체 리렌더를 다시 겪고 선택 영역·검색 상태가 사라졌다.

### 섹션 자체도 keep-alive 다 — 다른 섹션으로 가도 언마운트하지 않는다 (2026-08-13)
`App.tsx` 가 터미널 섹션을 `main__keep` 래퍼(`_layout.scss` — 숨김은 `visibility` + absolute)로 **상주 마운트**한다. 섹션 이동이 재마운트(attach 왕복 + TUI 전체 리드로)를 만들지 않아 복귀가 즉시이고, 재마운트발 버그 부류(Shift+Enter alt 게이트 오판·링버퍼 DA 재응답)가 **섹션 이동 경로에서는** 사라졌다 — 앱 재시작·livePanes 축출 경로는 여전하므로 그 방어 코드는 지우면 안 된다.

- `TerminalSection` 은 `active` prop 을 받아 숨을 때: ①pane 전부를 '숨은 pane' 으로 내리고(visible/focused=false — 크기 주장 중지·⌘F 해제, 기존 게이트 재사용) ②전역 단축키(⌘T·⌘1..9·⌃Tab·⌘⇧W) 바인딩을 걷고 ③워크트리·변경사항 드로어 폴링을 멈추고(복귀 시 effect/`usePolling` 이 1회 따라잡음) ④**body 포털 모달·전체화면 오버레이를 닫고**(visibility 숨김이 portal 에는 안 미친다 — 언마운트되던 예전 동작과 동일) ⑤포커스가 섹션 안이면 blur 한다(숨은 xterm textarea 가 포커스를 쥐면 **다른 섹션의 타이핑이 PTY 로 들어간다** — JS 이동·키보드 이동(⌘[)은 포커스를 안 옮긴다).
- **숨은 동안에도 pane 은 attach 를 유지한다** — `terminal:data` 가 계속 오고 xterm 이 파싱한다(섹션 안 숨은 livePanes 와 같은 설계라 새 비용이 아니다). E2E 실측(2026-08-13): 숨은 동안 chunk 수신·PTY 182x45 불변·복귀 시 재마운트 0·복귀 즉시 재포커스.
- ⚠️ **`main__keep--hidden` 의 `height: auto` 를 지우지 말 것** — 기반 클래스의 `height:100%` 가 남으면 absolute 에서 top+height 가 `bottom:0` 을 이겨(over-constrained) 래퍼가 `.content` 아래로 탑바 높이만큼 삐져나가 **숨은 크기 ≠ 활성 크기**가 된다(E2E 실측 859→903 — 그러면 섹션 전환마다 PTY 리사이즈가 두 번 돈다).
- 터미널의 ErrorBoundary 는 key 없는 상주 경계다 — 섹션 이동으로 오류가 초기화되지 않고 폴백의 [다시 시도]가 복구를 맡는다.

### ⚠️ pane 은 **활성이 된 세션만** 만든다 — 전체 세션 동시 attach 금지 (2026-08-09)
예전엔 `sessions` **전부**를 마운트해서, 터미널 섹션에 들어가는 순간 세션 수만큼 xterm·WebGL 컨텍스트·attach(tmux 클라이언트 spawn)가 **한꺼번에** 생겼다. 지금은 `livePanes`(최근 사용 순 배열)에 든 세션만 그리고, `activeId` 가 될 때 목록 앞에 넣는다.

- **상한 `MAX_LIVE_PANES`(8)** — WebGL 컨텍스트는 **브라우저 전역 개수 제한**이 있어 무한정 쌓으면 오래된 컨텍스트가 강제 유실되며 이미 열린 터미널이 깨진다. 넘치면 가장 오래 안 본 pane 을 버리고, 다시 고르면 attach 로 복원된다(tmux 가 전체 화면을 다시 그리므로 잃는 것은 xterm 쪽 스크롤백·선택 영역뿐).
- 안 보는 세션의 출력이 IPC 로 오지 않는 것은 이미 `terminal:data` 게이트의 설계다 — 링버퍼·tmux 에 남아 재attach replay 로 복원되고, **상태(busy/waiting) 판정은 main 의 pty 가 하므로 뱃지·알림은 그대로다.**
- 실측(2026-08-09 E2E): 세션 3개 · 탭 3개에서 진입 시 pane **1개**, 탭을 옮길 때마다 2 → 3 으로 늘고 되돌아오면 3 유지(재사용).

### 분할(스플릿) 그룹 — 탭 드래그로 여러 pane 동시 표시 (2026-08-10, 그룹 모델은 같은 날 개편)
토스 트리 아티클 방식: `lib/layout.ts` 의 **이진 트리**(PanelNode/SplitNode + orientation + ratio)가 분할 하나(=그룹)의 상태이고, 렌더는 트리 순회(`computeLayout`)로 계산한 %rect 를 pane 에 인라인으로 준다 — **pane 들은 여전히 `__panes` 의 플랫 형제**다(React 재부모화 = xterm 언마운트라 트리 모양대로 중첩하면 안 된다). 드롭 판정은 X자 — 축별 정규화(`nx=(x/w)*2-1`) 후 `|nx|>|ny|`, 중앙 데드존(0.3)은 분할이 아니라 **그 pane 의 세션 교체**. 상한은 그룹당 `MAX_SPLIT_PANES(4) < MAX_LIVE_PANES(8)`.

- **화면은 activeId 의 함수다** — 포커스 세션이 그룹에 속하면 그 그룹 전체가 보이고, 어디에도 안 속하면 **혼자 전체 화면**이다. 상태는 selKey 별 **트리 배열**(`groups`)이고 워크트리 하나에 그룹이 여러 개 공존한다. ⚠️ 처음엔 "그룹 밖 탭 클릭 = 포커스 슬롯 교체"(VS Code 식)였는데 **분할을 덮어써 버려 폐기**했다(2026-08-10 사용자 지적) — 탭 클릭·⌘1..9·⌃Tab·새 세션(pending)은 전부 `selectTab` = 화면 전환뿐, 그룹을 건드리지 않는다.
- **그룹의 생성·변경은 드롭만 한다** — 단일 뷰에 드롭 = 새 그룹(활성 세션과 2분할), 그룹 뷰 가장자리 드롭 = 그 그룹에 추가(그룹당 4개 상한)/그룹 내 재배치, 중앙 드롭 = 그 pane 세션 교체(그룹 안이면 swap, 밖에서 오면 밀려난 세션은 그룹에서 나간다). 다른 그룹 소속 세션을 드롭하면 **먼저 그쪽에서 빼낸다**(`removeFromGroups` — 한 세션은 한 그룹에만). pane 1개가 남는 그룹은 해체된다.
- **그룹에서 빼기 = 멤버 탭을 탭바의 빈 영역에 드롭** — 빈 영역에서만 `--detach` 하이라이트("놓으면 그룹에서 분리" 라벨)가 켜지고, 분리된 세션이 혼자 전체 화면을 이어받는다. ⚠️ **탭(또는 그룹 장) 위에서는 dragover 에 preventDefault 를 하지 않는다**(`overTabArea` — `data-session`/`.terminal__tab-pack` 판정) — 탭 하버는 스프링 로딩(그 화면 열기)의 영역이고, 탭 위에서도 분리 하이라이트가 바 전체를 accent 로 칠하던 문제(2026-08-10 사용자 지적)와 제자리 드롭 오인을 함께 막는다.
- **드래그 중 다른 탭 위에 머물면 그 화면이 열린다(스프링 로딩, `HOVER_OPEN_MS` 180ms)** — 자기 화면의 탭을 끌면 놓을 곳이 자기뿐이라, 원하는 상대 탭을 하버로 열어 두고 아래 pane 에 놓아 분할한다(2026-08-10 사용자 요청 — 처음 구현한 '드래그 시작 시 이웃 탭 자동 전환'은 사용자가 이 방식으로 교체). 탭은 드롭 대상이 아니라 **화면만** 바꾼다(`onSelect` 경유 — 그룹 멤버면 그 그룹이 열림). ⚠️ 탭바를 벗어나면(`dragleave`) 대기 타이머를 버릴 것 — 안 버리면 pane 을 조준하는 사이 발화해 화면이 밑에서 바뀐다.
- **탭바 = 가라앉은 선반 + '장' 탭, 그룹 = 통탭(장을 세그먼트로 나눔)** — 시안 10종 비교 끝에 사용자가 ⑧을 선택(2026-08-10). **모든 탭이 같은 장 기하**(1px 테두리 + 윗라운드 + 45% `--bg` 톤, 높이 29·폭 150 고정 — 넘치면 리스트 스크롤)이고 그룹은 장이 넓어 세그먼트가 여럿일 뿐이다. 활성 표시는 그룹 안팎 동일한 **accent-soft 틴트 한 겹**(`background-image` 레이어 — 바탕색 위에 겹치기 위해). ⚠️ 활성 탭이 바닥선을 뚫고 아래 면과 이어지는 '연결형'은 상태마다 모양·높이가 갈라져 보여 폐기(스크린샷 실측) — 장들은 `tabs-list` 의 `padding-bottom: 1px` 로 바닥선 **위에** 얹힌다. 바는 `--bg-sunken` 선반이고 바닥 경계선은 border 가 아니라 **inset box-shadow** — 자식이 위에 그려져 활성 탭/활성 그룹의 `--bg` 배경이 선을 국소적으로 덮으며 아래 면(공용 바)과 이어진다. 그룹(`tab-pack`)은 항상 테두리 있는 한 장(비활성은 자기 box-shadow 로 경계선을 다시 그린다)이고, 멤버가 활성이면 장 전체가 연결되고 활성 멤버만 안에서 액센트 틴트. `tabView`(TerminalSection)가 `TabItem[]`(single | group)을 만들고 멤버는 일반 탭과 **완전히 같은 마크업**(`renderTab` 공용). ⚠️ 반려된 안들 — 세그먼트+장식(채움·연결선·라운드 끝·여백·브래킷 캡), 칩+박스 — 로 돌아가지 말 것. ⌘1..9·⌃Tab 순회는 평탄화된 **표시 순서**(`tabView.tabs`)를 따른다.
- **active 는 visible(다중)/focused(단일)로 분리됐다** — 크기 주장(`visibleRef`)·fit·전체 리드로(`refresh`)는 보이는 pane 전부(서로 **다른 세션**이라 크기 주장이 충돌하지 않는다), `term.focus()`·⌘F 는 focused(=activeId) 하나만. ⚠️ visible effect 에서 `focus()` 를 부르면 분할 드롭 순간 새 pane 이 포커스를 훔친다 — 그래서 effect 가 둘로 나뉘어 있다.
- ⚠️ **한 세션은 그룹 전체를 통틀어 1회만** — main 의 attach 추적(`desktopAttached`)이 `Set<세션id>` 라 같은 세션의 pane 이 둘이면 한쪽 detach 가 다른 쪽의 `terminal:data` 방송까지 끊는다. `moveSession`·`removeFromGroups`(선제 제거)·`replaceSession`(그룹 안이면 swap)·`sanitizeLayout`(중복 제거)이 지키고, **main 은 무변경**이다.
- **드롭 존은 드래그 중에만 pane 위에 덮는 투명 오버레이**(`terminal__drop-zone`) — xterm 의 canvas/textarea 가 dragover 를 삼키는 문제를 원천 회피한다. dragover 는 고빈도라 `setDropHint` 는 동일값 조기 반환(WorkspaceNav 와 같은 규칙).
  - ⚠️ **드래그가 어떻게 끝나든 `dragSession` 을 반드시 비울 것** — 남으면 그 오버레이(absolute·`z-index: 3`)가 pane 을 덮은 채 굳어 **휠·클릭·드래그 선택이 전부 삼켜진다.** 2026-08-11 사용자 신고("합쳤다가 다시 분리하면 스크롤이 안 먹는다")의 진짜 원인이 이것이었다 — 휠 위임 코드는 멀쩡했고, `elementFromPoint(pane 중앙)` 이 `.terminal__drop-zone` 을 반환하는 것으로 실측했다(정상이면 `xterm-link-layer`).
  - 원인은 **`dragend` 가 오지 않는 경로**다: 그룹 분리(`detachSession`)는 탭 구조를 그룹 통탭 → 단일 탭으로 재구성해 **드래그 소스 탭 노드를 언마운트**시키는데, 소스가 사라지면 브라우저는 `dragend` 를 보내지 않는다. 분할(`applyDrop`)은 스스로 상태를 비워서 멀쩡했고 **분리 경로만** 탭의 `onDragEnd` 에 기대고 있었다.
  - 그래서 ①`detachSession` 이 직접 `onDragEndSession()` 을 부르고 ②`dragSession` 이 있는 동안 **document 에 `dragend`·`drop` 리스너**를 걸어 한 번 더 거둔다. ⚠️ 안전망은 **bubble 단계**여야 한다 — capture 로 잡으면 React 의 `onDrop`(=`applyDrop`)이 값을 읽기 전에 `dragSession` 이 비어 **드롭 자체가 무효**가 된다.
- `livePanes` 는 **보는 그룹**의 세션 전부를 포함하고 LRU 축출은 화면 밖 세션만 자른다(보이는 pane 을 버리면 그 자리가 빈다).
- **그룹 뷰에서 focused 세션이 죽으면 남은 멤버가 화면을 이어받는다** — sanitize effect 가 폴백을 고르고 ⚠️ **`rememberActive` 로 먼저 기억해 둔다**: 뒤에 도는 '활성 세션 보정' effect 가 같은 flush 에서 remembered 를 읽으므로, 기억을 안 바꾸면 두 effect 가 서로 다른 setActiveId 를 쌓아 나중 것이 이긴다(경합).
- 영속화는 localStorage `terminal:layout`(selKey → **트리 배열** 맵 — 구버전 단일 트리 값도 배열로 감싸 읽는다). ⚠️ 복원 sanitize(죽은 세션 걷어내기)는 **`sessionsReady` 이후에만** — 빈 초기 목록으로 돌면 복원한 그룹을 통째로 오파기한다(선택 보정의 ready 게이트와 같은 교훈). 그립 드래그 중에는 저장 effect 를 스킵하고 pointerup 에서 1회 저장한다. 그립의 ratio 갱신은 트리 identity 가 아니라 **splitId 로 대상을 찾는다**(`findSplit` — setRatio 마다 참조가 바뀐다).
- 그룹 전환으로 숨은 pane(inset:0 = 전체 크기)이 작은 슬롯에 들어올 때의 fit 1회는 불가피한 허용 비용이다(단일 뷰 사이 전환에는 해당 없음).
- **툴바(프리셋·검색·글자크기·맨아래로·Finder)는 pane 이 아니라 탭바 아래 공용 바 하나다** — 분할하면 pane 마다 반복될 이유가 없다(2026-08-10 사용자 요청, 아래 '상단 공용 바' 절).
- ⚠️ **pane 의 경계·포커스 표시를 pane 자체의 inset box-shadow 로 그리면 안 보인다** — inset 그림자는 배경 레이어와 함께 그려져 자식(`__host` 다크 배경)이 위에 덮는다(2026-08-10 실측: 바 높이 22px 에서만 테두리가 보였다). 그래서 pane 사이 구분선은 `split-grip::after` 가 **상시**(2px `--border-dark`, hover 시 `--on-dark-3`) 그리고, focused 테두리는 `--focused::after` 오버레이(z-index + pointer-events:none)로 콘텐츠 위에 띄운다.

### ⚠️ pane·탭바·LNB 는 `memo` 다 — 넘기는 props 는 참조가 고정돼야 한다 (2026-08-09)
세션 목록 브로드캐스트는 **상태(busy↔waiting)가 바뀔 때마다** 오고, 패널 폭 드래그는 **프레임마다** 상위 상태를 바꾼다. 그때마다 살아 있는 pane 전부가 리렌더되던 것을 막았다.

- `TerminalView` 는 세션 객체가 아니라 **`sessionId`·`cwd` 원시값**을 받는다 — 객체를 그대로 받으면 브로드캐스트마다 새 객체라 memo 가 매번 깨진다. 제목·상태는 탭바가 표시하므로 pane 은 이 둘만 있으면 된다.
- 프리셋은 렌더 중에 `presetsForWorkspace` 를 부르지 말고 **`presetsByCwd` 맵(useMemo)** 에서 꺼낸다. 키는 세션 목록이 아니라 **cwd 집합을 문자열로 굳힌 값**이라, 상태만 바뀐 브로드캐스트에는 재계산되지 않는다. 프리셋이 없으면 고정 상수 `NO_PRESETS` 를 넘긴다(매번 `[]` 를 만들면 memo 가 깨진다).
- 프리셋 실행 콜백은 `(cwd, preset)` 을 받는다 — 세션마다 다른 화살표를 만들지 않으려고 위치를 인자로 올렸다.
- LNB 는 위치별 세션 수·대기 여부를 **한 번에 집계**(`byCwd`)한다 — 행마다 `sessions.filter` 를 돌면 워크트리 × 세션 이다.
- ⚠️ 워크트리 폴링(10초)은 **내용이 같으면 이전 객체를 유지**한다(`JSON.stringify` 비교) — 새 객체로 갈아끼우면 거기 매달린 파생값과 LNB 가 통째로 다시 계산된다.

- ⚠️ **숨은 pane 은 PTY 크기를 주장하지 않는다**(`activeRef` 로 `onResize` 전달·`reclaimSize` 차단) — 안 막으면 안 보이는 세션들이 창 리사이즈마다 자기 크기를 밀어넣어 **폰(MO)이 보고 있는 세션 크기까지 되돌린다**(크기 공유는 마지막 주장 기준). 보이게 된 순간 `fit`+재주장+포커스를 한다.
- ⚠️ `display:none` 금지 — 크기가 0 이 되어 다시 보일 때 80x24 를 거치며 TUI 가 두 번 리플로우한다. `inset:0` 이면 숨은 pane 도 활성과 **같은 크기**라 전환 시 리사이즈가 0이다(실측: 세션 4개 전환 왕복에 PTY 301x62 불변).
- 글자 크기(`fontSize`)는 pane 이 여러 개 살아 있으므로 **TerminalSection 이 한 곳에서** 들고 내려준다(각자 들면 세션마다 어긋난다).

### 상단 공용 바 — 툴바는 탭바 아래 하나뿐이다 (2026-08-10 개편)
예전엔 pane 마다 툴바([PresetBar][검색·글자크기·맨아래로·Finder])가 붙어 있었는데, 분할 도입으로 pane 수만큼 반복되자 **탭바 아래 공용 바 하나로 올렸다**(사용자: "다 공유해서 쓰는 거라"). `__panes` **밖**(위)의 일반 flex 행이라 모든 pane 에 균일하게 적용되고, 숨은 pane `inset:0` 크기 동등성도 그대로다 — 예전 '세션 없음' 화면의 `--empty` 오버레이 바는 이 개편으로 사라졌다(공용 바가 세션 유무와 무관하게 같은 자리).

- **프리셋 대상 위치 = 포커스 세션의 cwd, 세션이 없으면 선택된 워크트리** — `runPreset` 은 cwd 를 받으므로(첫 세션을 프리셋으로 시작하는 흐름 유지, 2026-08-08) 그대로 동작한다. 위치가 없으면 칩 `disabled`(편집 ⚙ 는 열린다). 워크스페이스 등록 전 화면에서는 바 전체를 감춘다.
- **검색 열기·맨 아래로는 pane 핸들 위임** — 터미널 인스턴스를 직접 만져야 해서 `TerminalView` 가 `onRegisterHandle(id, { openSearch, scrollToBottom })` 로 등록하고, 바는 **포커스 pane** 의 핸들만 부른다(`TerminalPaneHandle`). 검색 오버레이 자체는 여전히 pane 안에 뜬다(⌘F 도 focused pane 이 처리).
- **[맨 아래로] 노출 판정은 boolean 리프트** — pane 이 `onScrolledChange(id, bool)` 로 변화시에만 올리고(스크롤 이벤트마다 아님), 언마운트 시 false 로 정리한다. 폴백 세션은 xterm 의 `onScroll`, tmux 세션은 **휠 위임 응답(`scrolledUp`)** 이 이 값을 만든다(아래 '휠 스크롤은 tmux copy-mode 로 위임한다').
- 글자 크기(A±)·프리셋은 원래 섹션 소유 공유 상태라 이동만으로 끝났다. Finder 열기는 섹션이 `revealCwd(activeId)` 를 직접 부른다.

### 탭바 우측 액션 = `[</> IDE][± 변경사항][📱 MO]` (2026-08-12)
맨 왼쪽 `</>` 버튼이 **선택한 워크트리 폴더를 Antigravity 로 연다**(`workspaces:open-editor` → `open -a "Antigravity IDE.app" <워크트리>`). 워크트리 단위로 작업하는 화면이라 **세션 cwd 가 아니라 워크트리 루트**를 열고, 워크트리가 선택되지 않았으면(`기타 세션`) `disabled` 다.

- ⚠️ **경로는 렌더러가 넘긴 것을 그대로 쓰지 않는다** — `listWorktrees()` 결과와 대조한 뒤에만 연다(워크트리 제거와 같은 규칙). 채널은 `ipcMain.handle` 이라 MO 에도 안 열린다.
- 앱은 `/Applications`·`~/Applications` 에서 **번들을 직접 찾는다**(`workspaces:editor-info`) — 없으면 `available:false` 가 와서 버튼을 아예 그리지 않는다. 번들 안의 CLI(`Contents/Resources/app/bin/antigravity-ide`)는 사용자가 PATH 에 설치했을 때만 쓸 수 있어 기대하지 않는다.
- `shell.openPath()` 로는 못 한다 — 폴더를 **Finder** 로 여는 API 다. 그래서 `execFile('open', ['-a', …])` 를 쓴다.

### 파일 드래그 앤 드롭 = 경로 입력 (2026-08-12)
Finder 파일을 pane 에 끌어다 놓으면 **경로를 셸 입력으로** 넣는다(Terminal.app 관례). `TerminalView` 가 pane 루트에서 **capture 단계**(`onDragOverCapture`/`onDropCapture`)로 받는다 — xterm 이 이벤트를 삼키는 문제를 세션 탭 드래그는 투명 드롭 존 오버레이로 피하지만, 파일 드래그는 상시 기능이라 오버레이를 미리 깔 수 없다. 판정은 `dataTransfer.types` 의 `Files` 여부라 세션 탭 드래그(커스텀 타입)와 겹치지 않고, 숨은 pane 은 `pointer-events: none` 이라 분할 중에도 **떨어뜨린 pane 의 세션**에만 들어간다.

- **경로 획득은 preload 의 `getPathForFile`(webUtils) 경유** — 렌더러의 `File.path` 는 Electron 32 에서 제거됐고 `webUtils` 는 preload 전용이다. File 객체를 contextBridge 함수 인자로 넘기는 것이 공식 문서 패턴.
- 인용은 `shellQuotePath` — 안전 문자뿐이면 원문, 아니면 작은따옴표 + 내부 `'` 는 `'\''`(POSIX). 여러 파일은 공백 연결, 말미 공백 1개(이어서 타이핑용). 드롭한 pane 이 포커스를 가져간다.
- ⚠️ **`renderer.tsx` 의 전역 가드를 지우지 말 것** — 파일이 pane 밖에 떨어지면 Chromium 기본 동작이 창을 file:// 로 **내비게이션**시켜 앱 화면이 통째로 사라진다. window 레벨에서 Files 드래그만 `preventDefault` + `dropEffect='none'`(놓을 수 없음 커서) 처리하되, **`defaultPrevented` 인 이벤트는 건드리지 않는다** — window 는 bubble 의 마지막이라 dropEffect 를 덮어쓰면 pane 의 copy 커서가 죽는다.

### 세션 패널은 드래그 리사이즈 + 완전 축소
`.terminal__side` 폭은 `TerminalSection` 이 인라인으로 준다(SCSS 값은 첫 페인트용). 우측 `terminal__side-grip` 을 끌어 조절하고 **`SIDE_SNAP_W`(140) 아래로 끌면 축소**(48px), grip 더블클릭·Enter·Space 로도 토글한다 — 앱 사이드바(`Sidebar.tsx`)와 같은 규칙이라 그쪽을 고치면 여기도 함께 볼 것. 저장은 `localStorage`(`terminal:sideWidth`·`terminal:sideCollapsed`)에 **놓는 순간 1회**.

- ⚠️ **접힌 채로 끝나면 '펼쳤을 때 폭'을 드래그 시작 시점 값으로 되돌린다** — 안 하면 넓혀 둔 사람이 한 번 접었다 펴는 순간 최소폭(180)을 얻는다(왼쪽으로 끄는 도중 MIN_W 구간을 지나며 폭이 갱신되기 때문).
- 폭은 `Math.round` 로 저장한다 — devicePixelRatio 탓에 포인터 좌표가 소수로 와서 `334.5` 같은 값이 남는다.
- **축소 시 세션은 이름 이니셜 타일**(`terminal__session-tile`, 44px)로 표시한다 — 제목이 보통 프로젝트명이라 `one-app`→`on`, `babybonjuk store`→`ba` 로 구분된다. CJK 는 글자가 넓어 1자(`한글 세션`→`한`). 에이전트 아이콘을 쓰지 않은 이유는 **같은 CLI 세션이 여러 개면 구분이 안 되기 때문**이다.
- 전체 이름·에이전트·상태·`⌘N`·종료 단축키는 **툴팁**이 맡는다(`aria-label` 은 별도로 붙인다 — 툴팁은 시각 보조일 뿐).
- ⚠️ 축소 타일에는 **닫기(×)를 넣지 않았다** — 44px 타일 안에 22px 버튼(아이콘 버튼 하한선, `renderer-ui.md`)을 겹치면 선택 자체가 어려워진다. 종료는 `⌘⇧W` + 툴팁 안내, 이름 변경은 펼친 뒤 더블클릭.
- **헤더 액션([+]·변경사항·MO)은 축소해도 감추지 않고 세로로 쌓는다** — `renderer-ui.md` 의 "접힌 채로 아무 것도 누를 수 없게 만들지 말 것" 과 같은 방향.
- ⚠️ **접었는데 왼쪽이 비어 보이면 패널 폭이 아니라 바깥 여백을 볼 것** — 처음엔 사이드바 끝(72)부터 터미널 시작까지 111px 를 썼는데 실제 콘텐츠는 44px 타일뿐이었다(2026-08-06 사용자 지적·실측). 네 곳을 함께 줄였다: ①축소 시 `.terminal--side-collapsed` 가 `padding-left` 를 28→12→**6** ②패널 56→**48** ③**`gap` 12→8→0** ④타일 44→**34**. grip 이 flex 아이템이라 `[패널|grip|터미널]` 사이에 gap 이 **두 번** 붙어 손잡이 한 줄이 27px 를 먹고 있었다.
  - ⚠️ **패널을 40 까지 줄였더니 타일(34)이 벽에 붙어 오히려 답답했다**(2026-08-06 스크린샷 지적) → 48 로 되돌리고, 대신 그룹 구분선을 `border-top`(벽↔벽) 에서 **`::before` + 좌우 6px 인셋**으로 바꿔 선 폭을 타일에 맞췄다. 폭을 좁히는 것과 숨통을 트는 것은 다른 문제다.
  - 펼침 패널은 `border-right` + `padding-right: 6px` 로 xterm 과의 경계를 만든다(gap 이 0 이므로). **축소 모드는 `padding-right: 0`** — center 정렬 타일이 밀려 균형이 깨진다.
- ⚠️ **`gap: 0` 이라 우측 변경사항 드로어는 스스로 `margin-left: 8px` 을 갖는다** — gap 을 없앤 목적은 xterm 좌측을 세션 패널에 붙이는 것(2026-08-06 사용자 요청)이지만 gap 은 `[main|changes]` 사이에도 걸린다. 그 8px 은 `.terminal__changes-grip`(absolute, `left: -8px`)이 놓일 자리이기도 하므로 지우면 손잡이가 xterm 위로 올라탄다. 드로어는 여기에 `padding: 8px 8px 0 0` 을 더한다 — 없으면 헤더(브랜치·푸시)가 창 상단·우측 모서리에 딱 붙는다(2026-08-07 사용자 지적).
- ⚠️ **`side-grip` 의 레이아웃 실폭은 0 이어야 한다**(width 10 + `margin: 0 -5px`) — grip 은 배경이 투명이라 실폭이 남으면 **그 자리에 밝은 앱 배경이 비쳐 패널과 터미널 사이에 띠가 생긴다**(실폭 3px 이던 2026-08-07 에 사용자가 지적: `elementFromPoint` 로 x=104~115 가 전부 grip 이고 host 검정은 116 부터였다). 0 이면 host(다크)가 패널에 딱 붙고 손잡이는 경계 위에 겹쳐 뜬다 — 히트 영역(10px)은 그대로다.

- 세션 행은 래퍼 `div` + `[선택 button][닫기 button]` 형제다 — 예전엔 닫기가 선택 버튼 **안**의 `span[role=button]` 이라 마크업이 유효하지 않고 키보드로 종료할 수 없었다. 활성 표시는 `aria-current`.
- 세션 이름은 행 **더블클릭 → 인라인 편집**(`terminal:rename` → sidecar 반영이라 재시작 후에도 남는다). 진입 시 `select()` 로 전체 선택하지 않으면 타이핑이 기존 이름에 덧붙는다.
- 단축키: `⌘T` 새 세션 · `⌘1..9` 전환 · `⌃Tab`/`⌃⇧Tab` 순환 · `⌘⇧W` 종료 · `⌘F` 검색. 탭 **가운데 클릭**도 종료다(브라우저 탭 관례, `onAuxClick` — 2026-08-10). **capture 단계에서 `stopPropagation`** 으로 잡는다(bubble 로 잡으면 xterm textarea 가 먼저 처리해 같은 키가 셸에도 간다). ⚠️ `⌘W`(창 닫기)·`⌘+/-`(전체 UI 줌)는 Electron 기본 메뉴가 선점하므로 쓰지 않는다. 입력창(`INPUT`)에 포커스가 있으면 전부 넘긴다.
- **Shift+Enter = TUI 줄바꿈** (superset 동일) — `attachCustomKeyEventHandler` 가 `\x1b\r`(ESC+CR)로 바꿔 보내면 ink 기반 TUI(claude 등)가 meta+return = 줄바꿈으로 해석한다(Option+Enter 와 같은 경로). ⚠️ **대체 화면일 때만 개입** — 일반 화면(zsh)에선 ESC+CR 이 개행이 안 되고 그 줄이 그대로 실행됐다(2026-08-06 실측). 핸들러는 keydown 외 keypress·keyup 도 `false` 로 막아야 xterm 이 `\r` 를 덧보내지 않는다.
  - ⚠️ **'대체 화면' 판정은 xterm 이 `?1049h` 를 봤느냐에 달려 있다** — 그 시퀀스는 tmux 클라이언트 시작 때 **딱 한 번** 나온다(attach 캡처 실측). TUI 세션은 attach replay 를 생략하므로(잔상 방지) **재마운트된 pane(앱 재시작·livePanes 축출 복귀 — 섹션 이동은 2026-08-13 keep-alive 로 재마운트가 없어졌다)은 buffer 를 'normal' 로 오판해 게이트가 꺼지고 Shift+Enter 가 그대로 제출**됐다(2026-08-12 사용자 신고 — "다른 메뉴 갔다 오면 재현"). 지금은 `attachSession` 이 `alt`(= `isTmuxAltScreen` 결과)를 응답에 실어 주고, 데스크톱(`TerminalView`)·MO(`mobile.ts`) 가 **`?1049h` 를 합성 write** 해 모델을 실제 상태와 맞춘다. cat -v E2E 로 재마운트 후 `^[^M` 전달 확인.
  - ⚠️ **한글 조합 중(isComposing) Enter 를 xterm 에 넘기면 '조합 확정 + `\r` 전송'이 된다**(`CompositionHelper.keydown` — keyCode 13 이면 finalize 후 계속 처리) — 조합 중 Shift+Enter 로 메시지가 제출되던 두 번째 원인. 지금은 조합 중이면 `return false` 로 차단만 한다(조합 확정은 compositionend 가 처리, 줄바꿈은 다음 누름). 합성 composition E2E 로 `\r` 미전송 + 확정 글자 전달 확인(2026-08-12).
- **⌘←/⌘→ = 줄 처음/끝** (macOS 관례, 2026-08-12) — **xterm 은 meta+화살표를 아예 버린다**(`Keyboard.ts` 의 `if (ev.metaKey) break` — 시퀀스를 안 만들고 종료). 그래서 Karabiner 로 Cmd+U/O → ⌘←/→ 를 매핑해 둔 사용자 입력이 셸에 전혀 안 갔다(사용자 신고로 발견). 같은 커스텀 키 핸들러가 `Ctrl+A(\x01)`/`Ctrl+E(\x05)` 로 바꿔 PTY 에 보낸다 — zsh(emacs 모드)·claude 둘 다 표준. ⚠️ Home/End 시퀀스(`ESC[H/F`)를 쓰지 않은 이유: 맨 zsh 는 Home/End 를 안 묶는 경우가 많다. ⇧ 동반 조합(텍스트 선택)은 터미널에 대응 개념이 없어 개입하지 않는다.

## xterm addon 구성 (2026-08-05)
`fit`(기존) + `unicode11` + `webgl` + `web-links` + `search`. 전부 xterm 6.0.0 과 같은 릴리스 배치이고 Vite 가 번들하므로 **devDependencies** 에 둔다(prod 의존성에 넣으면 `copyRuntimeDeps` 가 패키지에 복사한다).

- ⚠️ **`allowProposedApi: true` 없으면 앱이 죽는다** — `unicode11` 이 쓰는 `term.unicode` 가 proposed API 라 addon load 가 throw 하고, 그 예외가 effect 를 타고 올라가 **React 루트가 통째로 언마운트**된다(터미널 섹션에 들어가면 화면이 하얗게 빔 — 2026-08-05 실측).
- `webgl` 은 `term.open()` **이후에만** 붙는다. `onContextLoss` 에서 `dispose()`(공식 권장 = DOM 렌더러 폴백), 생성 실패는 try/catch 로 조용히 넘긴다. 투명 배경(`allowTransparency`)과 문제없이 공존함을 실측했다(세션 4개까지 canvas 유지, DOM 폴백 0).
- OSC 8 링크는 `linkHandler`, 평문 URL 은 `web-links` — 둘 다 `window.oneApp.openExternal` 로 보낸다(앱 창에서 열면 워크스페이스가 깨진다). ⚠️ `app:openExternal` 은 http(s) 만 허용하므로 **Finder 열기는 `terminal:reveal-cwd`**(세션 id 만 받아 main 이 cwd 를 해석 — 임의 경로 열기 방지).
- 검색 하이라이트는 `#RRGGBB` 만 받는다(알파 불가) → 액센트를 패널 배경에 **미리 합성**해 쓴다(`mixHex`). ⚠️ 비활성 22% / 활성 85% 처럼 **크게 벌려야 한다** — xterm 이 현재 일치에 선택 틴트까지 겹쳐 그려서, 비활성 색을 선택 틴트(액센트 35%)와 비슷하게 잡으면 셋이 똑같이 보여 몇 번째를 보고 있는지 알 수 없다. 밝은 경고색(노랑)을 배경으로 쓰면 그 위 밝은 글자가 안 읽힌다.
- ⚠️ **검색바는 세로 스택이 아니라 오버레이**(absolute)다 — 한 줄을 끼우면 host 높이가 줄어 **PTY 행이 바뀌고**(62→60 실측) 검색을 열고 닫을 때마다 claude 가 전체 리플로우한다.

### ⚠️ 텍스처 아틀라스는 **pane 사이 공유물**이다 — 개별 pane 이 비우면 안 된다 (2026-08-12)
같은 폰트·크기의 xterm 들은 **하나의 `TextureAtlas` 를 나눠 쓴다**(xterm 의 `acquireTextureAtlas` 캐시). 그런데 `clearTextureAtlas()` 는 **호출한 pane 의 model 만** 비우고 전체를 다시 그릴 뿐, 같은 아틀라스를 쓰는 **다른 pane 에는 아무 통지도 하지 않는다** — addon-webgl 의 `TextureAtlas.clearTexture()` 가 페이지·캐시맵만 비우고 `_requestClearModel` 을 세우지 않기 때문이다. 그래서 pane 하나가 부르면 나머지 pane 들은 **무효가 된 옛 글리프 좌표로 계속 샘플링해 글자가 겹쳐 그려진다.**

- 증상: 탭을 옮겼다 돌아오면 화면이 겹쳐 깨져 있고 **리사이즈나 재전환으로만 복구**된다(2026-08-12 사용자 신고). **claude 의 선택지 대기처럼 출력이 완전히 멈춘 화면에서만 눈에 띈다** — 스피너가 도는 동안엔 다음 프레임이 곧바로 덮어써서 안 보일 뿐, 깨짐 자체는 늘 일어나고 있었다.
- 원인은 `TerminalView` 가 **pane 마다** `document.fonts.ready` 에서 아틀라스를 버리던 것이다. 탭을 처음 옮기면 그 세션의 pane 이 새로 마운트되므로(`livePanes`) **탭 전환 한 번마다** 보고 있던 화면이 깨졌고, 두 번째부터는 pane 이 재사용돼 멀쩡했다(사용자가 관찰한 "다시 전환하면 정상"의 정체).
- 지금은 **마운트 시점에 번들 폰트가 아직 안 왔을 때만** 버린다(`monoFontLoaded` = `document.fonts.check` 로 스택 첫 후보만 판정). 폰트가 준비된 뒤 생기는 pane 은 애초에 제 폰트로 셀을 쟀으므로 다시 구울 이유가 없다.
- ⚠️ **보이게 된 pane 에서 `clearTextureAtlas()` 를 부르지 말 것** — 2026-08-06 에 "숨어 있는 동안 아틀라스가 깨진다"며 넣었던 그 clear 는 해결이 아니라 **깨짐을 옆 pane 으로 옮기는 것**이었다(그 시절 증상의 진짜 원인도 위의 pane 별 clear 였다). 복구는 `term.refresh(0, rows-1)` 로 충분하다.
- ⚠️ **`refresh()` 는 조용히 무시될 수 있다** — `RenderService.refreshRows()` 는 `synchronizedOutput`(DEC 2026 — tmux conf 의 `sync` feature 로 켜 둔 그것)이 켜져 있는 동안엔 렌더 대신 **범위만 버퍼링**하고 돌아간다(`_isPaused` 도 같은 자리에서 걸러낸다). 출력이 멈춘 화면에는 그 버퍼를 흘려보낼 다음 프레임이 없으므로, 복귀 시 refresh 는 **rAF 로 한 번 더** 건다.

## ⚠️ tmux 백엔드에선 xterm 스크롤백이 쌓이지 않는다 (2026-08-05 실측)
tmux 클라이언트가 화면 전체를 직접 그리므로 xterm 뷰포트에 스크롤백이 남지 않는다(`scrollHeight == clientHeight`, 슬라이더 0px). **스크롤백의 주인은 tmux**(`history-limit 10000`)이고, **화면 지우기(`term.clear()`)도 tmux 가 곧 다시 그려 영구 삭제가 아니다**.

### 휠 스크롤은 tmux copy-mode 로 위임한다 (2026-08-11)
그대로 두면 xterm 이 "대체 화면 = 스크롤백 없음" 규칙으로 **휠을 ↑↓ 키로 바꿔 보내** 셸의 이전 명령이 롤링됐다(사용자 신고: "스크롤하면 화면이 아니라 이전 입력값이 롤링된다"). `TerminalView` 의 `attachCustomWheelEventHandler` 가 휠을 가로채 `terminal:scroll` 로 넘기고, `pty.scrollSession` → `tmux.tmuxScrollPane` 이 tmux 를 움직인다.

- **분기는 tmux 안에서 한다**(왕복 1회, 3단 — 2026-08-12 개정): ①**마우스 트래킹 pane**(`#{&&:#{mouse_any_flag},#{mouse_sgr_flag}}`)이면 **SGR 휠 리포트(`ESC[<64|65;1;1M`) n회 주입** — 앱이 자체 스크롤 ②**대체 화면(TUI, 마우스 없음)이면 방향키 n회**(less·vim 관례) ③**일반 화면이면 `copy-mode -e` + `scroll-up`**. `-e` 라 아래로 되돌려 바닥에 닿으면 tmux 가 알아서 나온다.
- ⚠️ **마우스 트래킹을 켠 앱(claude 등)에는 휠을 그대로 넘긴다**(`term.modes.mouseTrackingMode !== 'none'` → 핸들러가 `true` 반환) — 그 앱들이 자체 스크롤을 갖고 있다(위 'claude CLI 의 화면 모드' 절). tmux 미설치 폴백 세션도 마찬가지로 xterm 기본 동작을 쓴다(`terminal:backend` 로 판정).
- ⚠️ **위 pass-through 판정은 순간적으로 틀릴 수 있다** — claude 2.1.228 은 **리렌더마다 마우스 모드를 껐다 켜서**(attach 스트림 캡처로 `?1003l→h` 토글 버스트 실측, 2026-08-12) IPC 청크 경계에 걸리면 xterm 이 잠깐 'none' 으로 본다. 그 틈의 휠이 tmux 위임으로 넘어왔을 때 예전처럼 방향키를 보내면 **claude 가 프롬프트 히스토리(History N/N)를 롤링**하고 "Scroll wheel is sending arrow keys" 배너를 띄웠다(사용자 신고: "가끔 스크롤하면 이전 작성 내역이 나온다" — 재현이 불규칙했던 이유가 이 타이밍 의존). 그래서 ①의 SGR 주입 분기가 최우선이다 — pane 플래그는 tmux 가 아는 진실이라 흔들리지 않는다. 검증: claude 에 주입 시 History 안 뜨고 트랜스크립트만 이동(위/아래), zsh 는 copy-mode(`pane_in_mode=1`), less 는 방향키로 10줄 이동 — 셋 다 실측(2026-08-12).
- ⚠️ SGR 주입은 **1006(SGR 인코딩)을 켠 앱에만** — 1000/1002/1003 만 켠 앱은 X10 인코딩을 기대해 오파싱한다. `mouse_any_flag` 는 1000/1002/1003 의 OR 집계다(std=0·btn=0·all=1 에서 any=1 실측).
- ⚠️ **`mouse on` 으로 켜지 않은 이유** — tmux 기본 바인딩만으로 같은 분기가 되지만, 마우스 이벤트가 tmux 로 넘어가면서 **xterm 네이티브 드래그 선택·링크 클릭이 회귀**한다(⌥+드래그로만 선택 가능). 휠만 가로채면 그 셋이 그대로다.
- **스크롤 중 입력이 오면 먼저 copy-mode 를 빠져나온다**(`writeSession` → `exitCopyMode`). 해제는 tmux CLI 호출이라 비동기여서, 그동안의 입력은 `pendingInput` 에 순서대로 모아 뒀다가 한 번에 흘려보낸다 — **첫 글자를 잃지 않는다**(실측: 스크롤 상태에서 `echo TYPED-OK` 전문 입력 확인). MO 입력도 같은 함수를 지나 동일하게 동작한다.
- 휠은 고빈도라 렌더러가 **소수 누적 + 24ms flush + 왕복 중 스킵**(`wheelBusy`)으로 tmux 호출을 묶는다. pane id 는 세션에 캐시한다(pane 타깃 명령은 `=세션명` 을 못 받는다).
- **[맨 아래로] 버튼은 이제 tmux 세션에서도 뜬다** — pane 이 스크롤 응답의 `scrolledUp` 을 올리고(`onScrolledChange`), 버튼은 `scrollToBottom` 핸들에서 `terminal:scroll-bottom`(= copy-mode `cancel`)을 부른다.
- E2E 실측(2026-08-11): 휠 위로 → `scroll_position=25` + 화면이 `LINE 51~87` → `LINE 26~62` 로 올라감(스크린샷), 아래로 굴려 바닥 자동 종료, [맨 아래로] 클릭으로 원위치 복귀, `less`(alt=1·마우스 미사용)에서는 방향키가 전달돼 화면 전진. pane 조준은 `TerminalView` 가 붙이는 `data-pane-session` 으로 한다(탭의 `data-session` 과 이름을 나눈 이유는 탭바 `overTabArea` 판정과의 혼동 방지).
- 남은 것: 앱 재시작 후 스크롤백은 tmux history 에 남아 있어 **스크롤로 볼 수 있다**(xterm 링버퍼와 별개). MO(폰)의 터치 스크롤은 이 경로를 쓰지 않는다 — 기존 합성 WheelEvent 방식 그대로다.

## 상태 휴리스틱
`pty.ts` — 상수는 파일 상단, `ONEAPP_TERM_DEBUG=1` 로 전이 로그.

`busy`(출력 있음 — claude 스피너는 ~1Hz 로 계속 그리므로 작업 중엔 busy 유지) / `waiting`(에이전트 세션이 **완전 침묵 2.5초** + 입력 후 출력 ≥50B — 입력 대기, 뱃지·알림 대상) / `idle`(그 외 — **셸 세션은 waiting 없음**). bare BEL(OSC 종결자 필터 후)은 조기 판정(0.3초)+바이트 면제.

- ⚠️ **바이트 문턱을 크게(600) 잡으면 claude 래퍼의 계정 선택 프롬프트(145B) 같은 작은 입력 대기를 놓친다**(실측).
- ⚠️ **attach/resize 의 SIGWINCH redraw 를 grace 로 걸러내면 안 된다** — 터미널 섹션을 열어둔 채 세션을 만들면 즉시 attach 되어 첫 렌더가 통째로 먹히고 **영영 idle 에 갇힌다**(실측). 대신 redraw 는 busy 로 흘려보내고, **알림음 중복은 `notifiedSinceInput`(입력=턴당 알림 1회, attach/resize 시 busy 가 아니면 선소진)** 이 막는다.
- 알림은 **입력대기 수 뱃지(사이드바 액센트 + 독)** 상시 + 강도 선택(`terminal.json` `notifyLevel`: badge/sound(기본)/alert — **환경설정 → 터미널** 그룹의 Segment, 테마처럼 즉시 저장): 생성 후 20초·직전 입력 5초 내 전이는 소리 생략.

## ⚠️ 리사이즈 — SIGWINCH 폭주 주의
창 리사이즈 중 터미널이 요동치던 원인은 SIGWINCH 폭주였다 — 드래그 중 프레임마다 PTY resize 를 보내면 claude 가 매번 전체 리렌더를 한다(실측: 20회 연속 resize → **28.3KB/38 chunk** vs 마지막 1회만 → **1.5KB/2 chunk**). 그래서 `TerminalView` 는 **PTY resize IPC 를 120ms 디바운스**(마지막 값만 — last-claim-wins 유지)하고 **fit 을 rAF 로 코얼레스**한다.

더불어 세션 패널 도입으로 생긴 래퍼 `.terminal__main` 에는 **`min-width/min-height: 0` + `overflow: hidden` 이 필수** — flex 아이템의 기본 `min-*: auto` 는 콘텐츠 기반이라 xterm 이 커지면 래퍼가 늘고 host(flex:1)도 커져 fit→resize→더 큰 xterm 무한 성장 루프가 된다.

### ⚠️ 여백은 **`.xterm` 이 갖는다** — 마운트 부모에 padding 을 주면 마지막 행이 잘린다 (2026-08-12 실측)
FitAddon 은 가용 높이를 **부모의 `getComputedStyle().height`** 로 재는데, 이 앱은 전역이 `box-sizing: border-box`(`_base.scss`)라 **Chromium 이 그 값에 padding 을 포함해 돌려준다**(스펙의 content-box 가 아니다 — Firefox 와 다른 지점). 그래서 마운트 부모(`.terminal__host`)에 여백을 두면 fit 이 그만큼 더 있다고 믿고 **행·열을 하나씩 더 잡아 마지막 행이 화면 밖으로 잘렸다**(사용자 신고: "좌측 하단이 잘린다, 특히 폰트 14").

- 실측(창 1200x800·dpr 2): host 콘텐츠 **725px** 인데 fit 은 **741px**(= 725 + 상하 8px) 로 계산 → 폰트 13 은 셀 17px 에 6px 넘침(아랫부분만 깎여 눈에 덜 띔), **폰트 14 는 셀 18px 에 13px 넘쳐 글자의 72% 가 깎였다.** 좌우도 18px 과대라 열이 남았다.
- **반대로 `.xterm` 자신의 padding 은 FitAddon 이 정확히 뺀다**(`proposeDimensions` 가 element 의 4방향 padding 을 읽는다) — 그래서 여백을 그 자리로 옮겼다. `.xterm-viewport` 는 `position:absolute; inset:0` 이라 스크롤바만 여백 위에 겹치고, 글자를 그리는 `.xterm-screen` 은 여백 안쪽에 놓인다.
- MO(`src/mobile/mobile.css` 의 `#term`)도 같은 구조라 같이 옮겼다 — 폰에서도 세로 8px·가로 8px 을 과대 계산하고 있었다.
- 검증: 폰트 9~22 전 구간 + 컨테이너 높이/폭 조합 84종에서 `.xterm-screen` 이 콘텐츠 박스를 **한 번도 넘지 않음**(최대 0px). 회귀 확인은 `screen.getBoundingClientRect().bottom - (xterm.rect.bottom - paddingBottom) ≤ 0` 로 잰다.
- ⚠️ 되돌리지 말 것 — 여백을 host 로 다시 옮기면 그 순간 같은 버그가 재발한다. 여백 값을 조정할 일이 있으면 `.terminal__host .xterm` 의 padding 을 고친다.

## attach 프로토콜
세션별 **링버퍼(512KB, chunk 단위)** 를 replay 로 보내 스크롤백을 복원하고, **현재 화면의 진실은 SIGWINCH redraw** 가 담당한다(크기가 다르면 resize 자체가, 같으면 `rows+1` → 40ms 후 원복 토글 → TUI 가 전체 리렌더). 출력은 **16ms 배칭** + `seq` 를 실어 보내고, 클라이언트는 `seq ≤ attach 시점 seq` 를 버려 replay 와 라이브 출력의 중복을 막는다. replay 를 생략한 대체 화면 세션은 응답에 **`alt: true`** 가 실리고, 클라이언트(데스크톱·MO)가 `?1049h` 를 합성 write 해 xterm buffer 타입을 실제와 맞춘다(Shift+Enter 게이트·휠 방향키 변환이 이 판정을 쓴다 — 2026-08-12).

### 데스크톱 terminal:data 게이트 (2026-08-07)
`terminal:ipc.ts` 가 **pane 이 attach 한 세션 id 만** `terminal:data` 를 broadcast 한다 — `TerminalView` cleanup 이 `terminal:detach`(fire-and-forget) 를 보내고, 렌더러 리로드·창 파괴는 sender 의 `destroyed`/`did-navigate` 에서 전체 clear 로 회수한다. detach 된 세션(livePanes 축출 등)의 출력은 IPC 로 오지 않지만 **링버퍼·tmux 에 남아 재attach replay 로 복원**되므로 유실이 아니다(섹션 이동은 2026-08-13 keep-alive 부터 detach 를 만들지 않는다 — pane 이 attach 를 유지한 채 숨는다). preload 의 `onData`/`onResized` 는 **멀티플렉서**(ipcRenderer 리스너 채널당 1개 + 콜백 Set)라 pane 수만큼 리스너가 늘지 않는다 — 새 고빈도 구독 채널을 추가할 때도 `makeMux` 를 쓸 것. MO(WS)는 이 게이트와 무관하게 `server.ts` 의 `attachedId` 필터를 그대로 쓴다.

## 크기 공유 — last-claim-wins
보고 있는 쪽이 주장한다 — 새로 붙은 쪽 크기로 PTY 를 맞추고 `resized` 로 전 클라이언트에 알려 `term.resize()` 로 동기화한다. 여기에 **재주장 규칙**을 더한다: 데스크톱은 **창 포커스** 시(`window 'focus'` → `fit.proposeDimensions()` 와 다르면 재주장), MO 는 **보이는 상태(`visibilityState==='visible'`)에서 `resized` 를 받았을 때** 자기 크기를 되찾는다. 없으면 폰이 줄여 둔 크기로 데스크톱에 빈 공간이 남고(반대로 데스크톱이 키우면 폰은 오른쪽이 잘려 못 읽는다).

- ⚠️ 데스크톱의 `ResizeObserver` 는 **컨테이너 크기가 실제로 바뀔 때만 fit** 해야 한다(무조건 fit 하면 xterm 내부 리렌더에 반응해 MO 가 맞춘 크기를 즉시 되돌린다 — 2026-08 실측).

## claude CLI 의 화면 모드
**claude CLI 는 대체 화면(`?1049h`) + 전체 마우스 트래킹(`?1000/1002/1003/1006h`)을 세션 내내 유지**한다(2026-08 실측). 그래서 ①터미널 스크롤백이 존재하지 않고 ②휠은 앱으로 전달돼 **claude 가 자체 스크롤**한다(자체 `Jump to bottom` 표시). 즉 터미널 쪽에서 스크롤을 흉내내면 안 되고 **휠 이벤트를 그대로 넘겨야** 한다.

- ⚠️ "유지"는 정적이 아니다 — **리렌더마다 모드 4종을 일괄 껐다 켠다**(2.1.228, 2026-08-12 attach 캡처 실측: 유휴 2초에도 `l→h` 버스트 다수). xterm 의 `term.modes` 는 이 토글을 그대로 따라가므로 **순간적으로 'none'** 일 수 있고, 그 틈의 휠 위임은 tmux 쪽 마우스 플래그 분기가 받아낸다(위 '휠 스크롤' 절).

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
- 폰트 로드 완료(`document.fonts.ready`) 후 `fit()` 을 한 번 더 돌린다 — 폴백 폰트 폭으로 셀을 재고 굳으면 커서·박스 드로잉이 어긋난다. ⚠️ 함께 돌리던 `clearTextureAtlas()` 는 **그 pane 이 폰트보다 먼저 마운트됐을 때만** 한다(위 '텍스처 아틀라스는 pane 사이 공유물' 절 — 무조건 부르면 살아 있는 다른 pane 을 깨뜨린다).

### ⚠️ 에이전트 실행은 `TMUX` 를 지우고 띄운다 (트루컬러)
**Claude Code 는 `TMUX` 환경변수가 있으면 트루컬러를 포기하고 256색 팔레트로 폴백한다**(2026-08-06 실측). 그래서 시작 로고가 브랜드 코랄(`#d77757`) 대신 팔레트 174번(`#d78787`)으로 나와 **분홍빛으로 보였다**.

- 실측 근거: 출력 바이트에 `38;2;…`(트루컬러) 가 **0개**이고 `38;5;174` 만 왔다. `FORCE_COLOR=3` 도, `TERM=xterm-256color` 도 소용없었고 **`TMUX` 를 지운 경우에만** 트루컬러가 나왔다(`#d77757` 12회).
- 그래서 `agents.ts` 의 `agentCommand()` 가 실행 명령을 **`env -u TMUX -u TMUX_PANE <cmd>`** 로 감싼다. 설치 감지(`detectAgents`)는 원시 `command` 를 쓰므로 영향받지 않는다.
- tmux 는 사용자에게 보이지 않는 영속화 백엔드라 에이전트가 그 안에 있음을 알 이유가 없고, 지워도 세션·pane 동작에는 영향이 없다(실측). **셸 세션(`shell`)은 감싸지 않아 `TMUX` 가 그대로 남는다.**
- 앱 렌더링(xterm)은 무관하다 — 같은 화면에서 직접 보낸 `\033[38;2;…` 코랄 블록은 정확히 코랄로 그려졌다. 색이 이상해 보이면 **먼저 출력 바이트의 SGR 유형부터 확인할 것.**

## MO 접속
툴바 폰 아이콘 → 서버 on/off + 접속 URL·QR + 토큰 재발급. 도달·암호화는 **Tailscale**(맥·폰에 설치 전제, URL 은 100.64.0.0/10 주소 우선 정렬)이 담당하고 앱은 **토큰 인증**만 한다 — `?token=` 1회 → `timingSafeEqual` 검증 → **HttpOnly 쿠키 승격**, WS(`/term`) upgrade 에서 재검증, 30초 ping 으로 죽은 소켓 회수. 토큰은 `safeStorage` 로 `userData/terminal.json`(포트 기본 18317·자동 시작 여부)에 저장하고, 켜둔 상태면 앱 재시작 시 자동으로 다시 켜진다.

### ⚠️ 회사 VPN(full-tunnel)을 켜면 MO 접속이 통째로 끊긴다 (2026-08-09 실측)
증상: VPN 연결 중에는 **폰에서 맥북이 Tailscale 목록에 offline 으로만 보이고** MO 에 접속할 수 없다. Tailscale 앱에는 `Logged Out`(fetch control key … failed to resolve) → `Out Of Sync`(not-in-map-poll) → `Relay Server Unavailable`(no-derp-connection) 이 차례로 뜬다.

원인은 OpenVPN 서버가 push 하는 **`redirect-gateway`(full-tunnel)** 다. 기본 경로가 `0/1`·`128/1` 로 터널에 잡히면서 Tailscale 이 쓰는 **세 갈래가 전부 회사망을 거쳐 막힌다**:

| 삼켜지는 것 | 대역(실측) | 막혔을 때 증상 |
|---|---|---|
| 컨트롤 플레인 | `192.200.0.0/24` | `Online: False` → tailnet 에 offline 으로 광고 |
| DERP 릴레이 | `172.237.0.0/16`·`172.238.0.0/16`(Tokyo) | `no-derp-connection` → 데이터 경로 소멸 |

**⚠️ 현재 상태 = 미해결(원본 `.ovpn` 유지).** 아래는 2026-08-09 에 시도한 것과 그 결과 기록이다. 사용자 판단으로 **VPN 을 켤 땐 MO 를 포기**하고 원본 설정으로 두었다.

**시도 ①  `pull-filter ignore "redirect-gateway"`(split tunnel) → 🚫 쓰면 안 된다**
한 줄로 Tailscale 이 전부 살아나 정답처럼 보이지만, **사내 서비스는 '회사 IP 에서 나온 요청'만 허용**해서 full-tunnel 을 없애는 순간 회사 경로 접속이 통째로 끊긴다(실측 후 되돌림). 사용자가 VPN 을 켜는 목적 자체가 **출발지 IP 를 회사 것으로 만드는 것**이다.
- 판정 기준: `curl -s https://ifconfig.me` 가 **회사 IP(221.151.188.x)** 면 정상, 집 IP(222.236.x)면 full-tunnel 이 깨진 것.

**시도 ②  `net_gateway` 예외 4줄 → Tailscale·사내망은 됐지만 Claude 가 끊겼다**
```
route 168.126.63.0 255.255.255.0 net_gateway   # ❌ DNS — 이 줄이 문제였다
route 192.200.0.0 255.255.255.0 net_gateway    # 컨트롤 플레인
route 172.237.0.0 255.255.0.0 net_gateway      # DERP (Tokyo)
route 172.238.0.0 255.255.0.0 net_gateway      # DERP (Tokyo)
```
`net_gateway` 매크로 자체는 옳다(VPN 연결/해제에 맞춰 자동으로 붙었다 떨어져, 수동 `route add` 처럼 재부팅에 사라지지 않는다). 문제는 **DNS 줄**이다 — 이름 해석만 집 회선으로 빠져 경로가 어긋나면서 **Claude(`api.anthropic.com`) 연결이 끊겼다**.

**⚠️ "DNS 가 첫 관문"은 오진이었다** — 원본 설정 + VPN 켬 상태에서 `controlplane.tailscale.com` 해석은 **정상**(`192.200.0.112`)이다. 회사 DNS 는 Tailscale 을 막지 않는다. 당시 해석이 실패한 진짜 이유는 **진단 중 `tailscale down` 을 해서** 시스템 DNS 1순위(`100.100.100.100` = Tailscale)가 죽고 **자기가 죽어 자기를 못 푸는 순환**에 빠졌기 때문이다.

**다음에 시도한다면 — DNS 줄을 뺀 3줄**(미검증):
```
route 192.200.0.0 255.255.255.0 net_gateway
route 172.237.0.0 255.255.0.0 net_gateway
route 172.238.0.0 255.255.0.0 net_gateway
```
적용 후 **Claude 도달을 먼저 확인**(`curl -s -o /dev/null -w '%{http_code}' https://api.anthropic.com/` → 404 면 정상)하고, 그 다음 MO 를 본다. 또한 이 방식은 Tailscale 이 DERP IP 대역을 바꾸면 재발하므로(`no-derp-connection`), 그때는 `dig +short derp7{a..h}.tailscale.com` 으로 새 대역을 확인해 갱신해야 한다.

**회사 방화벽은 Anthropic 을 막지 않는다** — 원본 설정 + VPN 켬에서 `api.anthropic.com` 404 · `claude.ai` 403 · TCP 443 도달 확인(출발지 `221.151.188.10`).
- ⚠️ 이 방식의 약점은 **Tailscale 이 DERP 서버 IP 대역을 바꾸면 다시 끊긴다**는 것(증상: `no-derp-connection`). 그때는 `dig derp7{a..h}.tailscale.com` 으로 새 대역을 확인해 `route … net_gateway` 줄을 갱신한다.
- ⚠️ **진단 중 `tailscale down` 을 하지 말 것** — `up` 은 non-default 플래그(이 환경은 `--accept-routes`)를 전부 다시 명시해야 하고, 그 사이 DNS 가 죽어 있으면 재로그인이 **불가능해져 로그아웃 상태로 고착**된다(실측). 빠져나오려면 `tailscale up --accept-routes --accept-dns=false` 로 Tailscale 의 DNS 관리를 잠시 끄고 로그인한 뒤 되돌린다.
- ⚠️ **측정할 때마다 VPN 이 실제로 켜져 있는지 함께 확인할 것** — 중간에 VPN 이 꺼진 줄 모르고 "고쳐졌다"고 오판하기 쉽다(실측으로 한 번 겪음). 판정 기준은 `pgrep -x openvpn` + `netstat -rn | grep -E "^(0/1|128\.0/1)"`.

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

### ⚠️ 뒤로가기는 오버레이만 닫는다 (2026-08-08)
안드로이드에서 시트·전체화면이 떠 있을 때 뒤로가기를 누르면 **그 화면만 닫혀야** 한다 — 아무 처리가 없으면 페이지를 벗어나 앱 셸로 나가 버린다(사용자 지적).

오버레이를 열 때 `history.pushState({moOverlay:true})` 로 항목을 하나 쌓고, **닫기는 `closeSheet()`·`closeChanges()` 를 포함해 언제나 `history.back()` 한 경로로 모은다.** 실제로 DOM 을 숨기는 일은 `popstate` 의 `hideTopOverlay()` 에서만 한다.

- ⚠️ **UI 로 닫을 때 `back()` 을 빼먹으면 유령 항목이 쌓여** 나중에 뒤로가기를 두 번 눌러야 나가게 된다. 실측으로 열고닫기 3회에 `history.length` 증가가 0 인지 확인할 것.
- ⚠️ `back()` 은 비동기다 — 그 사이 도착한 WS 응답이 시트를 다시 그릴 수 있어 `closeSheet()` 는 `sheetMode` 를 **즉시** 비운다.
- 시트와 전체화면은 동시에 뜨지 않는다(시트가 열리면 툴바가 가려진다) — 그래서 스택이 아니라 "위에 있는 것 하나"만 닫으면 된다.

### 조작은 전부 '버튼 하나 + 바텀시트' (2026-08-08)
폰은 상시 UI 를 늘릴 폭이 없다 — 툴바는 `[≡ 작업영역][세션 select][＋][⚡ 프리셋][A－][A＋][상태]` 로 **글리프 버튼**만 두고 목록은 시트가 맡는다(375px 에서 가로 넘침 없음을 실측). 시트(`#cwdSheet`)는 하나를 `sheetMode` 로 돌려 쓴다 — 작업 영역 · 새 세션(위치→에이전트) · 프리셋.

- **작업 영역(`≡`)** = 데스크톱 LNB 의 폰 판. WS `workspaces` 로 워크스페이스▸워크트리 트리를 받아(그룹 헤더 + 들여쓴 행 + 세션 수) 고르면 `mo:scope` 에 저장하고 **세션 목록이 그 위치 것만 남는다**. 워크스페이스 헤더는 **접기/펼치기 토글**이다(`mo:wsExpanded`) — 레포가 여럿이면 워크트리까지 전부 펼쳐진 목록은 훑기 어렵다(2026-08-08 사용자 지적, 실사용 12개). 기본은 접힘이고 **지금 고른 영역의 레포는 자동으로 펼친다**. 접혀 있어도 세션 수는 헤더에 보여 어디가 살아 있는지 알 수 있다. 고른 영역에 세션이 있으면 즉시 그리로 attach 한다(영역만 바꾸고 화면이 그대로면 뭐가 달라졌는지 알 수 없다). 툴바 아래 `#scope` 줄이 현재 영역과 [전체 보기] 해제를 보여준다.
  - ⚠️ **`workspaces` 는 시트를 열 때만 요청**한다 — 워크스페이스마다 git 을 돌리므로 접속 때 미리 밀면 폰이 시트를 안 열 때 통째로 헛일이다. ±변경량도 싣지 않는다(표시할 자리도 없고 `git diff --shortstat` 이 매번 붙는다).
  - ⚠️ **보고 있는 세션이 영역 밖이면 select 에 `(다른 영역)` 으로 남긴다** — 빼버리면 select 가 엉뚱한 세션을 가리켜 손만 대도 화면이 바뀐다. 마지막 세션 이어보기(`mo:lastSession`)도 영역보다 우선한다 — 폰은 '이어서 쓰는' 화면이다.
  - 영역이 잡혀 있으면 `＋` 는 위치 단계를 건너뛰고 에이전트만 묻는다.
- **새 세션(`＋`) = 위치 → 무엇으로(셸 + 프리셋)**. 예전엔 `⚡` 프리셋 버튼이 따로 있고 `＋` 는 에이전트(셸·claude·femc)를 물었는데, **결국 같은 질문이라 하나로 합쳤다**(2026-08-08 사용자 요청). 에이전트 목록 대신 셸 + 사용자가 설정한 프리셋을 보여준다 — claude·FEMC 도 프리셋에 있어 목록이 겹치지 않고, 프리셋에 붙여 둔 옵션(`--dangerously-skip-permissions` 등)이 그대로 살아난다. WS `agents` 메시지는 이제 MO 에서 쓰지 않는다(프로토콜·서버에는 남아 있다).
  - 프리셋은 접속 시 서버가 밀어주고(파일 한 번 읽기라 가볍다) `＋` 를 누를 때 갱신한다. 스코프 필터(`presetsForWorkspace`)와 에이전트 태깅(`agentIdFromCommand`)은 **`shared/types.ts` 에 두고 데스크톱과 공유**한다 — 판정이 갈라지면 두 화면의 프리셋 목록·알림 동작이 달라진다.
  - ⚠️ 위치를 **직접 고른 경우엔 워크스페이스를 알 수 없어 전역 프리셋만** 나온다(레포 전용 프리셋을 쓰려면 `≡` 에서 작업 영역을 고른다). 사용자 프리셋은 대개 레포 스코프라 이 차이가 크게 느껴진다.
- **세션 종료(`✕`)** — 붙어 있는 세션이 있을 때만 나타나고, 되돌릴 수 없으므로 확인을 한 번 더 받는다(폰은 오터치가 잦다). 서버 `kill` 이후 목록·화면은 브로드캐스트로 알아서 따라온다.
- **변경사항(`±`)** = 데스크톱 터미널 변경사항 드로어의 폰 판. 작업 중에 앱 셸의 '변경' 탭까지 나가지 않고 터미널에서 바로 본다(2026-08-08 사용자 요청).
  - ⚠️ 데이터는 `/term` 이 아니라 **`/rpc`** 로 가져온다 — `changes` IPC 는 전 채널이 `handleShared` 라 이미 폰에 열려 있고 그 통로가 rpc 다. 프로토콜·서버를 건드리지 않아 **로직 중복이 0** 이다. `mobile-app/shim/rpc.ts` 는 순수 브라우저 WS 클라이언트라 앱 셸과 그대로 공유한다(터미널 스트림과는 별개 소켓).
  - 대상은 **지금 작업 중인 영역** — 작업 영역(`≡`)을 골라 뒀으면 그 워크트리(`workspaceId`+`worktreePath`), 아니면 보고 있는 세션(`sessionId`)이다.
  - **폴링하지 않는다** — 버튼을 누를 때만 조회한다(폰 배터리). 그래서 버튼에 변경 수 배지도 두지 않았다.
  - ⚠️ **`±` 를 누르면 바로 전체화면**(`#chgView`)이다 — 중간에 목록 시트를 거치지 않는다(처음엔 시트→전체화면 2단계로 만들었다가 사용자 지적으로 걷어냈다. "터미널에서 바로 확인"이 요구의 핵심이었다). 파일 행을 탭하면 **그 자리에서 diff 가 펼쳐져** 스크롤 한 번으로 전체를 훑는다. 파일이 하나면 처음부터 펼친다.
  - diff 는 줄바꿈 없이 가로 스크롤한다(코드는 줄이 접히면 읽기 어렵다). 파일 경로는 `direction: rtl` 로 **앞(디렉터리)을 잘라** 파일명을 남긴다(⚠️ 좌우 기호가 뒤집히지 않게 격리 문자 `U+2066/2069` 로 감쌀 것).
  - 푸시까지 가능하다(확인 다이얼로그 경유). 실패 사유는 git 출력 tail 을 그대로 보여준다. **커밋은 넣지 않았다** — 폰에서 메시지 입력은 불편하고 오터치 위험이 크다.

### 세로 공간은 터미널에 몰아준다 (2026-08-08)
실측(390×844 + iPhone safe-area): UI 크롬 **208px = 화면의 25%**, 그중 **키바가 42%(87px)** 였고 키보드가 뜨면 터미널은 62%까지 줄었다. 그래서:

- **키바는 소프트 키보드가 떠 있을 때만 펼친다**(실측 +53px = 7행). 판정은 **보이는 뷰포트 높이가 얼마나 줄었는지**로 한다 — 관측된 최대 높이(`baseViewportH`)와의 차가 `KEYBOARD_MIN_DELTA`(120px, 주소창 표시/숨김 ≈50px 과 구분되는 값)를 넘으면 키보드로 본다. 회전하면 기준 높이가 달라지므로 `orientationchange` 에서 리셋한다.
  - ⚠️ **`term.textarea` 의 focus/blur 로 판정하면 안 된다** — 안드로이드 뒤로가기·iOS 키보드 내리기로 닫으면 **포커스는 그대로라 blur 가 오지 않아 키바가 남는다**(2026-08-08 사용자 지적으로 교체). 높이는 두 OS 모두 닫힐 때 정직하게 되돌아온다.
- 키바를 접고 펼 때마다 `syncViewport()` 로 PTY 행을 맞춘다. ⚠️ 예전엔 **⌨️ 고정 토글**이 있었지만 없앴다(2026-08-08) — 키보드가 뜨면 키바도 따라 오므로 토글이 할 일이 없었고 툴바만 복잡해졌다.
- **글자 크기는 두 손가락 핀치**로 옮기고 `A－`/`A＋` 버튼을 없앴다(툴바 두 칸 회수). 시작 시점의 손가락 간격·글자 크기 기준으로 비율을 곱하며, 값을 알 방법이 없어지므로 조절 중 `#fontHud` 가 `12px`·`6px (최소)` 를 잠깐 띄운다. ⚠️ 핀치로 끝난 `touchend` 는 탭으로 처리하지 말 것 — 안 막으면 크기를 바꿀 때마다 키보드가 올라온다.
- **입력 대기 바로가기(`● N`)** — 폰은 '자리를 비웠을 때 이어받는' 화면이라 어떤 세션이 나를 기다리는지가 가장 중요한데, 예전엔 select 를 열어야 글리프(`●`)가 보였다. 대기가 있을 때만 뜨고 누를 때마다 대기 세션을 순회한다.
- **붙여넣기(📋)** 는 키바에 둔다 — 폰에서 xterm 에 텍스트를 넣을 사실상 유일한 경로다(길게 눌러도 붙여넣기 메뉴가 없다). ⚠️ `navigator.clipboard` 는 secure context 에만 있으므로 **인증서가 없어 http 로 뜬 경우 버튼을 감춘다**(나머지 9개가 그만큼 넓어진다).
- ⚠️ 텍스트 표현이 기본인 기호(`⌨` U+2328 등)를 툴바에 쓸 일이 생기면 **VS16 을 붙이고 컬러 이모지 폰트를 지정**할 것 — 안 하면 글리프가 없는 환경에서 두부(□)로 뜬다(실측).
- 툴바 버튼 순서는 **자주 쓰는 것부터 왼쪽**: `≡` · 세션 select · `＋` 새 세션 · `±` 변경사항 · `✕` 종료 · `● N` 대기. 글리프 버튼은 전부 **30×30**(`styles` 절 참고).

### ⚠️ 터미널 능력 응답(DA)이 셸 입력으로 새어 들어간다 (2026-08-08)
증상: 폰에서 세션을 열 때마다 화면에 **`^[[?1;2c^[[>0;276;0c`** 가 찍히고 그게 셸·claude 의 입력이 된다.

정체는 **xterm 이 DA 질의에 자동 응답한 것**(DA1 `ESC[?1;2c` · DA2 `ESC[>0;276;0c`)이다. attach 할 때 tmux 가 클라이언트 능력을 물어보는데, **폰은 WS 왕복이 있어 응답이 늦게 돌아오고** tmux 가 그걸 자기 질의의 답으로 못 알아봐 pane 으로 흘려보낸다.

`mobile.ts` 의 `term.onData` 에서 **`DA_REPLY_RE` 로 걸러 서버로 보내지 않는다**(응답뿐이면 아예 전송 생략).

⚠️ **데스크톱도 같은 필터가 필요하다** (2026-08-10 사용자 신고 — 처음엔 "IPC 라 왕복이 빨라 문제없다"고 봤지만 **경로가 하나 더 있었다**): 세션 시작 때 tmux 가 보낸 DA 질의 바이트가 **링버퍼에 남아**, pane 재마운트(HMR·livePanes 축출 후 복귀)의 attach replay 를 xterm 이 파싱하면서 **옛 질의에 응답을 다시 만들어 낸다**. 그 시점의 tmux 는 기다리는 질의가 없어 응답이 셸 입력으로 새고 프롬프트에 `[>0;276;0c` 가 찍힌다. `TerminalView` 의 `term.onData` 가 MO 와 같은 `DA_REPLY_RE` 로 거른다.

- 이 시퀀스는 **사용자가 키보드로 칠 수 없는 입력**이라 걸러도 잃는 것이 없다. 응답을 못 받은 tmux 는 타임아웃 후 기본값을 쓰고, 색·기능은 conf 의 `terminal-features` 가 명시한다.
- ⚠️ 키바의 `esc`(`ESC` 한 글자)·방향키(`ESC[A`)·`⇧tab`(`ESC[Z`)은 패턴에 걸리지 않는다(검증 완료).
- ⚠️ ESC 를 정규식 **리터럴**에 직접 쓰면 ESLint `no-control-regex` 에 걸린다 — `String.fromCharCode(27)` 로 조립할 것.

### ⚠️ 폰 키보드의 예측 입력은 타이핑을 삼킨다 (2026-08-08)
증상: 폰에서 글자를 쳐도 터미널에 즉시 안 나오고 **스페이스로 단어를 확정해야 한 번에** 들어간다.

원인은 xterm 의 IME 처리다 — 조합 중에는 아무것도 보내지 않고 `compositionend` 에서 한 번에 보내는데, **Gboard·삼성 키보드는 영문도 단어 단위 조합**으로 처리한다(한글은 자모 결합 때문에 이 방식이 필수라 xterm 을 탓할 수 없다).

xterm 이 `term.open()` 때 거는 `autocorrect=off`·`autocapitalize=off`·`spellcheck=false` 만으로는 부족했으므로(그 상태에서 증상 발생), `mobile.ts` 가 open 직후 **`autocomplete=off` + `autocapitalize=none` + `inputmode="url"`** 을 덧붙인다. url 모드는 예측·자동완성을 끄는 게 규격상 의도된 동작이고 `/` 가 키보드에 노출되는 부수 이득도 있다.

- 되돌리려면 그 세 줄만 지우면 된다(스페이스바가 좁아지는 게 불편할 경우).
- 실기기 확인 완료 — 영문 즉시 입력됨(2026-08-08). 그래도 키보드 구현마다 존중 여부가 다르므로, 안 되는 기기가 나오면 다음 카드는 ①하단 명령 입력줄(일반 input 에서 한 줄 작성 후 전송) ②`compositionupdate` 를 가로채 ASCII 만 즉시 전송(한글 조합이 깨질 위험 + xterm 내부 의존).

**한글은 조합을 없앨 수 없다** — 자모가 결합돼야 한 글자라, 조합 중인 것을 그대로 보내면 터미널에 `ㅎ하한` 이 남는다. 그래서 "조합 중임을 보여주는" 쪽으로 푼다: xterm 의 `.composition-view` 를 **액센트 배경 + 흰 글자 + 밑줄**로 칠하고 크기를 고정한다.

- **MO(`mobile.css`) 에만 적용한다** — 데스크톱은 글자가 크고 화면이 넓어 기본 표시로 충분하다(2026-08-08 사용자 판단). 데스크톱에도 넣었다가 되돌렸으니 다시 넣지 말 것.
- ⚠️ xterm 기본은 **검정 배경 + 흰 글자**(`xterm.css`)라 다크 패널 위에서 거의 묻힌다.
- ⚠️ **`!important` 가 필요하다** — `updateCompositionElements()` 가 갱신마다 `fontSize`·`height`·`lineHeight` 를 **인라인 스타일**로 덮어쓴다(실측). 특정도로는 이길 수 없다.
- 크기는 터미널을 따르지 않고 **15px 고정** — MO 기본 글자가 6px 라 그대로 두면 조합 중인 한글을 읽을 수 없다. 이 표시의 목적은 정렬이 아니라 무엇을 치고 있는지 보여주는 것이고, `absolute` + `nowrap` 이라 몇 칸 넘쳐도 잘리지 않는다.

### ⚠️ 터미널 폰트는 데스크톱과 같은 것을 싣는다 (2026-08-08)
예전엔 `fontFamily` 지정이 없어 기기 기본 monospace 로 그려졌고, 폰마다 자폭·자연 줄높이가 달라 박스 드로잉·커서가 어긋나 보였다. `mobile.css` 에 **JetBrains Mono NL**(Regular·Bold 두 벌, `font-display: block`)을 `@font-face` 로 싣고 `fontFamily`·`lineHeight: 1.0`(데스크톱과 동일 — 1.25 는 이 폰트의 자연 줄높이 1.346배와 곱해져 행간이 크게 벌어졌다)을 맞췄다. `document.fonts.ready` 후 `clearTextureAtlas()` + `fit()` 도 데스크톱과 같은 이유로 필수다.

- **`Unicode11Addon` + `allowProposedApi: true`** 도 함께 넣었다 — 없으면 CJK 가 한 칸으로 계산돼 TUI 표·테두리가 오른쪽으로 밀린다. ⚠️ 두 개는 한 쌍이다(옵션 없이 addon 을 로드하면 throw 하고 그 뒤 초기화가 멈춘다).
- Italic 두 벌은 싣지 않는다 — 터미널에서 드물고 파일당 ~75KB 가 폰 최초 로드에 그대로 얹힌다.

**터치 스크롤은 직접 구현** — xterm 은 폰에서 손가락 스크롤을 지원하지 않는다. 드래그를 **합성 `WheelEvent` 로 바꿔 `.xterm-screen` 에 디스패치**하고(`#term` 은 `touch-action: none`), 처리는 xterm 에 맡긴다: 일반 화면이면 스크롤백을 스크롤하고, **마우스 트래킹을 켠 TUI(claude 등)면 xterm 이 마우스 이벤트로 인코딩해 앱에 전달**한다 — 데스크톱에서 휠을 돌린 것과 완전히 같은 경로. ⚠️ `scrollLines()` 를 직접 부르면 **claude 안에서 스크롤이 안 된다**(claude 는 대체 화면이라 스크롤백이 없음 — 2026-08 실측). 일반 화면에서 위로 올린 동안은 **[맨 아래로]** 버튼이 뜬다(대체 화면에서는 claude 자체의 `Jump to bottom` 이 담당).

### 소프트 키보드 대응 (iOS·안드로이드 공통)
Chrome 108+ 안드로이드도 iOS Safari 처럼 **visual viewport 만 줄이는 게 기본**이라 키바가 키보드에 가려질 수 있다 → ①viewport 메타에 `interactive-widget=resizes-content`(안드로이드는 레이아웃 뷰포트까지 줄어 flex 가 스스로 맞음, iOS 는 이 키를 무시) ②`visualViewport`·`innerHeight` 중 **작은 값**으로 body 높이 보정 — 둘을 함께 쓴다. pull-to-refresh(안드로이드)로 세션 화면이 리로드되지 않게 `overscroll-behavior: none` 필수. 한글은 직접 입력·**IME 조합**(Gboard) 둘 다 셸까지 전달됨을 확인(xterm 이 textarea 의 `autocapitalize/autocorrect/spellcheck` 를 이미 off 로 설정한다). CJK 가 2셀 폭으로 보이는 건 터미널 정상 동작.
