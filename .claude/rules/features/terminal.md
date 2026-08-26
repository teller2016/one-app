---
paths:
  - "src/main/features/terminal/**"
  - "src/renderer/features/terminal/**"
  - "src/mobile/**"
  - "src/shared/terminal-protocol.ts"
---

# 터미널 + MO(모바일) 연동 — 핵심 규칙

`renderer/features/terminal` + `main/features/terminal` + `src/mobile`. Superset 스타일 **에이전트 세션 오케스트레이터** — 여러 claude 세션을 병렬 관리하고, 자리를 비우면 폰으로 같은 세션을 이어서 쓴다.

> **경위·실측 수치·시도와 폐기 기록은 `docs/terminal-notes.md`** (절 제목 동일). 여기는 지금도 유효한 불변식·함정만 남긴다. 새 함정 발견 시: 여기에 한 줄 요약, 상세는 노트에.

## 구조
- **main 의 `pty.ts` 가 PTY 단일 소유자**(`Map<id, 세션>`) — 데스크톱(IPC)·모바일(WS)은 각자 attach. 세션은 창과 무관하게 유지(트레이 상주), tmux 백엔드면 앱 재시작에도 살아남는다.
- tmux 는 전용 소켓(`-L oneapp`) + 전용 conf — `tmux.ts` 가 시작 시 덮어쓰고 살아있는 서버엔 `source-file` 재적용. 세션 메타는 sidecar `userData/terminal-sessions.json`(평문), 시작 시 `restoreSessions()` 가 `list-sessions` 와 대조해 복원.

## tmux 백엔드 불변식
- ⚠️ conf 의 `terminal-features ",xterm-256color:RGB:sync:hyperlinks"` **지우지 말 것** — `sync` 없으면 claude 의 동기화 출력(DEC 2026)이 무력화돼 그리다 만 중간 프레임이 노출된다.
- attach 시 같은 크기면 SIGWINCH 토글 대신 **`refresh-client`**. 마지막 PTY 크기를 sidecar 에 기억해 그 크기로 복원 attach(80x24 왕복 제거).
- ⚠️ **대체 화면(TUI) 세션은 attach replay 를 생략한다** — 옛 프레임을 재생하면 잔상이 영영 남는다. 일반 셸은 replay 유지. alt 질의(`list-panes -s`) 때문에 `attachSession` 은 **async**.
- ⚠️ tmux 타깃 `=이름` 정확 매칭은 **target-session 계열(has/kill/attach)에서만** 검증됨 — `send-keys` 등 pane 타깃엔 안 먹는다(3.7b 실측). pane id 는 세션에 캐시한다.
- 세션 [x] = `kill-session`(sidecar 제거), `before-quit` 은 **detach 만**(sidecar 유지). 외부 detach 로 클라이언트만 죽으면 `has-session` 확인 후 조용히 재attach.
- 미설치면 직접 spawn 폴백(영속 없음, 새 세션 모달에 설치 힌트, `terminal:backend` IPC).

## 자동 실행 명령 (에이전트 시작)
- ⚠️ **명령을 PTY write / `send-keys` 로 주입하지 말 것** — zsh ZLE 초기화·tmux DA 협상과 경합해 입력이 깨진다(send-keys 도 동일 — 되돌린 시도, 다시 가지 말 것). `new-session` 의 **shell-command 인자**로 넘긴다(`launchShellCommand()`).
- 형태 고정: `env -u TMUX -u TMUX_PANE <sh> -ic 'trap '\''true'\'' INT; <명령>; exec <sh> -il'`
  - ⚠️ 명령과 `exec` 는 **같은 셸 안** — 셸을 두 번 띄우면 tty pgrp 을 못 되찾아 끝나는 명령(`ls` 로도 재현)에서 pane 이 죽는다.
  - ⚠️ `env -u TMUX` 는 **셸 바깥** — 안에 넣으면 pane 즉시 종료(원인 미규명).
  - ⚠️ `trap 'true' INT`(셸만 SIGINT 무시) — `trap '' INT` 는 자식이 상속하므로 금지.
  - `-ic` 필수(rc 로드로 PATH 확보). `agents.ts` 의 `agentCommand()` 는 **원시 명령** 반환, 래핑 위치는 `pty.ts` 가 정한다.
- ⚠️ **에이전트는 `TMUX` 를 지우고 실행**(위 `env -u`) — 남기면 Claude Code 가 트루컬러를 포기하고 256색 폴백(로고가 분홍빛). 셸 세션은 감싸지 않는다. 색이 이상하면 먼저 출력 바이트의 SGR 유형(`38;2` vs `38;5`)부터 확인.
- tmux 미설치 폴백 세션만 예전 PTY write 방식 — 첫 출력 후 350ms 잠잠해지면 전송, 상한 3초.
- `TerminalSessionInfo` 는 `agentId/projectId/projectName/status/createdAt` 포함, `terminal:sessions` 브로드캐스트는 **payload(전체 목록)** 를 실어 재조회가 없다.
- ⚠️ **PTY 쓰기는 `pty.ts` 의 `ptyWrite()` 를 거칠 것**(`s.pty.write` 직접 호출 금지) — node-pty 의 write 는 동기로 던지고(죽은 세션에 남은 키·형이 어긋난 WS 프레임), main 에 uncaughtException 핸들러가 없어 그 예외 하나가 **앱 전체를 내린다**.
- 진단: `ONEAPP_TERM_DEBUG=1` → `[term:life]` 로그. 죽은 pane 재현은 전용 소켓 + `remain-on-exit on` + `capture-pane -p`.

## 데스크톱 pane 관리
- **본 적 있는 세션의 `TerminalView` 는 언마운트하지 않는다** — 숨김은 `visibility:hidden` + `position:absolute; inset:0`. ⚠️ `display:none` 금지(크기 0 → 80x24 왕복 리플로우).
- **pane 은 활성이 된 세션만 만든다** — `livePanes`(최근 사용 순) 상한 `MAX_LIVE_PANES`(8): WebGL 컨텍스트는 브라우저 전역 개수 제한이 있다. 넘치면 가장 오래 안 본 pane 축출(재선택 시 attach 복원). `livePanes` 는 보는 그룹 전체를 포함하고 LRU 축출은 화면 밖만 자른다.
- ⚠️ **숨은 pane 은 PTY 크기를 주장하지 않는다**(`activeRef` 로 `onResize`·`reclaimSize` 차단) — 안 막으면 MO 가 보는 세션 크기까지 되돌린다. 보이게 된 순간 `fit`+재주장+포커스.
- 글자 크기는 `TerminalSection` 이 한 곳에서 소유해 내려준다.
- ⚠️ **PTY resize 는 디바운스(120ms) + 마지막 전송 기준 스로틀(250ms)** 을 함께 쓴다 — 스로틀을 지우면 긴 드래그 동안 SIGWINCH 가 한 번도 안 나가고, xterm 은 이미 커진 채라 대체 화면(claude)이 빈칸으로 남아 **드래그 내내 검은 화면**이 된다(2026-08-20). 디바운스를 없애는 것도 금지 — 원래 폭주 방어다. ⚠️ 스로틀 기준을 '대기 시작'으로 바꾸면 리사이즈 **시작 직후 270ms** 공백이 되살아나고, '타이머 없으면 즉시'로 바꾸면 매-프레임 폭주가 된다(실측·경위는 노트).
- ⚠️ **`activateSession` 의 대기 플래그(`pendingRef`)는 반드시 풀린다** — '만든 세션이 목록에 나타나면 활성화' 대기인데, 그동안 **'활성 세션 보정' effect 가 통째로 멈춘다.** 목록에 끝내 안 나타나는 id(종료된 세션의 알림 [이동] 등)를 받으면 영영 남아 탭을 직접 누르기 전까지 화면이 빈 채로 굳었다. 3초 만료 타이머 + 만료 시 안내 토스트로 막는다. ⚠️ ref 만 비우면 렌더가 안 일어나 보정이 재개되지 않는다 — 해제 신호(`pendingCleared` state)를 보정 effect deps 에 함께 둘 것.

