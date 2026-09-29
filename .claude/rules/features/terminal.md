---
paths:
  - "src/main/features/terminal/**"
  - "src/renderer/features/terminal/**"
  - "src/main/features/workspaces/**"
  - "src/mobile/**"
  - "src/shared/terminal-protocol.ts"
---

# 터미널 + MO(모바일) 연동 — 핵심 규칙

`renderer/features/terminal` + `main/features/terminal` + `src/mobile`. Superset 스타일 **에이전트 세션 오케스트레이터** — 여러 claude 세션을 병렬 관리하고, 자리를 비우면 폰으로 같은 세션을 이어서 쓴다.

> **경위·실측 수치·시도와 폐기 기록은 `docs/terminal-notes.md`** (절 제목 동일). 여기는 지금도 유효한 불변식·함정만 남긴다. 새 함정 발견 시: 여기에 한 줄 요약, 상세는 노트에.

## 구조
- **main `pty.ts` 가 PTY 단일 소유자**(`Map<id, 세션>`) — 데스크톱(IPC)·모바일(WS)은 각자 attach. 세션은 창과 무관, tmux 면 앱 재시작에도 산다.
- tmux 는 전용 소켓(`-L oneapp`) + 전용 conf(`tmux.ts` 가 덮어쓰고 살아있는 서버엔 `source-file`). 메타는 sidecar `userData/terminal-sessions.json`, 시작 시 `restoreSessions()` 가 `list-sessions` 와 대조.

## tmux 백엔드 불변식
- ⚠️ conf 의 `terminal-features ",xterm-256color:RGB:sync:hyperlinks"` **지우지 말 것**(`sync` 없으면 중간 프레임 노출).
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
- ⚠️ **에이전트는 `TMUX` 를 지우고 실행**(남기면 256색 폴백), 셸 세션은 안 감싼다. 색이 이상하면 SGR 유형(`38;2`/`38;5`)부터. 상세: 노트 '⚠️ 에이전트 실행은 `TMUX` 를 지우고 띄운다 (트루컬러)'.
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
- 탭바 = '가라앉은 선반 + 장 탭'(⑧안). ⚠️ 반려안(연결형·세그먼트+장식·칩+박스) 금지. ⌘1..9 는 `tabView.tabs` 순.
- 상세: 노트 '분할(스플릿) 그룹 — 탭 드래그로 여러 pane 동시 표시'.

## memo 계약 (pane·탭바·LNB)
- `TerminalView` 는 **`sessionId` 등 원시값만**(객체·`cwd` 안 넘김). 프리셋은 `presetsByCwd` 맵, 없으면 `NO_PRESETS`, 콜백 `(cwd, preset)`.
- LNB 집계는 `byCwd` 한 번에. ⚠️ 워크트리 폴링은 같으면 **이전 객체 유지**(JSON.stringify).
- ⚠️ **워크트리 폴링은 경량 조회**(`workspaces.worktrees(id, false)` → `listWorktreesBrief`), `dirty` 는 필요한 순간에만 상세로.
- 상세: 노트 '⚠️ pane·탭바·LNB 는 `memo` 다'.

## 상단 공용 바·탭바 액션
- 툴바는 **탭바 아래 공용 바 하나**. 프리셋 대상 = 포커스 세션 cwd, 없으면 선택 워크트리.
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
- 리사이즈·`SIDE_SNAP_W`(140) 축소(패널 48·타일 34)·grip 토글은 **`Sidebar.tsx` 와 같은 규칙**. 저장은 놓을 때 1회 `Math.round`. ⚠️ 접힌 채 끝나면 펼침 폭을 드래그 시작 값으로.
- 축소 타일 = 이니셜(CJK 1자), ⚠️ 닫기(×) 없음(`⌘⇧W`). ⚠️ `side-grip` 실폭 0(`margin: 0 -5px`), ⚠️ 드로어 `margin-left: 8px`·`padding: 8px 8px 0 0` 유지.
- 작업중 표시 = `spinner spinner--xs` / 축소 `BusyArc`(`terminal__sq-arc`). ⚠️ **`busy` 가 아니라 `working`** 을 볼 것(셸 제외). ⚠️ 아크를 원형 링·conic-gradient 로 바꾸지 말 것.
- 세션 목록은 탭바(`SessionTabs`). 이름 변경 = **우클릭 [이름 변경]** → `Input bare`(`terminal:rename`), `select()`. ⚠️ `bare` 가 `min-height` 하한을 지워야 탭이 안 부푼다.
- 상세: 노트 '세션 패널 (좌측)'·'세션 패널은 드래그 리사이즈 + 완전 축소'.

