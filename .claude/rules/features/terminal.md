---
paths:
  - "src/main/features/terminal/**"
  - "src/renderer/features/terminal/**"
  - "src/main/features/workspaces/**"
  - "src/mobile-app/terminal/**"
  - "src/shared/terminal-protocol.ts"
---

# 터미널 + MO(모바일) 연동 — 핵심 규칙

`renderer/features/terminal` + `main/features/terminal` + `src/mobile-app/terminal`(폰 터미널 탭). Superset 스타일 **에이전트 세션 오케스트레이터** — 여러 claude 세션을 병렬 관리하고, 자리를 비우면 폰으로 같은 세션을 이어서 쓴다.

> **경위·실측 수치·시도와 폐기 기록은 `docs/terminal-notes.md`** (절 제목 동일). 여기는 지금도 유효한 불변식·함정만 남긴다. 새 함정 발견 시: 여기에 한 줄 요약, 상세는 노트에.

## 구조
- **main `pty.ts` 가 PTY 단일 소유자**(`Map<id, 세션>`) — 데스크톱(IPC)·모바일(WS)은 각자 attach. 세션은 창과 무관, tmux 면 앱 재시작에도 산다.
- tmux 는 전용 소켓(`-L oneapp`) + 전용 conf(`tmux.ts` 가 덮어쓰고 살아있는 서버엔 `source-file`). 메타는 sidecar `userData/terminal-sessions.json`, 시작 시 `restoreSessions()` 가 `list-sessions` 와 대조.

## tmux 백엔드 불변식
- ⚠️ conf 의 `terminal-features ",xterm-256color:RGB:sync:hyperlinks"` **지우지 말 것**(`sync` 없으면 중간 프레임 노출).
- ⚠️ conf 의 배열 옵션은 **`set -su` 로 되돌린 뒤 `set -as`** — 살아있는 서버에 `source-file` 로 재적용하므로 `-as` 만 두면 앱 시작마다 같은 항목이 쌓인다(2026-10-01 실측 15중복).
- 같은 크기 attach 는 SIGWINCH 토글 대신 **`refresh-client`**, 마지막 PTY 크기를 sidecar 에 기억해 그 크기로 attach.
- ⚠️ **대체 화면(TUI) 세션은 attach replay 생략**(잔상), 일반 셸은 유지. 그래서 `attachSession` 은 **async**.
- ⚠️ `=이름` 정확 매칭은 **target-session 계열(has/kill/attach)만** — pane 타깃(`send-keys`)엔 안 먹어 pane id 를 캐시한다.
- [x] = `kill-session`(sidecar 제거), `before-quit` 은 **detach 만**. 외부 detach 면 `has-session` 후 재attach. 미설치면 직접 spawn 폴백(`terminal:backend`).
- ⚠️ `restoreSessions()` 는 sidecar `createdAt` 순 정렬 — `list-sessions` 는 이름순(=무작위)이라 탭 순서가 뒤섞인다.
- 상세: 노트 '세션 영속화 — tmux 백엔드'.

## 자동 실행 명령 (에이전트 시작)
- ⚠️ **명령을 PTY write / `send-keys` 로 주입하지 말 것**(ZLE·DA 협상과 경합, send-keys 도 되돌린 시도). `new-session` 의 **shell-command 인자**로(`launchShellCommand()`).
- 형태 고정: `env -u TMUX -u TMUX_PANE <sh> -ic 'trap '\''true'\'' INT; <명령>; exec <sh> -il'`
  - ⚠️ 명령과 `exec` 는 **같은 셸 안**(두 번 띄우면 tty pgrp 을 잃어 pane 이 죽는다). ⚠️ `env -u TMUX` 는 **셸 바깥**. ⚠️ `trap '' INT` 금지(자식 상속).
  - `-ic` 필수(PATH). `agentCommand()`(`agents.ts`)는 **원시 명령** 반환, 래핑은 `pty.ts`.
- ⚠️ **`TMUX` 를 지우고 실행**(남기면 256색 폴백) — 에이전트 세션은 위 형태, **셸 세션도 `env -u TMUX -u TMUX_PANE <sh> -il`**(2026-10-01 — 셸 탭에서 손으로 친 claude 가 분홍 로고·칙칙한 화면이 됐다). 색이 이상하면 SGR 유형(`38;2`/`38;5`)부터. 상세: 노트 '⚠️ 에이전트 실행은 `TMUX` 를 지우고 띄운다 (트루컬러)'.
- tmux 미설치 폴백만 PTY write — 첫 출력 후 350ms 잠잠하면 전송, 상한 3초.
- `terminal:sessions` 브로드캐스트는 **payload(전체 목록)** 를 싣는다(재조회 없음).
- ⚠️ **PTY 쓰기는 `ptyWrite()` 경유**(`s.pty.write` 직접 금지) — 동기 throw 가 앱 전체를 내린다.
- 진단: `ONEAPP_TERM_DEBUG=1` → `[term:life]`. 죽은 pane 재현은 전용 소켓 + `remain-on-exit on` + `capture-pane -p`.
- 상세: 노트 '⚠️ 자동 실행 명령은 **입력으로 주입하지 않는다** (2026-08-08)'.

## 데스크톱 pane 관리
- **본 적 있는 세션의 `TerminalView` 는 언마운트 안 함** — 숨김 = `visibility:hidden` + `absolute; inset:0`. ⚠️ `display:none` 금지.
- **pane 은 활성이 된 세션만** — `livePanes`(LRU) 상한 `MAX_LIVE_PANES`(8, WebGL 전역 제한). 축출은 화면 밖만.
- ⚠️ **숨은 pane 은 PTY 크기를 주장하지 않는다**(`activeRef` 로 `onResize`·`reclaimSize` 차단 — MO 크기를 되돌린다). 보이면 `fit`+재주장+포커스. 글자 크기는 `TerminalSection` 소유.
- ⚠️ **PTY resize = 디바운스(120ms) + 마지막 전송 기준 스로틀(`PTY_RESIZE_THROTTLE_MS` 250ms)** 둘 다 유지 — 스로틀을 빼면 드래그 중 검은 화면, 디바운스를 빼면 폭주. 기준을 '대기 시작'·'타이머 없으면 즉시'로 바꾸지 말 것(노트 '⚠️ 리사이즈 — SIGWINCH 폭주 주의').
- ⚠️ **`activateSession` 의 `pendingRef` 는 반드시 풀린다**(3초 만료 + 토스트) — 남으면 '활성 세션 보정'이 멈춰 빈 화면. 해제 신호 `pendingCleared` state 를 보정 effect deps 에.
- 상세: 노트 '데스크톱 pane 관리'.

## 섹션 keep-alive (2026-08-13)
- 섹션은 `App.tsx` `main__keep` 래퍼로 **상주 마운트**. ⚠️ 재마운트발 버그 방어 코드(Shift+Enter alt 게이트·DA 필터)는 앱 재시작·축출 경로용 — 지우지 말 것.
- `active=false` 면: pane 전부 숨김 · 전역 단축키 해제 · 폴링 중지 · **body 포털 모달·오버레이 닫기** · 섹션 안 포커스 blur(⚠️ 숨은 textarea 가 다른 섹션 타이핑을 먹는다). attach 는 유지.
- ⚠️ `main__keep--hidden` 의 `height: auto` 지우지 말 것(숨은 크기 ≠ 활성 크기 → 리사이즈 2회). ErrorBoundary 는 key 없는 상주 경계.
- 상세: 노트 '섹션 자체도 keep-alive 다'.