## 섹션 keep-alive (2026-08-13)
- 터미널 섹션 자체도 `App.tsx` 의 `main__keep` 래퍼로 **상주 마운트**(숨김 = `visibility` + absolute) — 섹션 이동이 재마운트(attach 왕복 + TUI 리드로)를 만들지 않는다. ⚠️ 재마운트발 버그(Shift+Enter alt 게이트 오판·링버퍼 DA 재응답)의 방어 코드는 **앱 재시작·livePanes 축출 경로에 여전히 필요** — 지우지 말 것.
- `TerminalSection` 은 `active` prop 으로 숨을 때: ①pane 전부 숨은 pane 으로(visible/focused=false — 크기 주장 중지) ②전역 단축키 해제 ③폴링 중지(복귀 시 1회 따라잡음) ④**body 포털 모달·전체화면 오버레이 닫기**(visibility 숨김은 portal 에 안 미친다) ⑤섹션 안 포커스면 blur — ⚠️ 숨은 xterm textarea 가 포커스를 쥐면 **다른 섹션의 타이핑이 PTY 로 들어간다**.
- 숨은 동안에도 pane 은 **attach 유지**(`terminal:data` 계속 수신·파싱 — 숨은 livePanes 와 같은 설계라 새 비용 아님).
- ⚠️ `main__keep--hidden` 의 `height: auto` 를 지우지 말 것 — 기반 `height:100%` 가 남으면 over-constrained 로 **숨은 크기 ≠ 활성 크기**가 되어 섹션 전환마다 PTY 리사이즈가 두 번 돈다.
- 터미널 ErrorBoundary 는 key 없는 상주 경계 — 섹션 이동으로 초기화되지 않고 폴백 [다시 시도]가 복구를 맡는다.