## xterm 구성
- addon(fit·unicode11·webgl·web-links·search)은 전부 **devDependencies**. ⚠️ **`allowProposedApi: true` 필수**(없으면 흰 화면).
- webgl 은 `term.open()` **이후**, `onContextLoss` 에 `dispose()`, 실패는 try/catch.
- 링크는 `window.oneApp.openExternal`(http/s), Finder 는 `terminal:reveal-cwd`(세션 id 만).
- 검색 하이라이트는 `#RRGGBB` → `mixHex` 선합성. ⚠️ 검색바는 **오버레이**(PTY 행 불변).
- ⚠️ **xterm 6**: 네이티브 스크롤 없음(`scrollLines`·`viewportY`·`onScroll`) · 전역 스크롤바 CSS 안 먹음 · 배경은 `theme.background: 'rgba(0,0,0,0)'`(`'transparent'` 금지) + `allowTransparency`. 오버라이드는 특정도 한 단계 좁게.
- ⚠️ **텍스처 아틀라스는 pane 공유물** — `clearTextureAtlas()` 는 **마운트 시 `monoFontLoaded` false 일 때만**. 복귀는 `term.refresh(0, rows-1)` + ⚠️ **rAF 한 번 더**(DEC 2026).
- 색은 `buildTheme()` 이 다크 패널 토큰에서(hex 금지, 마젠타·시안 예외). **JetBrains Mono NL 13px / lineHeight 1.0** ⚠️ 자연 줄높이에 곱해지고 `<1` 거부. 폰트 로드 후 `fit()`.
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
- 크기 **last-claim-wins + 재주장**(데스크톱 창 포커스 시, MO visible 에서 `resized` 시).
- claude 는 대체 화면 + 마우스 트래킹 유지 — 스크롤을 흉내내지 말고 휠을 넘긴다.
- 상세: 노트 'attach 프로토콜'.

## MO 접속·서버
- **Tailscale** 도달, 앱은 토큰만: `?token=` → `timingSafeEqual` → **HttpOnly 쿠키**(1년·Lax), WS upgrade 재검증, 30초 ping. 토큰·포트(18317)는 `safeStorage`/`terminal.json`.
- ⚠️ **회사 VPN(full-tunnel) 켜면 MO 끊김 — 미해결**(원본 .ovpn 유지, 시도 2건 롤백).
- HTTPS `tls.ts`(`tailscale cert`, 실패 시 http) — PWA·clipboard 전제. ⚠️ URL 은 인증서 도메인만, wss 는 `location.protocol` 따라. `ensureTls()` → `setSecureContext()`. ⚠️ `--cert-file/--key-file` 명시. manifest·아이콘만 `PUBLIC_PATHS`.
- ⚠️ **`startServer` 는 진행 중 promise 로 직렬화**(`stopServer` 는 완료 대기, listen 후 `getServerEnabled()` 재확인).
- ⚠️ **WS 백프레셔**(> 2MB): `/term` 은 data 만 버리고 `needsResync`, `/rpc` 는 소켓을 끊는다.
- 상세: 노트 'MO 접속'.

## MO 터미널 페이지 (`src/mobile`)
- Vite 엔트리 `mobile_window`(base `/terminal/`). '버튼 하나 + 바텀시트'(`sheetMode`). 재접속 백오프 + `visibilitychange`.
- ⚠️ `workspaces`·변경사항은 **요청 시에만**(폴링 금지). 변경사항은 **`/rpc`**(`handleShared`), **커밋 없음**, 경로는 `rtl` + ⚠️ `U+2066/2069`.
- ⚠️ **뒤로가기는 오버레이만** — 열 때 `pushState`, 닫기는 언제나 `history.back()`, 숨김은 `popstate` 의 `hideTopOverlay()` 에서만. `closeSheet()` 는 `sheetMode` 즉시 비움.
- ⚠️ 영역 밖 세션은 `(다른 영역)` 으로 남긴다. `mo:lastSession` 우선. ⚠️ 자동 attach 는 **`!attachedId && !pendingAttachId`** 일 때만.
- **키바는 키보드가 떠 있을 때만** — 뷰포트 높이 감소(`KEYBOARD_MIN_DELTA` 120px) 판정, ⚠️ focus/blur 금지, 토글마다 `syncViewport()`.
- 핀치 글자 크기(기본 6px), ⚠️ 핀치 touchend 를 탭 처리 금지. 붙여넣기는 secure context 만.
- 대기 알림·배지·wakeLock 은 `stableWaiting` 하나를 본다. ⚠️ 안드로이드는 `public/sw.js`(fetch 미개입) `showNotification`. 권한은 `#notifyBar`. secure context 전용.
- ⚠️ **`DA_REPLY_RE` 는 MO·데스크톱 둘 다 필수**, ESC 는 `String.fromCharCode(27)`.
- ⚠️ 예측 입력 억제 `autocomplete=off`+`autocapitalize=none`+`inputmode="url"`. `.composition-view` 는 **MO 에만**(15px, `!important`).
- 폰트 JetBrains Mono NL + `lineHeight 1.0` + **Unicode11 + allowProposedApi 한 쌍**. 키보드: `interactive-widget=resizes-content` + `visualViewport`/`innerHeight` 작은 값 + `overscroll-behavior: none`. ⚠️ 텍스트 기호는 VS16 + 컬러 이모지 폰트.
- 상세: 노트 'MO 터미널 페이지 UI'·'자리를 비운 동안 알기'.

## 에이전트 추가
- `shared/types.ts` 의 `TerminalAgentId`·`TERMINAL_AGENT_NAMES` + `agents.ts` 의 `AGENTS` **두 곳만**. 감지는 `zsh -lc "whence -p"` 1회 캐시, 미설치는 조용히 제외.
- `presetsForWorkspace`·`agentIdFromCommand` 는 **`shared/types.ts`** — 데스크톱·MO 판정이 갈라지면 안 된다.
