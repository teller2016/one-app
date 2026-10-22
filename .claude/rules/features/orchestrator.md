---
paths:
  - "src/main/features/orchestrator/**"
  - "src/renderer/features/orchestrator/**"
---

# 루트 세션 (오케스트레이터)

고정 루트 탭의 claude 가 **원앱 MCP 서버**로 다른 claude 세션(워커)을 찾고(`list_sessions`)·읽고(`read_session`)·지시를 넣고
(`send_to_session`), 셸 탭까지 포함한 터미널을 다룬다(`list_terminals`·`list_workspaces`·`run_preset`·`close_session`).
보고는 워커 → 루트 **Claude Code 내장 SendMessage**. 결정·실측의 정본은 기획서 아티팩트
'루트 세션'(https://claude.ai/artifact/NeN3YoiWgy1E5TiP7zkvxE). 지금은 **1a**(서버·도구 7개·손으로 여는 루트 탭).

## 구조
- main `features/orchestrator/`: `server.ts`(MCP) · `tools.ts`(세션 도구 3개) · `terminalTools.ts`(터미널 도구 4개) · `toolKit.ts`(결과 포맷·상태 해석·제외 세션) ·
  `guard.ts`(순수 판정 + `guard.test.ts`) · `root.ts`(루트 폴더·신뢰·실행 명령·열기) ·
  `rootGuide.ts`(지침서 기본본) · `store.ts`(토큰·루트 세션 id) · `ipc.ts`(`orchestrator:open-root`·`orchestrator:root`, 폰에는 안 연다).
- 터미널 쪽은 **`features/terminal/index.ts`(공개 API)로만** 쓴다 — `terminalOverview`·`sendChatText`·`sessionStyledScreen`·`sessionCommands`·
  `createSession`·`killSession`·`dockShellId` 등.
- 렌더러 `features/orchestrator/` — `RootCommand`(⌘P '루트 세션 열기' 등록만) · `lib/rootSession.ts`(`useRootSessionId` 구독 · `useOpenRoot` 열기 —
  ⌘P 와 LNB 가 같은 것을 쓴다). 터미널 LNB **맨 위 '루트' 고정 칸**(2026-10-22, 선택 종류 `root`)이 루트 세션만 보여 주고 '기타'에서는 뺀다 —
  main 은 `setRootSessionId` 때 `orchestrator:root` 를 방송하고, 처음 그릴 때는 `orchestrator:root` 로 묻는다.

## 지시 입력 (`send_to_session`)
- 길은 폰 채팅과 같은 `sendChatText`(bracketed paste + 250ms 뒤 Enter). ⚠️ 글은 **`sanitizeInstruction` 을 거친다** — 글 안의 `ESC[201~`
  (붙여넣기 끝 표시)가 살아 있으면 그 뒤가 **키 입력으로** 들어간다.
- **작업 중이어도 넣는다** — claude 가 대기열(`queue-operation`)에 두었다가 턴이 끝나면 실행한다. 슬래시 명령도 명령으로 실행된다
  (2026-10-22 실측). 원앱이 따로 들고 있지 않는다(`delivered: 'queued'`).
- 가드 순서(`checkSend`): 루트 자신·독 셸·claude 없음 → 질문·권한·플랜 창(claude 가 `waiting` 일 때만 `parseScreenPrompt`) →
  입력 상자를 못 찾음(신뢰 확인 창 등 — Enter 가 선택지를 고른다). 처음 걸린 이유를 그대로 루트에 돌려준다(지침서: 재시도 말고 사용자에게 전달).
- **사용자가 그 탭에 쓰는 중이어도 막지 않는다**(2026-10-22 사용자 결정 — 처음엔 '최근 10초 입력·입력란에 글'이면 거부했다).
  입력란에 쓰던 글이 있으면 **claude 의 입력 보관(Ctrl+S, `STASH_KEY`)으로 치운 뒤** 붙여넣는다 — claude 가 다음 제출 뒤 그 글을 입력란에
  되돌린다(쉬는 중·작업 중 모두 실측, 화면에 `› stashed`). 안 치우면 쓰던 글 뒤에 지시가 붙어 한꺼번에 제출된다.
  ⚠️ **입력란이 비었으면 Ctrl+S 를 누르지 않는다** — 이미 보관된 글이 있으면 그걸 되살려 지시와 섞일 수 있다(미확인, 피한다).
- 입력 상자 판정 = `capture-pane -e`(`sessionStyledScreen`) → `inputBoxText`. 실측(2.1.307): 입력 줄은 **전체 폭 `─` 경계 다음 줄의
  `❯` + NBSP**, 제안 문구(`Try "…"`·다음 입력 제안)는 **SGR 2(흐림)**, 직접 친 글은 흐리지 않다, 지난 입력 줄은 배경색(`48;5;237`·
  트루컬러면 `48;2;55;55;55`) + 보통 공백. ⚠️ 색 지정 인자(`38;2;r;g;b`의 2)를 흐림으로 읽지 말 것(`solidText` 가 건너뛴다).

## 터미널 도구 (`terminalTools.ts`, 2026-10-22)
"다른 워크트리의 run dev 끄고 지금 워크트리에서 켜 줘" 같은 지시용. **실행·닫기 모두 승인 없이 바로** 한다(사용자 결정) — 대신
토스트로 알린다(실행은 [보기]로 그 탭을 연다). 루트 자신·독 패널 셸은 목록에서 빠지고 닫기도 거부한다(`excludedIds`).
- `list_terminals` 의 `commands` = 탭 안에서 지금 도는 명령 — `terminal/processes.ts` 가 `ps -A` **한 번**으로 탭 루트 pid 의 자손을 훑어
  **셸이 아닌 첫 자손**의 인자를 준다(`sessionCommands`, 테스트 `processes.test.ts`). 셸만 있으면 빈 배열. ⚠️ 에이전트 프리셋이
  계정 선택(셸 함수의 `read`)에 멈춰 있으면 자식이 없어 빈 배열이다 — 탭의 `agent` 로 구분한다.
- `run_preset` 은 프리셋 바와 **같은 인자**로 세션을 만든다(`agentIdFromCommand`·명령·이름 — 렌더러 `TerminalSection` runPreset).
  `cwd` 는 루트가 넘긴 경로를 믿지 않고 **git 에 직접 물어**(`listWorktreesBrief`, 캐시 아님) 등록된 워크트리인지 확인한다. 프리셋은 id 또는
  이름(대소문자 무시), 그 워크스페이스에서 쓸 수 있는 것(전역 + 지정, 바에서 숨긴 것 포함)만. 에이전트 프리셋은 사용자의 계정 선택 화면을 거친다.
- 실측(10-22 dev): 루트에 "sleep 도는 탭이랑 계정 선택에 멈춘 claude 탭 닫고 claude 프리셋 새로 실행해줘" → list_terminals → close ×2 →
  run_preset 을 스스로 골라 26초에 끝내고 닫은 것·연 것을 보고했다.

## 루트 탭
- 실행: `CLAUDE_CONFIG_DIR=~/.claude command claude --name root --mcp-config <폴더>/mcp.json --settings '{"crossSessionInbound":"accept"}'
  --allowedTools mcp__oneapp ListAgents SendMessage Read Grep Glob --disallowedTools Edit Write NotebookEdit Bash Agent`.
  ⚠️ `--disallowedTools`·`--allowedTools` 는 목록을 받는 플래그 — **막는 목록을 맨 뒤에** 둔다. ⚠️ mcp.json 의 `"type": "http"` 를 빼면 stdio 로 읽혀 조용히 빠진다.
- `crossSessionInbound: accept` — 권한 확인을 건너뛰는 세션은 같은 종류의 메시지만 바로 받는다. 루트는 bypass 가 아니라서 이 설정이 없으면 워커 보고가 승인 대기로 간다.
- 폴더 `userData/root`(dev `root-dev`) — `mcp.json` 은 열 때마다 0600 으로 다시 쓴다(토큰 평문). `CLAUDE.md` 는 `syncGuide`:
  없으면 기본본을 쓰고, 있으면 **마지막으로 쓴 기본본 그대로일 때만**(해시 `.guide-default.sha256`) 새 기본본으로 바꾼다 — 사용자가 고쳤으면
  그대로 둔다(사용자 수정 우선). 도구를 더해 `rootGuide.ts` 를 고치면 손대지 않은 폴더는 다음 열기에 따라온다. 떠 있는 루트는 다시 열어야 읽는다.
- **폴더 신뢰**: 처음 여는 폴더는 `--dangerously-skip-permissions` 여도 신뢰 창이 뜬다(실측) → `ensureTrusted` 가 `~/.claude/.claude.json` 의
  `projects[<realpath>].hasTrustDialogAccepted` 를 쓴다(femc-wt.sh 와 같은 방식). ⚠️ 그 파일은 떠 있는 claude 들이 수시로 다시 쓴다 —
  이미 표시돼 있으면 안 건드리고, 읽은 뒤 mtime·크기가 바뀌었으면 덮지 않고 다시 읽는다(3번). 실패해도 신뢰 창이 한 번 뜰 뿐.
- ⚠️ **재부팅 복원 안 함** — 복원 명령(`resumeCommand`)은 `--disallowedTools` 를 잇지 못해 루트가 제한 없는 claude 로 살아난다.
  `terminal/resumeCommand.ts` 의 `isRevivable` 이 도구를 막고 띄운 claude 의 복원 기록을 남기지 않는다(루트 전용 예외 아님 — 일반 규칙). 1b 에서 제대로 복원한다.

## MCP 서버
- 127.0.0.1:18430(dev 18431) · **stateless**(요청마다 McpServer + 트랜스포트) — 앱을 다시 켜도 tmux 안의 루트가 재연결 없이 다음 호출을 성공한다(실측).
- 방어: Host 가 127.0.0.1/localhost:포트 아니면 403 · Origin 헤더 있으면 403 · Bearer(`lib/util` `timingEqual`). GET/DELETE 는 405.
- 토큰은 `orchestrator.json`(safeStorage, 개발·설치본 공유). ⚠️ 서버 시작은 **`whenSecretsReady()` 뒤** — 기동 경로에서 키체인을 읽으면 main 이 멈춘다.
- dev 분리: 포트 18431 · 서버 이름 `oneapp-dev` · 루트 이름 `root-dev` · 폴더 `root-dev` · 루트 세션 id 는 `runtimeFile('orchestrator-root.json')`.

## 실측 방법 (2026-10-21~22)
- 내 셸의 `CLAUDECODE`·`CLAUDE_CODE_MESSAGING_SOCKET` 이 새 세션에 새지 않게 **`env -i` 로 띄운 전용 tmux 소켓** + haiku + 의존성 없는 가짜 MCP 서버.
- '작업 중' 상태는 도구 없이 **긴 답변**을 쓰게 해서 만든다 — probe claude 도 foreground `sleep` 을 막고 백그라운드로 돌려 턴이 곧바로 끝난다.
- 테스트 대화 기록(`~/.claude/projects/*probe*`)과 FEMC 저장소에 남은 기록은 내용(사람 입력)을 확인한 뒤 지운다.

## 1b 에서 할 일
작업 원장·`list_tasks`·완료 뒤 보고 요청 · 지시 알림(탭 표시·토스트) · `focus_session` · 고정 탭(세션 패널 맨 위·자동 시작·재시작 제한·재부팅 복원) · 무인 연쇄 가드(대화 기록 `origin.kind` 가 `peer` 면 승인 창).