## 섹션 안 뒤로/앞으로 (2026-08-19)
- 세션·워크트리 전환은 `lib/useSessionHistory.ts` 가 방문 스택에 쌓고, `lib/sectionBack` 에 걸어
  **섹션 이동보다 먼저** 소비한다 — 터미널에서 ⌘[ 는 다른 메뉴가 아니라 직전에 보던 세션으로 간다.
- 항목은 `{selection, sessionId}` 쌍이다 — 세션 id 만으론 다른 워크트리 세션을 복원할 때 탭 목록에
  없어서 화면에 안 나온다. 복원은 `rememberActive` 를 **먼저** 심고 `setActiveId` — 안 그러면
  '활성 세션 보정' effect 가 그 화면의 마지막 탭으로 곧바로 덮어쓴다.
- ⚠️ **섹션을 떠나면(`active=false`) 스택을 비운다.** 안 비우면 오간 세션 수만큼 눌러야 터미널
  밖으로 나간다. 스택이 빈 방향은 **등록하지 않아야** App 의 섹션 이동으로 넘어간다.
- ⚠️ 기록은 **사용자가 고른 전환만** — 탭 클릭·⌘1~9·⌃Tab(`selectTab`) · LNB 선택(`selectWorkspaceTab`).
  자동 경로는 기록 없는 `applyTab`/`selectAndSave` 를 쓴다(새 세션 자동 활성화·죽은 세션 보정·
  Jira [작업] 진입·분할 pane 포커스 이동 — 노이즈가 되거나 화면이 안 바뀐다).

## 분할(스플릿) 그룹
- ⚠️ 아래 규칙(특히 '한 세션 = pane 하나'와 무변화 시 **원본 참조 반환**)은 `lib/layout.test.ts` 가 고정한다 — 트리 함수를 손볼 때는 `npm test` 로 확인할 것(`status.ts` 와 같은 방식).
- `lib/layout.ts` 의 **이진 트리**(PanelNode/SplitNode + ratio)가 그룹 상태. **pane 들은 `__panes` 의 플랫 형제 유지** — React 재부모화 = xterm 언마운트라 트리 모양대로 중첩 금지. 렌더는 `computeLayout` 의 %rect 인라인.
- **화면은 activeId 의 함수** — 포커스 세션이 속한 그룹 전체가 보이고, 아니면 단독 전체 화면. 탭 클릭·⌘1..9·⌃Tab·새 세션은 **화면 전환만**, 그룹 생성·변경은 **드롭만** 한다. ⚠️ '탭 클릭 = 포커스 슬롯 교체'(VS Code 식)는 분할을 덮어써 폐기 — 되돌리지 말 것.
- 드롭 판정 X자(`|nx|>|ny|`), 중앙 데드존 0.3 = 그 pane 세션 교체. 그룹당 `MAX_SPLIT_PANES`(4). 다른 그룹 세션 드롭 시 먼저 `removeFromGroups`. pane 1개 남는 그룹은 해체.
- 그룹에서 빼기 = 탭바 **빈 영역** 드롭. ⚠️ 탭·그룹 장 위에서는 dragover 에 preventDefault 하지 않는다(`overTabArea`) — 탭 하버는 스프링 로딩(180ms, ⚠️ 탭바 이탈 시 타이머 파기) 영역이다. 단 **탭 좌우 가장자리 30%(`REORDER_EDGE`)는 순서 변경 존**이라 거기서만 preventDefault 한다.
- 탭 순서 변경 = 아이템(단일 탭 · 그룹 통탭) 가장자리 드롭 — 저장은 localStorage `terminal:tabOrder`(selKey → id 배열), 정렬은 `tabSessions` 한 곳에서만(⚠️ `sessions` 는 정렬하지 않는다 — pane DOM 순서가 흔들린다). 이동 단위는 **아이템 블록**이라 그룹은 통째로 옮겨지고 그룹 **내부** 순서는 그대로 분할 트리 소유다. ⚠️ 순서 드롭 핸들러는 `stopPropagation`(안 하면 탭바의 '분리' 드롭이 함께 발화) + **`onDragEndSession()` 직접 호출**(stopPropagation 이 document 안전망까지 막는다 — 안 하면 드롭 존 오버레이가 굳는다).
- ⚠️ **한 세션은 그룹 전체 통틀어 pane 1개만** — main 의 `desktopAttached` 가 `Set<세션id>` 라 둘이면 한쪽 detach 가 다른 쪽 방송까지 끊는다. `removeFromGroups`·`replaceSession`(그룹 안 swap)·`sanitizeLayout` 이 지키고 **main 은 무변경**.
- **드롭 존은 드래그 중에만 pane 을 덮는 투명 오버레이**(xterm 이 dragover 를 삼키는 문제 회피). ⚠️ **드래그가 어떻게 끝나든 `dragSession` 을 반드시 비울 것** — 남으면 오버레이가 굳어 휠·클릭·선택이 전부 삼켜진다. 그룹 분리는 소스 탭이 언마운트돼 `dragend` 가 안 오므로 `detachSession` 이 직접 정리 + document 안전망(⚠️ **bubble 단계** — capture 면 드롭 자체가 무효).
- active 는 **visible(다중)/focused(단일)** 분리 — 크기 주장·fit·refresh 는 visible 전부, `term.focus()`·⌘F 는 focused 만. ⚠️ visible effect 에서 `focus()` 금지(드롭 순간 포커스 강탈).
- 영속화는 localStorage `terminal:layout`(selKey → 트리 **배열**). ⚠️ 복원 sanitize 는 **`sessionsReady` 이후에만**(빈 목록으로 돌면 그룹 오파기). ratio 갱신은 `findSplit`(splitId) — 트리 참조는 setRatio 마다 바뀐다.
- 그룹 뷰에서 focused 세션이 죽으면 sanitize 가 폴백 선택 — ⚠️ **`rememberActive` 로 먼저 기억**(안 하면 두 effect 의 setActiveId 경합).
- ⚠️ pane 경계·포커스를 pane 자체의 inset box-shadow 로 그리면 자식 배경이 덮어 안 보인다 — 구분선은 `split-grip::after`(상시), 포커스는 `--focused::after` 오버레이.
- 탭바 = '가라앉은 선반 + 장 탭'(⑧안, 모든 탭 동일 기하 + accent-soft 틴트, 바닥 경계는 inset box-shadow). ⚠️ 반려된 안(연결형 탭·세그먼트+장식·칩+박스)으로 돌아가지 말 것. ⌘1..9·⌃Tab 은 평탄화된 표시 순서(`tabView.tabs`).

## memo 계약 (pane·탭바·LNB)
- `TerminalView` 는 세션 객체가 아니라 **`sessionId` 등 원시값**만 받는다 — 객체는 브로드캐스트마다 새 참조라 memo 가 깨진다. (툴바를 공용 바로 올린 뒤 `cwd` 도 안 넘긴다 — 제목·상태·위치는 전부 탭바·공용 바가 표시한다.)
- 프리셋은 `presetsByCwd` useMemo 맵(키 = cwd 집합 문자열)에서 꺼내고, 없으면 고정 상수 `NO_PRESETS`. 실행 콜백은 `(cwd, preset)` 인자.
- LNB 집계는 `byCwd` 한 번에(행마다 filter 금지). ⚠️ 워크트리 폴링(10초)은 내용이 같으면 **이전 객체 유지**(JSON.stringify 비교).
- ⚠️ **워크트리 폴링은 경량 조회**(`workspaces.worktrees(id, false)` → `listWorktreesBrief` = `git worktree list` 1회)를 쓴다 — 상세는 워크트리마다 `git status --untracked-files=all`+`git diff` 를 돌려 **워크스페이스 14개에 596ms**(경량 24ms, 2026-08-20 실측)였고 그게 10초마다 돌았다. LNB 의 ±변경량 표시는 이때 걷어냈다(잘 안 보는 값 — 변경 내역은 '변경사항' 드로어가 맡는다). `dirty` 가 필요한 곳(워크트리 제거 확인)만 **그 순간** 상세로 부른다.

## 상단 공용 바·탭바 액션
- 툴바(프리셋·검색·글자크기·맨아래로·Finder)는 pane 이 아니라 **탭바 아래 공용 바 하나**. 프리셋 대상 = 포커스 세션 cwd, 없으면 선택 워크트리.
- 검색·맨아래로는 pane 이 `onRegisterHandle(id, {...})` 로 등록한 **포커스 pane 핸들** 위임. [맨 아래로] 노출은 `onScrolledChange(id, bool)` boolean 리프트(스크롤 이벤트마다 아님).
- `</>` IDE 버튼 = **워크트리 루트**를 Antigravity 로 — `execFile('open', ['-a', …])`(⚠️ `shell.openPath` 는 Finder 용이라 불가). ⚠️ 경로는 `listWorktrees()` 대조 후에만. 앱 번들은 `/Applications` 에서 직접 탐색(`workspaces:editor-info`), 없으면 버튼 미표시.

## 키 입력
- 단축키(⌘T·⌘1..9·⌃Tab·⌘⇧W·⌘F)는 **capture 단계 + stopPropagation** — bubble 이면 xterm textarea 가 먼저 처리해 셸에도 간다. ⚠️ `⌘W`·`⌘+/-` 는 Electron 메뉴 선점이라 사용 금지. 입력창 포커스 시 전부 통과. 탭 가운데 클릭 = 종료(`onAuxClick`).
- **Shift+Enter = `\x1b\r`**(TUI 줄바꿈) — ⚠️ **대체 화면일 때만** 개입(일반 화면에선 그 줄이 실행됨). keydown 외 keypress·keyup 도 `false` 로 막을 것.
  - ⚠️ buffer 타입 판정은 xterm 이 `?1049h` 를 봤는지에 의존 → replay 생략 세션의 **재마운트 pane 은 오판**한다(재마운트 = 앱 재시작·livePanes 축출 — 섹션 이동은 keep-alive 라 해당 없음). `attachSession` 응답의 `alt` 를 받아 클라이언트(데스크톱·MO)가 **`?1049h` 합성 write** 로 맞춘다.
  - ⚠️ 한글 조합 중(isComposing) Enter 는 xterm 에 넘기지 말고 `return false` — 넘기면 '조합 확정 + `\r` 제출'이 된다(확정은 compositionend 가 처리).
- **⌘←/⌘→ = `\x01`/`\x05`**(줄 처음/끝) — xterm 은 meta+화살표를 아예 버린다. Home/End 시퀀스는 맨 zsh 가 안 묶어 미사용. ⇧ 동반 조합은 개입하지 않는다.
- ⚠️ **한글 조합 중(isComposing) 방향키도 xterm 에 넘기지 말 것** — `CompositionHelper.keydown` 이 방향키를 보면 `_finalizeComposition(false)` 로 조합을 **즉시** 확정하는데, 그때 쓰는 `_compositionPosition.end` 는 compositionupdate 의 `setTimeout(0)` 으로 갱신돼 아직 낡은 값이라 **이미 보낸 글자를 다시 보낸다**(중복 방지 보정 `_dataAlreadySent`(xterm #3191)는 `waitForPropagation=true` 경로 전용). 2026-08-26 신고: "가나다라마바사"→"사사사", "입력"→"입력력". **물리 방향키·Home 은 IME 가 먼저 조합을 확정해 무사하고, ⌥+방향키는 `macOptionIsMeta` 가 조합 처리에서 제외한다** — 그래서 **키를 합성해 보내는 환경**(Karabiner 로 ⌘U/⌘J 를 방향키로 리맵)에서만 재현된다. 원인을 Karabiner·IME·Claude Code 쪽에서 찾지 말 것(그 경로로 반나절 헤맸다). 대응은 `return false` 로 보류(= `CoreBrowserTerminal._keyDown` 이 즉시 반환해 CompositionHelper 를 안 탄다) → compositionend 뒤 `setTimeout(0)` 에 시퀀스 전송. 이 타이머가 조합 글자보다 뒤에 실행되는 근거는 **리스너 등록이 `term.open()` 이후**라는 것 — 리스너를 open 앞으로 옮기면 순서가 뒤집힌다.
- ⚠️ **커스텀 키 핸들러에서 `return false` 하는 키는 `ev.preventDefault()` 도 반드시** — xterm 은 false 를 받으면 `cancel()` 없이 빠져나가 브라우저 편집 명령(⌘← `moveToBeginningOfLine` 등)이 **숨은 textarea** 에 적용된다. `CompositionHelper` 는 조합 위치를 `textarea.value.length`(끝에 붙는다는 가정)로만 계산하므로 캐럿이 앞으로 가면 **이후 한글 조합이 전부 textarea 끝 글자로 치환**된다('가나다라' → ⌘←(Karabiner ⌘U) → '라라라라 가나다라', 2026-08-26). textarea 는 Enter/^C 때만 비워져 그 줄 내내 반복. 안전망으로 keydown(비조합)마다 캐럿을 끝으로 재정렬한다(`rehomeCaret`). ⚠️ 단 **조합 중 방향키 보류 분기는 preventDefault 하지 말 것** — 편집 명령이 캐럿을 옮기며 조합을 끝내 주는 것이 보류 시퀀스를 내보내는 방아쇠다(막으면 이동이 다음 글자까지 지연, 2026-08-26 실측).
- ⚠️ **조합 중(또는 compositionend 직후 xterm 의 setTimeout(0) 전송 전) 단독 수정키 keydown 은 xterm 에 넘기지 말 것** — `CompositionHelper.keydown` 면제 목록은 CapsLock·229·Shift/Ctrl/Alt 만이라 **Meta(⌘) 는 조합 확정 키로 취급**돼 글자를 즉시 보내고, 진짜 compositionend 가 같은 글자를 다시 보낸다. Karabiner 가 `⌘J → ←` 로 리맵하면 `⌘ up → ← → ⌘ down` 으로 합성해 **이동 직후 ⌘ keydown 이 조합 중에 도착**한다("입력중"→"입력중중", 2026-08-26 — 물리 화살표엔 ⌘ 재누름이 없어 무사). 단독 수정키 keydown 은 xterm 이 아무 일도 안 하므로 막아도 잃는 게 없다.
- ⚠️ **커스텀 핸들러가 직접 보내는 제어 시퀀스(⌘←/→·⌘⌫·Shift+Enter)는 `writeKeySeq` 로** — compositionend 직후 xterm 의 setTimeout(0) 전송 전 창(`compositionSettling`)에 즉시 쏘면 **조합 글자보다 먼저 도착**한다('사과' 조합 중 ⌘U → "과사", 2026-08-26). 그 창이면 같은 setTimeout(0) 으로 미뤄 xterm 타이머 뒤에 보낸다. xterm 의 자체 flush(`CompositionHelper.keydown`)는 커스텀 핸들러가 `return false` 하면 안 탄다.

## 클립보드 (2026-08-13)
- ⚠️ **⌘C/⌘V 는 앱이 처리하지 않는다** — `setApplicationMenu` 가 없어 **Electron 기본 메뉴의 role:copy/paste** 가 처리하고, 그건 **포커스된 편집 요소**에만 작동한다(xterm 은 리스너를 자기 `element`·`textarea` 에만 건다). 그래서 섹션 루트 `onClick` = **포커스 안전망**이 필수다 — 없으면 탭·툴바 버튼을 누른 뒤 복사·붙여넣기가 조용히 죽는다(오류·로그 없음).
  - 안전망은 **rAF 로 미루고**(버튼 기본 포커스·모달 autoFocus 가 뒤에 확정된다) 실제 DOM 포함 관계·떠 있는 `.modal-overlay`/`.picker__pop`·입력 요소·**`getSelection()` 비어 있음**을 다 확인한 뒤에만 회수한다. ⚠️ 선택 검사를 빼면 변경사항 diff 를 드래그해 ⌘C 하는 순간 선택이 날아간다.
- **이미지 ⌘V = `0x16`(Ctrl+V) 위임** — xterm 은 `text/plain` 한 줄만 읽어(`Clipboard.ts`) 캡처 이미지 클립보드(평문 타입 0개)는 빈 문자열이 흘러 **무반응**이었다. Claude Code 가 `0x16` 에서 시스템 클립보드를 직접 읽으므로 pane 루트 `onPasteCapture` 가 넘긴다(main 무변경).
  - ⚠️ **대체 화면일 때만** — 일반 셸의 `0x16` 은 zsh `quoted-insert` 라 다음 키가 깨진다. 텍스트가 함께 있는 클립보드는 개입하지 않는다.
  - ⚠️ "앱 재시작 후 살아난 세션에서만"처럼 보이는 신고가 오지만 **세션 상태와 무관**하다 — 재시작 조건을 쫓지 말 것.

## 파일 드래그 앤 드롭 (경로 입력)
- pane 루트 **capture 단계**(`onDragOverCapture`/`onDropCapture`)로 받는다. 판정은 `dataTransfer.types` 의 `Files`(세션 탭 드래그와 안 겹침). 숨은 pane 은 `pointer-events: none`.
- 경로는 **preload 의 `getPathForFile`(webUtils)** — 렌더러 `File.path` 는 Electron 32 에서 제거됨. 인용은 `shellQuotePath`(POSIX 작은따옴표), 말미 공백 1개.
- ⚠️ **`renderer.tsx` 의 전역 Files 드래그 가드 지우지 말 것** — 없으면 pane 밖 드롭이 창을 file:// 로 내비게이션시킨다. `defaultPrevented` 인 이벤트는 건드리지 않는다(pane 의 copy 커서 보호).

## 세션 패널 (좌측)
- 드래그 리사이즈, `SIDE_SNAP_W`(140) 미만 = 축소(패널 48px·타일 34px), grip 더블클릭·Enter·Space 토글 — **앱 `Sidebar.tsx` 와 같은 규칙**(그쪽을 고치면 여기도 볼 것). 저장은 localStorage 에 놓는 순간 1회, 폭은 `Math.round`.
- ⚠️ 접힌 채 드래그가 끝나면 '펼침 폭'을 **드래그 시작 값으로 복원**(안 하면 접었다 펴는 순간 최소폭이 된다).
- 축소 타일은 이름 이니셜(CJK 1자). ⚠️ 닫기(×) 없음 — 종료는 `⌘⇧W` + 툴팁 안내. 헤더 액션은 감추지 않고 세로 스택.
- ⚠️ `side-grip` 의 레이아웃 실폭은 0(width 10 + `margin: 0 -5px`) — 실폭이 남으면 패널과 터미널 사이에 배경 띠. ⚠️ `gap: 0` 이라 변경사항 드로어 자신의 `margin-left: 8px`(grip 자리)·`padding: 8px 8px 0 0` 을 지우면 안 된다.
- **작업중(에이전트) 표시** — 펼침 모드는 행 우측 `spinner spinner--xs`, 축소 모드는 타일 둘레를
  도는 SVG 아크(`BusyArc` + `terminal__sq-arc`). 집계는 `byCwd` 같은 루프에 얹는다(행마다 filter 금지).
  - ⚠️ **`status === 'busy'` 를 보지 말고 `working` 을 볼 것** — busy 는 출력 한 프레임에도 켜지므로
    완료된 세션을 스크롤·클릭하거나 프롬프트에 타이핑하는 것만으로 2.5초 로딩이 떴다(2026-08-19 신고).
    `working` 은 main 이 "출력이 `WORKING_MIN_MS`(1.2초) 이상 이어졌고 그동안 키 입력·마우스 리포트가
    없었다"를 확인해 켜는 필드다(아래 상태 휴리스틱 절). 셸 세션도 함께 제외한다(`ls` 한 번에도 busy).
  - ⚠️ 축소 아크를 **원형 border 링이나 회전하는 conic-gradient 로 바꾸지 말 것** — 사각 타일과
    기하가 안 맞아 타일을 관통하거나 코너가 밖으로 튄다. dash 합 = 둘레, 이동량은 음수를 인라인
    변수로(키프레임의 `calc` 은 보간되지 않음). 근거는 `_terminal.scss`·`WorkspaceNav.tsx` 주석.
- 세션 행 = 래퍼 div + `[선택 button][닫기 button]` 형제(활성은 `aria-current`). 이름 변경 = 더블클릭 인라인 편집(`terminal:rename` → sidecar 영속), 진입 시 `select()`.

## xterm 구성
- addon: fit·unicode11·webgl·web-links·search — 전부 **devDependencies**(prod 에 두면 `copyRuntimeDeps` 가 패키지에 복사).
- ⚠️ **`allowProposedApi: true` 필수** — 없으면 unicode11 load 가 throw → React 루트 통째 언마운트(흰 화면).
- webgl 은 `term.open()` **이후** 로드, `onContextLoss` 에서 `dispose()`(DOM 폴백), 생성 실패는 try/catch.
- 링크(OSC 8 `linkHandler` + `web-links`)는 전부 `window.oneApp.openExternal`(http/s 만). Finder 는 `terminal:reveal-cwd`(세션 id 만 받아 main 이 cwd 해석 — 임의 경로 방지).
- 검색 하이라이트는 `#RRGGBB` 만(알파 불가) → `mixHex` 로 패널 배경에 선합성, 비활성/활성 대비를 크게(선택 틴트와 겹쳐 그려진다). ⚠️ 검색바는 **오버레이**(absolute) — 세로 스택이면 PTY 행이 바뀌어 전체 리플로우.
- ⚠️ **xterm 6 함정 3가지**: ①네이티브 스크롤 영역 없음 — `term.scrollLines()`·`buffer.active.viewportY`·`term.onScroll` 사용 ②스크롤바 자체 구현 — 전역 `::-webkit-scrollbar` 안 먹음 ③`xterm-viewport` 배경 #000 하드코딩 — `theme.background: 'rgba(0,0,0,0)'`(`'transparent'` 는 검정 폴백) + `allowTransparency`, 배경은 패널 CSS 에 위임. 오버라이드는 xterm.css 보다 특정도 한 단계 좁게.
- ⚠️ **텍스처 아틀라스는 같은 폰트 pane 들의 공유물** — pane 개별 `clearTextureAtlas()` 금지(다른 pane 이 무효 좌표로 샘플링해 글자 겹침). **마운트 시점에 번들 폰트 미로드(`monoFontLoaded` false)일 때만** clear. 복귀 복구는 `term.refresh(0, rows-1)` — ⚠️ DEC 2026(sync) 동안 refresh 는 버퍼링만 되므로 **rAF 로 한 번 더** 건다.
- 색은 `buildTheme()` 이 **다크 패널 토큰**에서 읽는다(hex 금지 — 마젠타·시안만 예외). 글꼴 **JetBrains Mono NL 13px / lineHeight 1.0**. ⚠️ `lineHeight` 는 fontSize 가 아니라 폰트 자연 줄높이(JBM 1.346배)에 곱해지고, xterm 은 `<1` 을 거부한다. 폰트 로드 완료 후 `fit()` 1회 재실행.

## 스크롤 (tmux 위임)
- tmux 백엔드에선 xterm 스크롤백이 안 쌓인다 — **주인은 tmux**(`history-limit 10000`). `term.clear()` 도 영구 삭제 아님. 재시작 후에도 tmux history 는 남아 스크롤로 볼 수 있다(xterm 링버퍼와 별개).
- 휠은 `attachCustomWheelEventHandler` → `terminal:scroll` → `tmuxScrollPane` 이 **tmux 안에서 3단 분기**(왕복 1회): ①**마우스 트래킹 pane 이면 SGR 휠 리포트 주입**(⚠️ 1006 켠 앱에만 — X10 앱은 오파싱) ②TUI(마우스 없음)면 방향키 ③일반 화면이면 `copy-mode -e` + scroll(바닥 자동 종료).
  - ⚠️ ①이 최우선인 이유: claude 는 **리렌더마다 마우스 모드를 껐다 켜서** xterm `term.modes` 가 순간 'none' 일 수 있다 — 그 틈에 방향키를 보내면 프롬프트 히스토리가 롤링된다. pane 플래그는 tmux 가 아는 진실이라 안 흔들린다.
  - ⚠️ tmux `mouse on` 금지 — xterm 네이티브 드래그 선택·링크 클릭이 회귀한다(휠만 가로챌 것).
- 마우스 트래킹 앱(claude 등)에는 휠 pass-through(핸들러 `true` 반환 — 자체 스크롤 보유). 폴백 세션도 xterm 기본 동작.
- 스크롤 중 입력은 `exitCopyMode` 후 **`pendingInput` 큐**로 순서 보존(첫 글자 유실 방지). 렌더러는 소수 누적 + 24ms flush + `wheelBusy` 스킵으로 tmux 호출을 묶는다. pane 조준은 `data-pane-session`(탭 `data-session` 과 분리).
- MO 터치 스크롤은 이 경로가 아니라 **합성 WheelEvent → `.xterm-screen` 디스패치** — ⚠️ `scrollLines()` 직접 호출은 claude(대체 화면)에서 안 된다.

## 상태 휴리스틱·알림
- `pty.ts`: `busy`(출력 있음) / `waiting`(에이전트 세션 **완전 침묵 2.5초** + 입력 후 출력 ≥50B) / `idle`(**셸 세션은 waiting 없음**). bare BEL 은 조기 판정(0.3초)+바이트 면제. **판정 규칙과 상수는 `status.ts` 의 순수 함수**(`decideSilence`·`decideWaitingNotify`)에 있고 `status.test.ts` 가 케이스를 고정한다 — 규칙을 손볼 때는 pty.ts 가 아니라 그쪽을 고치고 `npm test` 로 확인할 것.
- ⚠️ 바이트 문턱을 크게 잡지 말 것 — 600 이면 claude 의 145B 계정 선택 프롬프트를 놓친다.
- ⚠️ attach/resize 의 SIGWINCH redraw 를 grace 로 거르면 **영영 idle 에 갇힌다** — busy 로 흘려보내고, 알림 중복은 `notifiedSinceInput`(턴당 1회)이 막는다.
- 알림 = 입력대기 뱃지 상시 + **토스트 기본 표시**(2026-08-14 — 우측 아래 sticky, **백그라운드여도 발신돼 복귀 시 떠 있다**(`sendToast`), 세션당 `dedupeKey` 1장, [이동]=`openTerminalSession` 으로 그 세션 포커스) + 강도 `terminal.json` `notifyLevel`(badge/sound/alert — 환경설정 → 터미널 Segment): sound 는 +알림음, alert 는 +백그라운드일 때 알럿 폴백(`notifyToast`). 생성 20초·직전 입력 5초 내 전이는 알림 생략.
- 토스트 제목에 **위치 라벨**(`입력 대기 — 작업영역명 · 워크트리폴더명`) — `sessionLocationLabel`(ipc.ts) 이 워크스페이스별 `worktreePaths`(경량 `git worktree list`)로 cwd 를 대조, **cwd 별 영구 캐시**(세션 수명 동안 불변). 중첩 매치는 더 깊은 경로 우선, 워크스페이스 밖(홈 등)이면 라벨 생략. ⚠️ `listWorktrees` 를 쓰지 말 것 — 워크트리마다 `git status`+`diff` 가 돌아 알림용으론 무겁다.
- **보고 있는 세션은 토스트 생략** — TerminalSection 이 `sectionNav.setSessionVisibilityCheck` 로 "화면 세션(활성 섹션 + activeGroupIds/activeId)" 판정을 등록하고, App 의 `AppToastBridge` 가 발신 전에 확인한다.
  - ⚠️ **세션이 죽으면 그 세션의 입력대기 토스트도 거둔다** — `App.tsx` 의 `AppToastBridge` 가 `terminal:exit` 에서 `dismissToast(termWaitToastKey(id))`. 죽은 세션은 '화면에 올라오면 닫는다' 경로에 영영 안 걸려 sticky 토스트가 남았고, 그 [이동]을 누르면 없는 세션을 열려다 **터미널 섹션이 빈 화면으로 고착**됐다(아래 대기 플래그 참고).
  - **이미 떠 있던 토스트는 그 세션이 화면에 올라오면 거둔다**(2026-08-19) — 입력대기 토스트는 sticky 라 스스로 안 사라져서, 알림을 보고 세션에 가도 ✕ 를 눌러야 했다. TerminalSection 의 effect 가 화면 세션마다 `useToastDismiss()(termWaitToastKey(id))`. **보고 있는 세션만** 닫는다 — 터미널 섹션 진입만으로 전부 닫으면 아직 확인 안 한 다른 세션 알림까지 사라진다. dedupeKey 문자열은 `shared/types.ts` 의 `termWaitToastKey()` 한 곳 — main(발신)과 렌더러(닫기)가 갈라지면 조용히 안 닫힌다.
- ⚠️ **제출(Enter)이 오면 생성 grace 를 즉시 푼다**(`noteInput` 의 `suppressNotifyUntil = 0`) — grace 는 초기 프롬프트·복원 redraw 의 소음을 막자는 것이고, `create-grace` 분기는 알림 기회까지 소진하므로 안 풀면 **grace 창(20초) 안에 끝난 사용자 턴이 통째로 무음**이 된다. 2026-08-19 신고 "FO-JB 작업영역만 완료 토스트가 안 뜬다"의 원인이 이것 — **작업영역과 무관한 타이밍 문제**였다: 앱 재시작 복원 grace 가 끝나기 0.5초 전에 waiting 이 온 세션은 삼켜지고, 1.5초 뒤에 전이한 옆 세션은 정상 발화했다. ⚠️ 복원(`restoreSessions`)도 grace 를 새로 걸므로 **생성 시각만 보고 "grace 는 끝났을 것"이라 추정하지 말 것** — `[skip] why=create-grace` 로그의 `graceLeft` 를 볼 것.
- 알림 기회는 **턴(입력)당 1회**. 입력 후 5초(입력 게이트) 안의 waiting 전이는 ①**제출(Enter — `\x1b\r` Shift+Enter 제외)로 시작한 턴이면 소진하지 않고 게이트 해제 시점에 재판정**해 그때도 waiting 이면 알림(짧은 턴 미탐 방지 — 2026-08-14, `notifyRecheck` 타이머·finalizeExit 에서 정리) ②제출 없는 입력(타이핑 멈춤)이면 기존대로 조용히 소진.
- ⚠️ **xterm 자동 응답은 입력으로 치지 않는다**(`AUTO_REPLY_RE` — 포커스 이벤트 ESC[I/O·CPR·DSR·DA·OSC 색 응답, PTY 전달은 그대로) — 이걸 입력으로 집계하면 알림 기회가 재장전돼 **끝난 세션이 한참 뒤 스스로 그린 출력(상태줄 갱신 등)에 소리가 울린다**(2026-08-14 사용자 신고로 수정). 렌더러 `DA_REPLY_RE` 는 DA 만 거른다 — 새 자동 응답 유형이 생기면 main 쪽 목록에 더할 것.
  - **실측 근거**(2026-08-14, 실제 claude 세션): ①claude 는 기동 시 `ESC[?1004h`(포커스 리포팅)를 켠다 — probe 캡처에서 `?1000h ?1002h ?1003h ?1004h ?1006h ?2004h ?2026h ?2031h` 확인 ②앱 tmux conf 가 `focus-events on` 이라 그 모드가 클라이언트 터미널(xterm)까지 전달된다(실제 `terminal:data` 스트림에서 `?1004h` 관측) ③xterm 소스의 `_handleTextAreaFocus` → `sendFocus` 면 `ESC[I`/`ESC[O` 전송 ④진단 로그의 **`[auto]` 기록으로 `ESC[O` 와 OSC 10/11 색 응답이 실제로 `writeSession` 에 도달함을 확인**. 재현·회귀 확인은 이 로그를 볼 것.
- **'실작업'(sustained) 판정이 상태 전이의 축이다** — `noteOutput` 한 곳에서 잰다: ①출력이
  `OUTPUT_RUN_GAP_MS`(1.5초) 이내 간격으로 `WORKING_MIN_MS`(1.2초) 이상 **이어졌고** ②마지막 키 입력,
  ③마지막 **마우스 리포트**가 그만큼 조용할 때. ②③은 "사용자가 화면을 만지는 중" 신호다 — claude 는
  타이핑·휠에 화면을 다시 그리므로 그 리렌더를 작업으로 세면 완료된 세션을 확인하는 것만으로 작업중이 된다.
  - **`working`**(= LNB 로딩 표시, `TerminalSessionInfo.working`) 은 sustained 일 때 켜고 busy 를 벗어나면
    `setStatus` 가 내린다. 한 번 켜지면 busy 인 동안 유지 — 작업 중 스크롤에 꺼지면 안 된다.
  - **`waiting`(초록) → busy 전이도 sustained 를 요구한다** — 초록은 '아직 해소되지 않은 완료' 표시라
    단발 리렌더나 대기 화면의 분 단위 갱신(실측: 60초마다 4.5KB)에 내리면 훑어볼 표시가 수시로 사라진다.
    ⚠️ **`idle`→busy 는 즉시 그대로 둘 것** — 늦추면 세션 생성 직후 첫 렌더가 통째로 먹혀 영영 idle 에 갇힌다.
  - ⚠️ 판정을 `statusTick` 으로 옮기지 말 것 — 출력이 끊긴 뒤에도 시간만으로 문턱을 넘어 리렌더가 통과한다.
- **`waiting`(초록)은 제출(Enter)로만 내린다** — 타이핑 도중에 내리면 답을 쓰다 다른 세션을 보러 간
  사용자가 '아직 답 안 보낸 세션'을 목록에서 잃는다(2026-08-19 신고). `noteInput` 은 `lastInputSubmit`
  일 때만 `waiting → idle`. 알림 기회 리셋(`notifiedSinceInput`)은 종전대로 모든 입력에서 한다.
- **진단 로그**(`terminal/debug.ts`) — 알림 오탐은 재현 시점을 잡기 어려워 콘솔이 아니라 파일에 쌓는다. 켜는 법: `touch ~/Library/Application\ Support/One\ App/term-debug.on`(**앱 재시작 불필요** — 10초 캐시로 스위치 파일을 다시 본다), 로그는 같은 폴더 `term-debug.log`(개발 인스턴스는 `-dev`). `ONEAPP_TERM_DEBUG=1` 이면 콘솔에도 나온다. 태그: `[input]`(사람 입력으로 집계 = 알림 기회 재장전) · `[auto]`(걸러짐) · `[status]`(전이+근거) · `[notify]`(발화, 직전 입력 종류 포함) · `[skip]`(억제 이유) · `[life]`(세션 수명). **토스트가 떴는데 `[notify]` 가 없으면 원인은 렌더러 쪽**이라 절반이 갈린다. 입력 본문은 `«12»` 처럼 개수로만 남고 ESC 시퀀스만 원문 보존한다.
  - ⚠️ **마우스 리포트도 자동 응답이다**(2026-08-19 재발 수정) — claude 는 마우스 트래킹을 켜므로 `TerminalView` 의 휠 핸들러가 `mouseTrackingMode ≠ 'none'` 이면 휠·클릭을 xterm 에 그대로 위임하고, xterm 이 만든 SGR 리포트(`ESC[<64;1;1M` 등)가 `terminal:write` 로 올라온다. 즉 **끝난 세션을 눈으로 확인하려고 클릭·스크롤하는 것만으로** 알림 기회가 재장전돼, 이어지는 claude 리렌더 출력 한 번에 토스트가 다시 떴다("완료된 터미널에 자꾸 토스트"). 마우스는 "보고 있음"이지 "새 턴 시작"이 아니다. 현재 목록은 포커스·CPR·DSR·DA·**DECRPM(`$y`)·마우스 3종(SGR/urxvt/X10)·OSC 전체·DCS 응답**까지 — 전부 키보드로 만들 수 없어 사람 입력을 삼킬 위험이 없다.
  - ⚠️ **BEL 은 판정에 한 번 쓰면 소비한다**(`statusTick` 끝에서 `bellAt = 0`) — 예전엔 다음 입력까지 남아 완료 시의 BEL 하나가 이후 모든 출력에 '0.3초 침묵 + 바이트 면제'를 계속 발급했다. 끝난 세션이 busy↔waiting 을 쉼 없이 왕복하며 알림 게이트를 반복해 두드린 원인.

## 리사이즈
- PTY resize IPC 는 **120ms 디바운스**(마지막 값만 — last-claim-wins 유지), fit 은 rAF 코얼레스 — SIGWINCH 폭주가 claude 전체 리렌더를 부른다.
- `.terminal__main` 에 `min-width/min-height: 0` + `overflow: hidden` 필수 — flex 기본 `min-*: auto` 는 fit→resize→성장 무한 루프.
- ⚠️ **여백은 `.xterm` 이 갖는다** — 마운트 부모(host)에 padding 을 주면 FitAddon 이 `getComputedStyle().height`(전역 border-box 라 padding 포함)로 과대 계산해 **마지막 행이 잘린다**. `.xterm` 자신의 padding 은 정확히 뺀다. MO(`#term`)도 동일 구조. 여백 조정은 `.terminal__host .xterm` 에서만.
- 데스크톱 `ResizeObserver` 는 **컨테이너 크기가 실제로 바뀔 때만 fit** — 무조건 fit 하면 MO 가 맞춘 크기를 즉시 되돌린다.

## attach 프로토콜·크기 공유
- 세션별 **링버퍼(512KB) replay** 로 스크롤백 복원, 현재 화면의 진실은 SIGWINCH redraw. 출력은 **16ms 배칭** + `seq`(클라이언트가 attach 시점 이하를 버려 중복 방지). replay 생략(TUI) 세션은 응답에 `alt: true` → 클라이언트가 `?1049h` 합성 write.
  - ⚠️ **링버퍼 적재를 출력 바이트의 `?1049h/l` 로 게이팅하지 말 것**(2026-08-13 시도·실패·되돌림). TUI 구간은 attach 가 어차피 replay 를 버리니 안 쌓으면 되겠다 싶지만, **tmux 클라이언트 자신이 attach 하면서 대체 화면에 들어간다** — TUI 를 하나도 안 띄운 순수 셸 세션도 링버퍼 **오프셋 0 이 `?1049h`** 이고 `?1049l` 은 끝내 오지 않는다(실측). 그래서 모든 tmux 세션이 영구히 '대체 화면'으로 잡혀 **스크롤백 replay 가 통째로 0B** 가 됐다(2.2KB → 0B 실측). `attachSession` 의 `isTmuxAltScreen()` 은 **pane 을 직접 질의**하는 것이라 판정 대상이 다르다 — 바이트 감지로 대체할 수 없다.
- `terminal:data` 는 **pane 이 attach 한 세션만 broadcast** — cleanup 은 `terminal:detach`(섹션 이동은 keep-alive 라 detach 없음 — livePanes 축출 등만), 리로드·창 파괴는 sender `destroyed`/`did-navigate` 에서 회수. preload `onData`/`onResized` 는 멀티플렉서 — 새 고빈도 구독 채널도 `makeMux` 를 쓸 것.
- 크기는 **last-claim-wins + 재주장**: 데스크톱은 창 포커스 시(proposeDimensions 와 다르면), MO 는 visible 상태에서 `resized` 수신 시.
- **claude CLI 는 대체 화면 + 마우스 트래킹을 세션 내내 유지**(단, 리렌더마다 모드 토글) — 터미널 쪽에서 스크롤을 흉내내지 말고 휠을 그대로 넘긴다.

## MO 접속·서버
- 도달·암호화는 **Tailscale**, 앱은 토큰 인증만: `?token=` 1회 → `timingSafeEqual` → **HttpOnly 쿠키 승격**(Max-Age 1년·SameSite=Lax — QR 은 처음 한 번만), WS upgrade 재검증, 30초 ping. 토큰·포트(기본 18317)는 `safeStorage`/`terminal.json`, 켜둔 상태면 재시작 시 자동 재시작.
- ⚠️ **회사 VPN(full-tunnel)을 켜면 MO 가 통째로 끊긴다 — 미해결**(원본 .ovpn 유지, 시도 2건 모두 부작용으로 롤백). 경위·다음 시도 카드·진단 명령은 `docs/terminal-notes.md` 'MO 접속' 절.
- HTTPS: `tls.ts` 가 `tailscale cert` 로 발급(실패 시 http 폴백) — **PWA 설치(주소창 제거)·clipboard 의 전제**. ⚠️ 접속 URL 은 인증서 도메인만(IP 는 경고 + 설치 조건 깨짐). WS 는 `location.protocol` 따라 wss. 하루 1회 `ensureTls()` → `setSecureContext()` 무중단 갱신. ⚠️ `tailscale cert` 는 `--cert-file/--key-file` 명시(안 주면 cwd 에 쓴다).
- manifest·아이콘만 `PUBLIC_PATHS` 로 인증 제외(브라우저가 쿠키 없이 받아간다) — 앱 화면은 그대로 403.

## MO 터미널 페이지 (`src/mobile`)
- 별도 Vite 엔트리(`mobile_window`, base `/terminal/`). 조작은 전부 '버튼 하나 + 바텀시트'(`sheetMode` 하나를 돌려씀). 재접속은 1→2→4→5초 백오프 + `visibilitychange` 즉시 재연결.
- ⚠️ `workspaces` 는 **시트를 열 때만 요청**(워크스페이스마다 git 이 돈다). 변경사항(±)도 폴링 없이 버튼 시에만 조회(폰 배터리).
- ⚠️ **뒤로가기는 오버레이만 닫는다** — 열 때 `pushState`, 닫기는 **언제나 `history.back()` 한 경로**, DOM 숨김은 `popstate` 의 `hideTopOverlay()` 에서만. UI 닫기에서 `back()` 을 빼먹으면 유령 히스토리가 쌓인다. `back()` 은 비동기라 `closeSheet()` 는 `sheetMode` 를 즉시 비운다.
- ⚠️ 보고 있는 세션이 작업 영역 밖이면 select 에 `(다른 영역)` 으로 남긴다(빼면 select 가 엉뚱한 세션을 가리킴). `mo:lastSession` 이 영역보다 우선 — 폰은 '이어서 쓰는' 화면.
- 변경사항 데이터는 `/term` 이 아니라 **`/rpc`**(`handleShared` 통로 재사용 — 로직 중복 0). **커밋은 넣지 않는다**(폰 오터치). diff 는 가로 스크롤, 파일 경로는 `direction: rtl` + ⚠️ 격리 문자 `U+2066/2069`.
- **키바는 소프트 키보드가 떠 있을 때만** — 판정은 **뷰포트 높이 감소**(`KEYBOARD_MIN_DELTA` 120px, `orientationchange` 에서 기준 리셋). ⚠️ textarea focus/blur 판정 금지 — 안드로이드 뒤로가기로 키보드를 닫으면 blur 가 안 온다. 키바 토글마다 `syncViewport()`.
- 글자 크기는 두 손가락 핀치(기본 6px — 넓은 TUI 전체 보기가 첫 화면의 목적, 조절 중 `#fontHud`). ⚠️ 핀치로 끝난 touchend 를 탭으로 처리하지 말 것(키보드 소환). 붙여넣기(📋)는 secure context 에만 노출.
- ⚠️ **DA 응답 필터(`DA_REPLY_RE`)는 MO·데스크톱 둘 다 필수** — xterm 이 DA 질의에 자동 응답한 것이 셸 입력으로 샌다(MO 는 WS 지연으로, 데스크톱은 **링버퍼 replay 의 옛 질의**로). 사용자가 칠 수 없는 시퀀스라 걸러도 무손실. ⚠️ ESC 는 `String.fromCharCode(27)` 로 조립(no-control-regex).
- ⚠️ 예측 입력 억제: xterm 기본 설정만으론 부족 — open 직후 `autocomplete=off` + `autocapitalize=none` + `inputmode="url"` 을 덧붙인다. 한글 조합 표시는 `.composition-view` 를 **MO 에만** 스타일(15px 고정, ⚠️ `!important` 필요 — 인라인으로 덮어쓴다). 데스크톱에 넣었다 되돌렸으니 다시 넣지 말 것.
- 폰트는 데스크톱과 동일 **JetBrains Mono NL**(Regular·Bold, Italic 제외) + `lineHeight 1.0` + **Unicode11Addon + allowProposedApi 한 쌍**(없으면 CJK 폭 오계산 / throw). `document.fonts.ready` 후 fit.
- 소프트 키보드: viewport 메타 `interactive-widget=resizes-content` + `visualViewport`/`innerHeight` 중 **작은 값**으로 높이 보정 + `overscroll-behavior: none`(pull-to-refresh 방지).
- ⚠️ 텍스트 표현이 기본인 기호는 **VS16 + 컬러 이모지 폰트** 지정(두부 방지).

## 에이전트 추가
- `shared/types.ts` 의 `TerminalAgentId`·`TERMINAL_AGENT_NAMES` + `agents.ts` 의 `AGENTS` **두 곳만** 손대면 된다. 설치 감지는 `zsh -lc "whence -p"` 1회 캐시 — 미설치는 선택지에서 조용히 제외.
- 프리셋 스코프 필터(`presetsForWorkspace`)·에이전트 태깅(`agentIdFromCommand`)은 **`shared/types.ts`** — 데스크톱·MO 판정이 갈라지면 안 된다.