## 섹션 안 뒤로/앞으로 (2026-08-19)
- `lib/useSessionHistory.ts` 스택을 `lib/sectionBack` 으로 **섹션 이동보다 먼저** 소비. 항목은 `{selection, sessionId}`, 복원은 `rememberActive` **먼저** → `setActiveId`.
- ⚠️ 섹션을 떠나면 스택을 비우고, 빈 방향은 등록하지 않는다. ⚠️ 기록은 **사용자 전환만**(`selectTab`·`selectWorkspaceTab`), 자동 경로는 `applyTab`/`selectAndSave`.
- 상세: 노트 '섹션 안 뒤로/앞으로 (2026-08-19)'.

## 팝아웃 창 (세션 별도 창 분리 — 2026-09-01)
> 모든 항목의 경위·실측: 노트 '팝아웃 창 (세션 별도 창 분리 — 2026-09-01)'.
- **배정 정본 = main `windows.ts`**(sidecar `runtimeFile('terminal-windows.json')`), 렌더러는 `terminal:windows` 미러. bounds 는 `windowState` `popout:<id>`.
- **한 세션 = 전 창 통틀어 pane 1개** — 메인은 분리 세션을 자리표시자 탭으로, 각 창 `TerminalPanes`·`useSplitGroups` 엔 자기 소속만.
- ⚠️ attach 추적은 **sender 별**(`attachedBySender: Map<WebContents, Set<id>>`, 전역 Set 금지). 죽은 엔트리 청소는 `terminal:attach` 에서만(방송 경로 금지).
- 팝아웃 = `main_window` 엔트리 `?popout=<id>`(⚠️ 새 Vite 엔트리 금지) → `TerminalPopoutApp`. 그룹 분리 트리는 **마운트 전** `win:<id>` 에 심는다.
- ⚠️ 공유 localStorage 는 **자기 소유 키만 read-merge-write**(`persistLayouts(ownsLayoutKey)`·`persistTabOrder`·`rememberActive`). 청소는 `pruneWindowScreenState`(windowsReady 게이트).
- 창 밖 드롭은 **탭 dragend 의 screen 좌표만**(`peekGroup` 무변경 조회). ⚠️ `dropEffect` 판정 금지 · ⚠️ `text/plain` 싣기 금지(`application/x-oneapp-term` 만) · ⚠️ open 히트테스트는 메인·팝아웃 창만(`getAllWindows()` 금지). `setDragImage` 투명 고스트는 되돌린 안.
- ⚠️ 팝아웃 탭바 = 타이틀바: `drag` 는 **스페이서 `__tabs-space` 에만**, `__tabs-list` 는 `no-drag` + `flex: 0 1 auto`. 높이 `--titlebar-h`. `app-region: drag` 는 드래그 **시작**에만 관여.
- 크로스 DnD 는 `terminal:drag` → `terminal:dragState` 미러. ⚠️ 받은 창은 소속 브로드캐스트 후 배치(`pendingDropRef` → `applyDropAt`), move-session 은 **무조건 dragState null**.
- 닫힘: ⌘W = 메인 복귀(세션 안 죽음), 앱 종료 = 복원. ⚠️ `initTerminalWindows` 는 **restoreSessions() 후 + `app.whenReady()` 후**, `terminal:windows:list` 는 `windowsRestored` 게이트.
  - ⚠️ 배정 제거는 **`detachFromAll()` 한 경로**(`moveSession`·`onTerminalExit`·`open`). ⚠️ 정리는 `close` 와 **`closed` 둘 다**(`removePopout` 멱등).
- 되돌리기는 화면 이동까지 — 팝아웃 `windows.revealInMain`(→ `terminal:reveal`), 자리표시자 `setFocusReq`.
- 크기 승계는 `popout-last`(`inheritWindowSize`, 크기만). ⚠️ `popout:` 접두사 금지(`pruneWindowStates` 가 지운다).
- **탭 우클릭 `ContextMenu`** 가 주 진입점. `onDetachToWindow(id, x?, y?)` 좌표 생략 = 기억된 자리 + 히트테스트 생략. ⚠️ 탭 더블클릭 이름 편집 되살리지 말 것.
- 알림 게이트 `isVisibleInPopout` = **창 포커스 여부**, `sendToast` 에만(⚠️ `notifyToast` 알럿은 통과). ⚠️ 토스트 회수는 팝아웃 `focus` 에도 재보고, main 은 **매번** `app:toast:dismiss`.
- 메인 창 판정은 `getNotifyWindow()`(`getAllWindows()[0]` 금지), `setNotifyWindow` 는 메인 전용.

## 분할(스플릿) 그룹
- ⚠️ 트리 규칙('한 세션 = pane 하나', 무변화 시 **원본 참조 반환**)은 `lib/layout.test.ts` 가 고정 — `npm test`.
- `lib/layout.ts` **이진 트리**(PanelNode/SplitNode + ratio). ⚠️ **pane 은 `__panes` 의 플랫 형제**(중첩 = 재부모화 = xterm 언마운트), 렌더는 `computeLayout` %rect.
- **화면은 activeId 의 함수** — 탭·⌘1..9·⌃Tab·새 세션은 화면 전환만, 그룹 변경은 **드롭만**. ⚠️ '탭 클릭 = 슬롯 교체'로 되돌리지 말 것.
- 드롭 X자(`|nx|>|ny|`), 중앙 0.3 = 세션 교체, 그룹당 `MAX_SPLIT_PANES`(4), 타 그룹 세션은 먼저 `removeFromGroups`, 1개 남으면 해체.
- 빼기 = 탭바 **빈 영역** 드롭. ⚠️ 탭 위 dragover 는 preventDefault 안 함(`overTabArea`, 스프링 로딩 180ms·이탈 시 타이머 파기) — 예외는 좌우 30% `REORDER_EDGE`.
- 탭 순서 `terminal:tabOrder`, 정렬은 `tabSessions` 한 곳(⚠️ `sessions` 정렬 금지). ⚠️ 순서 드롭은 `stopPropagation` + **`onDragEndSession()` 직접 호출**.
- ⚠️ **한 세션은 그룹 통틀어 pane 1개**(main `desktopAttached` 가 `Set`) — `removeFromGroups`·`replaceSession`·`sanitizeLayout` 이 지킨다.
- 드롭 존 = 드래그 중 투명 오버레이. ⚠️ **어떻게 끝나든 `dragSession` 을 비울 것**(굳으면 휠·클릭을 삼킨다) — `detachSession` 직접 정리 + document 안전망(⚠️ **bubble**).
- visible(다중)=크기 주장·fit·refresh, focused(단일)=`term.focus()`·⌘F. ⚠️ visible effect 에서 `focus()` 금지.
- 영속 `terminal:layout`(selKey → 트리 배열). ⚠️ sanitize 는 **`sessionsReady` 이후만**. ratio 는 `findSplit`(splitId). focused 가 죽으면 ⚠️ **`rememberActive` 먼저**.
- ⚠️ 경계·포커스를 inset box-shadow 로 그리지 말 것 — `split-grip::after`·`--focused::after`.
- **머리줄 높이 = `--term-head-h` 32 · 탭 `--term-tab-h` 28**(2026-10-01 사용자 선택 B안 — 44/36 에서 압축해 터미널 세로 공간 확보). 탭바·세션 패널 머리·변경사항 드로어 머리가 이 토큰으로 바닥선을 잇는다 — 하나만 바꾸면 선이 어긋난다. 다른 섹션의 `--pane-head-h`(44)는 별개. 팝아웃 탭바는 타이틀바라 `--titlebar-h` 그대로.
- 탭바 = 2026-09-30 목업으로 교체(사용자 지시 "디자인과 동일하게"): 선반 = 패널 면 + 바닥선, 비활성 탭 = 배경·테두리 없음, **활성 탭 = 터미널 면색 장이 바닥선을 덮어 아래 pane 과 이어진다**, 상태점은 제목 앞·× 는 모든 탭에 늘. ⚠️ 활성 탭에 `margin-bottom: -1px` 금지 — 리스트가 `overflow-x: auto` 라 잘린다(리스트 padding-bottom 0 으로 탭이 부모의 inset 바닥선을 덮는다). 분할 그룹은 한 장(tab-pack) 안 멤버 세그먼트 유지. ⌘1..9 는 `tabView.tabs` 순.
- 상세: 노트 '분할(스플릿) 그룹 — 탭 드래그로 여러 pane 동시 표시'.

## memo 계약 (pane·탭바·LNB)
- `TerminalView` 는 **`sessionId` 등 원시값만**(객체·`cwd` 안 넘김). 프리셋은 `presetsByCwd` 맵, 없으면 `NO_PRESETS`, 콜백 `(cwd, preset)`.
- LNB 집계는 `byCwd` 한 번에. ⚠️ 워크트리 폴링은 같으면 **이전 객체 유지**(JSON.stringify).
- ⚠️ **워크트리 폴링은 경량 조회**(`workspaces.worktrees(id, false)` → `listWorktreesBrief`), `dirty` 는 필요한 순간에만 상세로.
- 상세: 노트 '⚠️ pane·탭바·LNB 는 `memo` 다'.

## 공용 툴바·탭바 액션
- 툴바는 **세션 탭 줄 오른쪽**(`SessionTabs` 의 `tools` 슬롯 → `__tabs-tools`) — 2026-10-01 탭바 아래 별도 줄(40px)을 합쳐 터미널 높이 확보. ⚠️ `tools` 는 `useMemo` 로 고정해 넘긴다(SessionTabs 는 memo). 팝아웃 창은 넘기지 않는다. 프리셋 대상 = 포커스 세션 cwd, 없으면 선택 워크트리.
- 검색·맨아래로는 `onRegisterHandle` 의 **포커스 pane 핸들** 위임, 노출은 `onScrolledChange(id, bool)`.
- `</>` = **워크트리 루트**를 Antigravity 로 `execFile('open', ['-a', …])`(⚠️ `shell.openPath` 불가). ⚠️ 경로는 `listWorktrees()` 대조 후. 번들 탐색 `workspaces:editor-info`.

## 키 입력
- 단축키(⌘T·⌘1..9·⌃Tab·⌘⇧W·⌘F)는 **capture + stopPropagation**. ⚠️ `⌘W`·`⌘+/-` 금지(메뉴 선점). 입력창 포커스면 통과. 가운데 클릭 = 종료.
- **Shift+Enter = `\x1b\r`** ⚠️ **대체 화면일 때만**, keypress·keyup 도 `false`. 재마운트 pane 은 `attachSession` 의 `alt` 로 **`?1049h` 합성 write**.
- **⌘←/⌘→ = `\x01`/`\x05`**(xterm 은 meta+화살표를 버린다). ⇧ 동반은 개입 안 함.
- ⚠️ **조합 중(isComposing)**: Enter 는 `return false` · 방향키는 보류 → compositionend 뒤 `setTimeout(0)` 전송(리스너는 **`term.open()` 이후** 등록 유지) · 단독 수정키 keydown 차단(⌘ 가 확정 키 취급돼 글자 중복).
- ⚠️ `return false` 하는 키는 **`ev.preventDefault()` 도**(textarea 캐럿 이동 → 조합 치환), 안전망 `rehomeCaret`. 단 **조합 중 방향키 보류 분기는 preventDefault 금지**.
- ⚠️ 핸들러가 직접 보내는 시퀀스(⌘←/→·⌘⌫·Shift+Enter)는 **`writeKeySeq`**(`compositionSettling` 창이면 뒤로 미룸).
- ⚠️ 글자 중복 계열은 Karabiner·IME 탓이 아니다. 반대로 포커스 직후 **깨끗한 자모 분리**("ㅎㅏㄴ글")는 macOS IME 버그(FB17460926) — 앱에서 쫓지 말 것.
- 상세: 노트 '키 입력'(2026-08-26 조합 계열), 초기 기록은 노트 '세션 패널은 드래그 리사이즈 + 완전 축소'.

## 클립보드 (2026-08-13)
- ⚠️ **⌘C/⌘V 는 Electron 기본 메뉴 role 이 처리**(포커스된 편집 요소만) → 섹션 루트 `onClick` **포커스 안전망** 필수: rAF 지연 + DOM 포함·`.modal-overlay`/`.picker__pop`·입력 요소·**`getSelection()` 빔** 확인.
- **이미지 ⌘V = `0x16` 위임**(`onPasteCapture`) — ⚠️ **대체 화면일 때만**, 텍스트 있으면 개입 안 함. "재시작 후 세션에서만"은 무관하니 쫓지 말 것.
- 상세: 노트 '클립보드 — ⌘C/⌘V 가 조용히 죽는 두 경로'.

## 파일 드래그 앤 드롭 (경로 입력)
- pane 루트 **capture**(`onDragOverCapture`/`onDropCapture`), `Files` 타입 판정, 숨은 pane 은 `pointer-events: none`.
- 경로는 **preload `getPathForFile`**(`File.path` 제거됨), `shellQuotePath` + 말미 공백.
- ⚠️ **`renderer.tsx` 전역 Files 가드 지우지 말 것**(file:// 이동). `defaultPrevented` 는 건드리지 않는다.

## 세션 패널 (좌측)
- **일반 폴더도 워크스페이스** — `parseWorktrees`(workspaces/git.ts)가 `plain: true` 합성, 표시는 `worktreeRef`/`worktreeLabel`(shared/types.ts)·`worktreeIcon`. 저장 안 하고 조회마다 판정. ⚠️ `.git` 이 있는데 실패하면 throw.
- ⚠️ 선택 보정 effect 는 폴백 = 현재 선택이면 set 안 함(무한 루프).
- 변경사항 드로어의 머리 띠는 `.terminal__changes::before`(left -8px ~ right, 높이 `--term-head-h`, 탭바와 같은 선반+바닥선)로 탭바 선을 창 끝까지 잇고, `::after` 가 xterm 과의 세로 경계다 — aside 의 margin/padding 규칙은 그대로, `.changes__head` 높이는 `--term-head-h`.
- 리사이즈·`SIDE_SNAP_W`(140) 축소(패널 48·타일 34)·grip 토글은 **`Sidebar.tsx` 와 같은 규칙**. 저장은 놓을 때 1회 `Math.round`. ⚠️ 접힌 채 끝나면 펼침 폭을 드래그 시작 값으로.
- 축소 타일 = 이니셜 2자(`initials(name, 2)` — 영문 ST·OA, CJK 는 1자), ⚠️ 닫기(×) 없음(`⌘⇧W`). ⚠️ `side-grip` 실폭 0(`margin: 0 -5px`). 드로어는 2026-09-30 사용자 지시로 목업 구조(패널 면 + border-left, 바깥 여백 없음)로 변경 — grip 은 경계선 위 실폭 0(`left: -6px`, `::after` 가 경계와 같은 x). 드로어 안쪽 모양은 `_changes.scss` 의 `.terminal__changes .changes` 스코프에만(폰 '변경' 탭과 공유 컴포넌트).
- **상태 색(2026-09-30)**: 작업 중 = **초록**(`--ok` — 탭 점 `StatusDot run` 펄스·LNB 스피너·축소 아크) · 입력 대기 = **주황**(`--warning` — 탭 점 `StatusDot wait` 펄스 없음·세션 수 뱃지·브랜치 라벨). 예전 '대기=초록(준비됨)'으로 되돌리지 말 것 — 사이드바 뱃지·토스트의 주의색과 맞춘 것이다. MO 터미널 탭(`mobile-app/terminal`)도 같은 색(2026-10-01).
- 작업중 표시 = `spinner spinner--xs` / 축소 `BusyArc`(`terminal__sq-arc`). ⚠️ **`busy` 가 아니라 `working`** 을 볼 것(셸 제외). ⚠️ 아크를 원형 링·conic-gradient 로 바꾸지 말 것.
- 세션 목록은 탭바(`SessionTabs`). 이름 변경 = **우클릭 [이름 변경]** → `Input bare`(`terminal:rename`), `select()`. ⚠️ `bare` 가 `min-height` 하한을 지워야 탭이 안 부푼다.
- 패널 머리줄 `__side-head` 는 탭바와 같은 `--term-head-h` 높이로 바닥선을 잇는다(패널 패딩 0 — 여백은 머리줄 0 12 0 16·목록 8 이 각자). LNB·축소 타일·뱃지 수치는 목업(Terminal·TerminalCollapsed 보드) 그대로 — 채운 색 타일(인디고 7번만 흰 글자 `--on-strong`), 세션 수 뱃지는 주황 채움 + 패널 면 2px 링(2026-09-30 목업이 08-20 'soft·링 금지' 결정을 대체).
- 상세: 노트 '세션 패널 (좌측)'·'세션 패널은 드래그 리사이즈 + 완전 축소'.

## xterm 구성
- addon(fit·unicode11·webgl·web-links·search)은 전부 **devDependencies**. ⚠️ **`allowProposedApi: true` 필수**(없으면 흰 화면).
- webgl 은 `term.open()` **이후**, `onContextLoss` 에 `dispose()`, 실패는 try/catch.
- 링크는 `window.oneApp.openExternal`(http/s), Finder 는 `terminal:reveal-cwd`(세션 id 만).
- 검색 하이라이트는 `#RRGGBB` → `mixHex` 선합성. ⚠️ 검색바는 **오버레이**(PTY 행 불변).
- ⚠️ **xterm 6**: 네이티브 스크롤 없음(`scrollLines`·`viewportY`·`onScroll`) · 전역 스크롤바 CSS 안 먹음 · 배경은 `theme.background: 'rgba(0,0,0,0)'`(`'transparent'` 금지) + `allowTransparency`. 오버라이드는 특정도 한 단계 좁게.
- ⚠️ **텍스처 아틀라스는 pane 공유물** — `clearTextureAtlas()` 는 **마운트 시 `monoFontLoaded` false 일 때만**. 복귀는 `term.refresh(0, rows-1)` + ⚠️ **rAF 한 번 더**(DEC 2026).
- 색은 **`lib/xtermTheme.ts`**(`buildTerminalTheme`·`searchDecorations`) 한 벌을 데스크톱·MO 가 함께 쓴다 — 다크 패널 토큰에서(hex 금지, 마젠타·시안 예외), 선택 틴트도 `--accent-on-dark` 파생. ⚠️ 복사본을 두지 말 것(리디자인 때 MO 만 고쳐져 어긋났다). **JetBrains Mono NL 13px / lineHeight 1.0** ⚠️ 자연 줄높이에 곱해지고 `<1` 거부. 폰트 로드 후 `fit()`.
- 상세: 노트 'xterm addon 구성 (2026-08-05)'·'색·글꼴'.

## 스크롤 (tmux 위임)
- xterm 스크롤백은 안 쌓인다 — **주인은 tmux**(`history-limit 10000`).
- 휠 `attachCustomWheelEventHandler` → `terminal:scroll` → `tmuxScrollPane` **3단 분기**: ①마우스 트래킹 pane = SGR 리포트(⚠️ 1006 앱만) ②TUI = 방향키 ③일반 = `copy-mode -e`. ⚠️ ①이 최우선(claude 모드 토글 틈). ⚠️ tmux `mouse on` 금지.
- 트래킹 앱은 휠 pass-through(`true`). 스크롤 중 입력은 `exitCopyMode` + **`pendingInput` 큐**. 렌더러 24ms 묶음 + `wheelBusy`. 조준은 `data-pane-session`.
- MO 터치도 **같은 경로** — 트래킹 ON 이면 `.xterm-screen` 에 합성 WheelEvent, 아니면 WS `scroll`(`scrollSession`). ⚠️ `scrollLines()` 직접 금지. ⚠️ **마우스 꺼진 휠을 xterm 에 넘기지 말 것**(방향키 변환) — 판정은 `attached` 의 `tmux`. `[맨 아래로]` 는 서버 `scrolled`.
- 상세: 노트 '스크롤 (tmux 위임)'·'휠 스크롤은 tmux copy-mode 로 위임한다'.

## 상태 휴리스틱·알림
> 경위·실측·신고 기록: 노트 '상태 휴리스틱·알림'·'상태 휴리스틱'.
- `busy` / `waiting`(에이전트 **완전 침묵 2.5초** + 입력 후 출력 ≥50B) / `idle`(**셸은 waiting 없음**). BEL 조기 판정 0.3초. ⚠️ **규칙·상수는 `status.ts`**(`decideSilence`·`decideWaitingNotify`) + `status.test.ts` — 그쪽을 고치고 `npm test`.
- ⚠️ 바이트 문턱을 키우지 말 것(145B 프롬프트). ⚠️ attach/resize redraw 를 grace 로 거르지 말 것 — 중복은 `notifiedSinceInput`.
- 알림 = 뱃지 + **sticky 토스트**(`sendToast`, `dedupeKey`, [이동]=`openTerminalSession`) + `notifyLevel`(badge/sound/alert → `notifyToast`). 생성 20초·입력 5초 내 생략.
- 위치 라벨 `sessionLocationLabel`(ipc.ts, 경량 `worktreePaths` + cwd 캐시, ⚠️ `listWorktrees` 금지). 보는 세션은 생략(`setSessionVisibilityCheck` → `AppToastBridge`).
- ⚠️ 세션이 죽으면 토스트도 거둔다(`terminal:exit` → `dismissToast(termWaitToastKey(id))`). 화면에 올라온 세션만 `useToastDismiss()`. dedupeKey 는 `termWaitToastKey()` 한 곳.
- ⚠️ **제출(Enter)이면 grace 즉시 해제**(`suppressNotifyUntil = 0`). 복원도 grace 를 거니 `[skip] why=create-grace` 의 `graceLeft` 확인.
- 알림은 **턴당 1회** — 제출 턴은 입력 게이트 해제 시 재판정(`notifyRecheck`), 비제출 입력은 소진.
- ⚠️ **자동 응답은 입력이 아니다**(`AUTO_REPLY_RE` — 포커스·CPR·DSR·DA·DECRPM·**마우스 리포트**·OSC·DCS) — 새 유형은 main 목록에. ⚠️ BEL 은 한 번 쓰면 소비(`bellAt = 0`).
- **sustained**(`noteOutput`): `OUTPUT_RUN_GAP_MS`(1.5초) 이내로 `WORKING_MIN_MS`(1.2초) 이상 + 키·마우스 조용. `working` 과 `waiting`→busy 가 이걸 요구. ⚠️ `idle`→busy 는 즉시. ⚠️ `statusTick` 으로 옮기지 말 것.
- **`waiting` 은 제출로만 내린다**(`lastInputSubmit`).
- 진단: `touch ~/Library/Application\ Support/One\ App/term-debug.on`(재시작 불필요) → `term-debug.log`(dev `-dev`). 태그 `[input]`·`[auto]`·`[status]`·`[notify]`·`[skip]`·`[life]`.

## 리사이즈
- PTY resize **120ms 디바운스**(last-claim-wins) + fit rAF 코얼레스. 스로틀은 '데스크톱 pane 관리'.
- `.terminal__main` 에 `min-width/min-height: 0` + `overflow: hidden` 필수(무한 성장).
- ⚠️ **여백은 `.xterm` 이 갖는다**(host padding = 마지막 행 잘림). 조정은 `.terminal__host .xterm`, MO `#term` 도 동일.
- `ResizeObserver` 는 **실제 크기 변화 때만 fit**.
- 상세: 노트 '⚠️ 리사이즈 — SIGWINCH 폭주 주의'.

## attach 프로토콜·크기 공유
- **링버퍼(512KB) replay** + SIGWINCH redraw. **16ms 배칭** + `seq`. replay 생략 세션은 `alt: true` → `?1049h` 합성.
  - ⚠️ **링버퍼 적재를 `?1049h/l` 바이트로 게이팅하지 말 것**(replay 0B) — alt 판정은 `isTmuxAltScreen()` pane 질의뿐.
- `terminal:data` 는 **attach 한 세션만** broadcast, 회수는 `terminal:detach`·sender `destroyed`/`did-navigate`. 새 고빈도 구독도 `makeMux`.
- 크기 **last-claim-wins + 재주장**(데스크톱 창 포커스·pane 클릭 시, MO visible 에서 `resized` 시).
- ⚠️ **보는 쪽 우선 + 놓으면 데스크톱으로**(2026-10-01 사용자 결정) — 폰은 터미널 보기로 **보는 동안만** 크기를 쥔다. 화면 꺼짐·앱 전환(`visibilitychange`)·다른 탭(`setActive(false)`)·채팅 보기·다른 세션 attach·WS 끊김이면 `release` → 서버가 **그 폰이 쥔 크기일 때만** 데스크톱이 마지막으로 주장한 크기(`deskSize`, ipc attach·resize 가 기억)로 되돌린다(`pty.releaseRemoteSize`). 돌아오면 `claimSize`.
  ⚠️ 놓지 않던 때는 폰을 한 번 터미널 보기로 열었다 내려놓으면 PTY 가 폰 크기로 남아 PC 가 좁아지고 **행이 넘쳐 입력 상자가 pane 아래로 잘렸다**(채팅 보기는 아래 칸이 0). 창 focus 재주장은 창이 이미 포커스면 안 뜬다.
  ⚠️ 데스크톱은 **따라간 크기를 PTY 로 되돌려 보내지 않는다**(`followed`) — 보내면 main 이 폰 크기를 `deskSize` 로 기억해 놓을 때 폰 크기로 돌아간다.
- claude 는 대체 화면 + 마우스 트래킹 유지 — 스크롤을 흉내내지 말고 휠을 넘긴다.
- 상세: 노트 'attach 프로토콜'.

## MO 접속·서버
- **Tailscale** 도달, 앱은 토큰만: `?token=` → `timingSafeEqual` → **HttpOnly 쿠키**(1년·Lax), WS upgrade 재검증, 30초 ping. 토큰·포트(18317)는 `safeStorage`/`terminal.json`.
- ⚠️ **회사 VPN(full-tunnel)을 켜면 MO 가 끊기던 문제** — 2026-10-02 VPN 연결 시 Tailscale 서버만 `net_gateway` 로 빼는 경로를 얹어 해결(DERP 경유). 원인·함정은 `features/system.md` VPN 절.
- HTTPS `tls.ts`(`tailscale cert`, 실패 시 http) — PWA·clipboard 전제. ⚠️ URL 은 인증서 도메인만, wss 는 `location.protocol` 따라. `ensureTls()` → `setSecureContext()`. ⚠️ `--cert-file/--key-file` 명시. manifest·아이콘만 `PUBLIC_PATHS`.
- ⚠️ **`startServer` 는 진행 중 promise 로 직렬화**(`stopServer` 는 완료 대기, listen 후 `getServerEnabled()` 재확인).
- ⚠️ **WS 백프레셔**(> 2MB): `/term` 은 data 만 버리고 `needsResync`, `/rpc` 는 소켓을 끊는다.
- 상세: 노트 'MO 접속'.

## MO 터미널 탭 (`src/mobile-app/terminal` — 2026-10-01 리디자인, 목업 캔버스 'MO(폰)')
옛 별도 페이지(`src/mobile`, Vite 엔트리 `mobile_window`)를 **셸의 첫 탭**으로 합쳤다 — 탭을 오갈 때 페이지 이동·xterm 재초기화·replay 를 다시 하지 않는다.
- 구조: `controller.ts`(React 밖 싱글턴 — xterm·`/term` WS·타이머·알림·wakeLock, `subscribe`/`getState`) · `MoTerminalTab.tsx`(그리기만) · `logic.ts`(순수 판정 — `logic.test.ts`) · `index.ts`(셸용 `moTerminal` 요약: 입력 대기 수·연결·**target = 보는 워크트리** — 변경 탭이 따라간다).
- ⚠️ **셸은 터미널 탭을 언마운트하지 않는다**(keep-alive, `hidden`) — `setActive(false)` 동안엔 크기 주장(`resized`)·wakeLock 을 하지 않고, 숨은(폭 0) 호스트로 `fit` 하지 않는다(0 열로 줄여 PTY 를 망가뜨린다).
- 서버: `/terminal*`(옛 홈 화면 아이콘·북마크·데스크톱 '터미널만 바로 열기' URL)도 **셸 index.html** 을 준다(`server.ts` `shellPath`) — 그 아래 sw.js·manifest·아이콘만 셸 것을 같은 이름으로.
- ⚠️ `?session=`(알림 클릭)은 **모듈 평가 시점**에 읽는다 — `main.tsx` 가 토큰 쿼리를 지울 때 함께 지워지기 전이다(import 가 본문보다 먼저 평가된다).
- ⚠️ `workspaces` 는 **접속 시 1회 + 시트를 열 때만**(폴링 금지 — git 조회). 타일 색은 노드의 `color`(데스크톱 지정색) → `tileColor`.
- 뒤로가기: 시트는 공용 **`useBackClose`**(셸 모달과 같은 규칙 — 옛 페이지의 자체 `hideTopOverlay` 구현은 없앴다).
- ⚠️ 영역 밖 세션은 칩에 '다른 영역'으로 남긴다. `mo:lastSession` 우선. ⚠️ 자동 attach 는 **`!attachedId && !pendingAttachId`** 일 때만(`pickAutoAttach`).
- **키 바는 키보드 없이도 1단 고정**(esc tab ctrl ↑↓←→ ⏎ + ⌨), 키보드가 뜨면 2단(⇧tab·alt·| ~ / -·home end pgup pgdn·^C). ctrl·alt 는 한 번 적용(`applyModifiers` — alt = ESC 접두). 키보드 판정은 **뷰포트 높이 감소**(`KEYBOARD_MIN_DELTA` 120px) — ⚠️ focus/blur 금지. 열림이면 `html.mo-kbd` + `--mo-vh` → 셸이 높이를 줄이고 탭바를 숨긴다.
- ⚠️ **화면 탭은 읽기 — 키보드를 열지 않는다**: touchend 에서 `preventDefault` 로 합성 mousedown(=xterm 포커스)을 막는다. 키보드는 ⌨ 버튼으로만(`term.focus()`), 닫기는 `term.blur()`.
- 출력 복사: 세션 메뉴 → 선택 모드(드래그 = **줄 단위** `selectLines`, 스크롤 대신) → [복사](`useCopy` — http 폴백 포함). 검색: `SearchAddon`(데스크톱과 같은 하이라이트 합성).
- 핀치 글자 크기 6~22(**기본 11** — 옛 기본 6 은 읽기엔 작았다) + 메뉴 [A− A+]. ⚠️ 핀치 touchend 를 탭 처리 금지. 붙여넣기는 secure context 만(메뉴에서 비활성 + 이유).
- 대기 알림·탭 배지·홈 아이콘 배지·wakeLock 은 `StableWaiting`(3초 유예) 하나를 본다. ⚠️ 안드로이드는 셸 `public/sw.js`(루트 스코프, fetch 미개입) `showNotification`. 알림 클릭 → 열린 창 `postMessage` → 셸이 터미널 탭으로(`onFocusRequest`). secure context 전용.
- 세션 종료 확인은 공용 `useConfirm`, 안내는 공용 토스트(옛 페이지는 네이티브 confirm·상태 칸 2.2초).
- ⚠️ **`DA_REPLY_RE` 는 MO·데스크톱 둘 다 필수**, ESC 는 `String.fromCharCode(27)`.
- ⚠️ 예측 입력 억제 `autocomplete=off`+`autocapitalize=none`+`inputmode="url"`. `.composition-view` 는 **MO 에만**(`--fs-title` 고정, `!important`).
- 터미널 색은 데스크톱과 **같은 모듈**(`renderer/features/terminal/lib/xtermTheme.ts`)에서 읽는다(폰도 이제 셸 테마를 따르고, 터미널 면은 두 테마 모두 `--surface-dark`).
- 폰트 JetBrains Mono NL + `lineHeight 1.0` + **Unicode11 + allowProposedApi 한 쌍**. 키보드: `interactive-widget=resizes-content` + `visualViewport`/`innerHeight` 작은 값 + `overscroll-behavior: none`. ⚠️ 텍스트 기호는 VS16 + 컬러 이모지 폰트.
- 상세: 노트 'MO 터미널 페이지 UI'·'자리를 비운 동안 알기'.

## MO 채팅 보기 (2026-10-01 — `main/.../chat.ts`·`transcript.ts` + `mobile-app/terminal/MoChatView.tsx`)
claude 세션을 폰에서 **말풍선으로** 본다(세션별 [채팅|터미널] 토글, claude·femc 는 채팅이 기본 — `logic.ts` `defaultView`).
- **화면을 긁지 않는다 — 대화 기록(jsonl)을 읽는다**: pane 셸 pid(`tmuxPanePid`) → 자손 중 `$CLAUDE_CONFIG_DIR/sessions/<pid>.json`
  이 있는 프로세스 → `sessionId`·`cwd` → `projects/<cwd 영숫자 외 '-'>/<sessionId>.jsonl`. 설정 폴더는 홈의 `.claude`·`.claude-*` 전부(계정 셸 함수).
  구독(1초 주기, 늘어난 바이트만)은 **폰이 채팅을 보는 동안만**(`chat-open`/`chat-close`, 소켓 close 에서 해제). `/clear` 로 sessionId 가 바뀌면 메타를 다시 읽어 reset.
- ⚠️ **jsonl 은 첫 메시지 때 생긴다**(sessions/<pid>.json 은 기동 즉시) — 파일이 없으면 '못 찾음'이 아니라 **빈 대화(`fresh`)** 로 보내 입력창을 연다.
  폴더 신뢰 확인 같은 TUI 화면도 같은 상태라 구분 불가 → 폰이 '확인 화면이 있으면 터미널에서 먼저' 안내를 띄운다.
- ⚠️ 대화 기록에 **TUI 상호작용은 없다**(계정 선택·폴더 신뢰·`/` 메뉴) — 그런 화면은 [터미널]로.
- ⚠️ **AskUserQuestion 질문은 답하기 전까지 jsonl 에 없다**(답한 뒤에 질문+답이 함께 기록된다) — 대기 중임은 `sessions/<pid>.json` 의
  `status: 'waiting'`(`waitingFor: 'input needed'`)로만 안다. 그때만 서버가 `capture-pane -p -J` 로 화면 끝을 읽어 **번호 선택 화면**을
  `chat-prompt` 로 보낸다(`screenPrompt.ts` — `Enter to select|confirm` 안내 줄 + `1.` 부터 이어지는 번호. ⚠️ 머리·질문·선택지 사이에 빈 줄이 있다).
  못 읽으면 선택지 없는 prompt = '터미널에서 답 필요' 카드. 버튼 = 그 번호 키 → 화면이 바뀌면 다음 prompt(여러 질문 → 검토 '1. Submit answers' 까지).
  직접 답 = 'Type something.' 번호 → 글 → Enter. 번호 없는 화면(폴더 신뢰 `❯ No, exit`)은 읽지 않는다.
  - ⚠️ **검토 화면('Ready to submit your answers?')엔 안내 줄이 없다**(`2. Cancel` 로 끝남) — 안내 줄이 없으면 '마지막 글자 줄이 선택지'일 때만 읽는다.
  - ⚠️ **재구독 때 '대기 없음(null)'도 보낸다**(`promptKey` 초기값 `''`) — 터미널에서 답하고 채팅으로 돌아오면 폰이 예전 카드를 들고 있어
    입력창까지 잠겼다(2026-10-01 사용자 신고). 폰도 같은 세션 재구독 시 prompt 를 비운다.
- ⚠️ **채팅 보기는 PTY 크기를 주장하지 않는다** — attach 를 `0×0`(서버가 크기 변경 생략)으로, 따라간 크기를 `resize` 로 되돌려 보내지 않는다(데스크톱 창을 끄는 중 옛 크기가 최신을 덮는다).
  터미널로 바꾸는 순간 `setView` 가 refit + 주장. xterm 은 언마운트하지 않고 `moterm__term--hidden`(display:none) — 숨은 호스트 fit 은 `refit` 이 건너뛴다.
- 입력(폰만 — 데스크톱은 아래 '데스크톱 채팅 보기'): `chat-send` → 서버(`chat.ts sendChatText`)가 **한 줄이어도 bracketed paste 로 감싸고 250ms 뒤 Enter**. ⚠️ 감싸지 않으면 claude 가 글자 덩어리 뒤 Enter 를 붙여넣기로 삼켜 **글이 입력란에 남고 제출되지 않았다**(2026-10-01 재현 — 이 탓에 Esc 로 멈출 작업도 없었다). [중단] = `\x1b` 후 800ms 뒤 Ctrl+U · 누르는 즉시 '작업 중' 을 숨기고(`stopping`, busy 가 내려가면 풀림·최대 6초) **그동안의 Esc 는 삼킨다**(⚠️ claude 에서 Esc 두 번 = 되감기 메뉴 — 표시가 늦게 꺼져 사용자가 거듭 눌렀다, 2026-10-01) — ⚠️ claude 는 중단하면 보낸 글을 입력란에 되돌려 놓는데 채팅 보기에선 안 보여 다음 메시지에 붙는다. ⚠️ 비우기를 전송 때 하지 말 것(claude 입력란에 사용자가 직접 넣어 둔 것이 지워진다).
- ⚠️ **앱을 claude 안에서 띄우면 `CLAUDECODE`·`CLAUDE_CODE_*` 가 세션에 상속돼 그 안 claude 가 기록 저장을 끈다**("Transcript saving is off") —
  `pty.ts` `inheritableEnv()` 가 걸러낸다(`CLAUDE_CONFIG_DIR` 은 남김). 그 전에 뜬 tmux 서버는 옛 env 를 들고 있다.
- jsonl 은 Claude Code 내부 형식 — 파서(`transcript.ts`)는 모르는 줄·블록을 **조용히 건너뛴다**. `isSidechain`(서브에이전트)·`isMeta` 숨김,
  `[Request interrupted by user…]` 는 사람 입력 자리에 오지만 `notice`(가운데 회색 줄). 규칙은 `transcript.test.ts` 가 고정.
- **일하는 중에 보낸 메시지(대기열)** — 2026-10-02 실측: `queue-operation` enqueue(보낸 순간) → 턴이 끝나 꺼내면 dequeue + 보통 user 줄, **진행 중인 턴에 끼워 읽히면** remove(`absorbed_mid_turn`) + `attachment` 'queued_command'(prompt) **만** 남고 user 줄이 없다(예전엔 그 메시지가 채팅에 안 보였다). 대기열 상태는 파일 조각에 걸쳐 `chat.ts` Watch 가 들고(`applyQueueOps`), 바뀔 때만 'chat' 메시지의 `queued`(전체 목록)로 보낸다 → `ChatView` 맨 아래 **회색 점선 말풍선 '대기 중'**. 사람 아닌 것(`<task-notification>` 등)은 순서 맞춤용으로만 두고 숨긴다. 모르는 연산 = 비움, 한가한데 6초 넘게 남으면 비움(`QUEUE_STALE_MS` — 꺼낸 기록을 놓친 경우).
- `<task-notification>`(백그라운드 작업 완료)는 사람 입력 자리에 오지만 내 말풍선이 아니라 `notice`('백그라운드 작업 — 요약').

### 데스크톱 채팅 보기 (2026-10-01)
- **탭 안의 작은 토글**(`TabViewToggle` — 에이전트 세션만, hover·활성·채팅 중일 때만 보임 · ⚠️ 숨었을 땐 **폭 0**(opacity 만 0 이면 자리를 차지해 에이전트 탭 제목이 일찍 잘렸다))로 세션별 전환, 단축키 **⌘E**(포커스 세션 — `useTerminalShortcuts`, `e.code === 'KeyE'` · 셸 세션은 무시), 기본은 터미널(`lib/chatViews` — localStorage, 종료 세션은 `pruneChatViews`).
- **위는 채팅(읽기 전용), 아래는 진짜 터미널**(2026-10-01 사용자 결정) — `ChatView composer={false}`. 입력창을 흉내 내던 시절 Enter 씹힘·Esc 지연·이미지 칩 문제가 줄줄이 나서 걷어냈다: 이미지 ⌘V·`/`·`@`·↑·Esc·질문/권한 선택이 전부 claude 그대로다. 폰은 소프트 키보드라 입력창을 유지한다.
- 화면은 폰과 **공용 `ChatView`**(`features/terminal/components` — ⚠️ `window.oneApp` 호출 금지, 폰 번들에도 들어간다). 데이터는 `useTerminalChat` → IPC `terminal:chat:open/close` + `terminal:chat` 이벤트(main `ipc.ts` 가 창·세션별로 `subscribeChat`, 창 파괴·리로드 시 해제). 데스크톱엔 보내기·자동완성 IPC 가 없다(폰 WS 만).
- ⚠️ **xterm 은 그대로 두고 `TerminalChatPane` 이 pane 의 위쪽만 덮는다**(`.terminal__chat--split`, `bottom: --term-chat-strip`) — 언마운트 금지 규칙 유지. **보이는 pane 만** 구독한다(`chat && visible`).
  - ⚠️ **PTY 를 줄여 아래 칸에 맞추지 말 것** — 크기는 폰·전체 터미널과 공유(last-claim-wins)라 같이 작아지고, ⌘E 마다 claude 가 다시 그리며 긴 권한 창이 잘린다. 크기는 pane 그대로, **가리기만** 한다.
  - 드러낼 높이는 `TerminalView` 가 xterm 버퍼 글자를 `lib/claudeLiveRegion.ts liveRegionTop` 에 넣어 잰다(쓰기·크기 변화 rAF 코얼레스, 줄→px 는 `.xterm-screen` 기준이라 폰 크기 여백에도 맞다). 못 찾으면 직전 값 유지. 판정(2.1.286 실측 — tmux 안에선 전체 화면 모드라 입력 상자가 늘 맨 아래):
    ⚠️ 경계 줄엔 **이름표가 박힐 수 있다**(`--agent` 세션 위 경계 `──── 플러그인:에이전트 ─` — 2026-10-02 실측, `─` 만인 줄로 거르면 아래 경계부터 드러나 입력 줄이 가려졌다) → '0열 `─{3,}` 로 시작·`─` 로 끝·폭 80%↑'. ─ 비율로 거르지 말 것(폰 70열에선 이름표가 절반을 넘는다).
    입력 상자 = 0열 전체 폭 `─` 두 줄 사이 첫 줄이 `❯`/`!`(선택지 `❯ 1.` 제외) → 위 경계부터, 작업 중이면 그 위 **스피너 줄**(`[·✢✳✶✻✽*] … …`)부터 · 대화상자(질문·권한·폴더 신뢰) = 마지막 줄에서 위로 `⏺`/`✻ ` 기록 줄 전까지의 **가장 위** 전체 폭 줄(⚠️ 질문 창 안에도 전체 폭 줄이 있다 · 권한 창의 `╌` 점선은 경계 아님 · ⚠️ `❯ 글` 을 기록 줄로 보지 말 것 — 폴더 신뢰의 번호 없는 선택지 `❯ No, exit` 와 같은 모양). 화면이 덜 차면 대화상자가 중간에 떠 아래 칸이 커질 뿐이다. 작업 중 도구 줄(`⎿ $ …`)은 스피너 위라 안 넣는다(채팅에 진행 중 도구로 보인다).
  - 폰이 터미널 보기로 크기를 쥔 동안(내 pane 제안 크기 ≠ PTY 크기)은 채팅 맨 아래에 **'폰에서 터미널로 보는 중 (N×M)'** 한 줄(`.terminal__chat-remote`) — 터미널 보기의 '폰 화면' 배지가 채팅에 가려 아래 칸이 좁거나 잘린 이유가 안 보였다(2026-10-01).
  - 아래 칸 **휠은 막는다**(터미널이 스크롤되면 드러난 줄이 어긋난다 — 대화는 위 채팅에서). 채팅 보기로 들어갈 때 tmux copy-mode 를 끝낸다(올려 둔 채면 옛 화면이 보이고 키가 claude 로 안 간다).
- 포커스는 늘 xterm(`focusInput`) — 채팅을 눌러도 mouseup 에 터미널로 돌려준다(글자를 끌어 고른 중·검색 줄은 제외 — 복사). 채팅 보기의 ⌘F 는 대화 검색(아래), 닫으면 터미널로(`onReturnFocus`). 붙여넣기(⌘V 이미지 = Ctrl+V 위임)·파일 끌어다 놓기는 **터미널 보기와 같은 경로** — 단 `.terminal__chat` 안(검색 줄)의 붙여넣기는 비킨다.

### 채팅 보기 읽기·조작 (2026-10-01 — `ChatView` 공용)
- 읽기 단 `--chat-col-w`(760) — 목록 좌우 padding 을 `max(12px, (100% - 760)/2)` 로, 입력 바 안쪽도 같은 폭. 연속 도구 호출 2개 이상은 `ToolGroup`(진행 중인 것만 펼쳐 둠), Edit 상세는 diff 색, 내 메시지에 시각(`ChatItem.ts` — 파서가 jsonl `timestamp` 를 싣는다).
- 입력창(폰 — `composer`)의 자동완성: ⚠️ 키 처리는 `isComposing`/`keyCode 229` 면 건너뛴다(한글 IME). `/` = main `chatCommands.ts`(프로젝트·계정 `skills`/`commands` + 내장 몇 개, 30초 캐시) → WS `chat-commands`, `@` = `listChatFiles`(`git ls-files --cached --others --exclude-standard`, 30초 캐시, 2만 개 상한) → WS `chat-files`. 처음 칠 때 한 번 받는다. 쓰던 글은 `lib/chatDrafts`(세션별 메모리, `persistKey`)라 보기를 바꿔도 남는다. 목록 높이가 줄면(폰 키보드·데스크톱 아래 칸 확대) **바닥에 붙어 있었을 때만** 바닥을 유지한다(목록 `ResizeObserver` — 높이 변화엔 scroll 이벤트가 없다, 2026-10-02). ⚠️ puppeteer 로 확인할 때 `setViewport` 의 `isMobile`·`hasTouch` 가 바뀌면 **페이지가 새로고침**돼 재마운트로 바닥에 붙는 것처럼 보인다 — 한 번 맞춘 뒤 높이만 바꿔 잴 것. 입력창 높이(`fitInput`)는 ⚠️ **숨은 채 재지 않는다** — display:none 에서 재면 `0px` 로 박혀 min-height 가 테두리 몫(2px) 모자라 스크롤이 생겼다(2026-10-01 사용자 신고) → 보이게 될 때·폭이 바뀔 때 `ResizeObserver` 로 다시 잰다. 스크롤은 max-height 를 넘을 때만(`overflow-y` 를 JS 가 정한다 — 소수 줄높이 반올림 대비).
- 작업 중 상태 줄(폰) — `sessions/<pid>.json` status `busy` 일 때만 화면을 읽어 `parseScreenStatus`(말줄임 `…` + 괄호 꼬리, ⚠️ `❯` 입력창 줄 제외) → `chat-status`. 선택 화면과 같은 캡처 한 번. 데스크톱은 스피너·선택 화면이 아래 터미널에 그대로 보여 그리지 않는다.
- ⌘F(채팅 보기) = 대화 검색 — `TerminalView` 가 `findSignal` 을 올리고 `ChatView` 가 CSS Custom Highlight API(`::highlight(term-chat-find)`)로 칠한다(DOM 무변경). ⚠️ 검색창은 `focus()` 후 `select()` — select 만으로는 포커스가 안 온다(실측).
- 답변·코드 블록 [복사] — `Markdown copyCode`.
- 이미지 첨부 흉내(임시 폴더 저장 → 칩 → 경로 붙여넣기, `chatImages.ts`)는 2026-10-01 데스크톱을 진짜 터미널 입력으로 바꾸며 걷어냈다 — 되살리지 말 것. 파서는 이미지가 있는 입력의 `[Image #N]` 자리 표시를 걷고 '이미지 N장' 꼬리표로 보인다.
- 서브에이전트(Agent/Task) 호출은 도구 묶음에서 빼 한 줄로(진행 중 스피너). 할 일 패널은 최신 TodoWrite 상세(`[x]/[~]/[ ]` 줄)를 읽는다 — ⚠️ 2026-10-01 기준 이 환경의 claude(2.1.286)엔 TodoWrite 가 없어(최근 기록 200개에 0회) 실제로는 뜨지 않는다.

## 에이전트 추가
- `shared/types.ts` 의 `TerminalAgentId`·`TERMINAL_AGENT_NAMES` + `agents.ts` 의 `AGENTS` **두 곳만**. 감지는 `zsh -lc "whence -p"` 1회 캐시, 미설치는 조용히 제외.
- `presetsForWorkspace`·`agentIdFromCommand` 는 **`shared/types.ts`** — 데스크톱·MO 판정이 갈라지면 안 된다.
