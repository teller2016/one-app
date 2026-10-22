---
paths:
  - "src/main/features/orchestrator/**"
  - "src/renderer/features/orchestrator/**"
---

# 루트 세션 (오케스트레이터)

고정 루트 탭의 claude 가 **원앱 MCP 서버**로 다른 claude 세션(워커)을 찾고(`list_sessions`)·읽고(`read_session`)·지시를 넣고
(`send_to_session`), 셸 탭까지 포함한 터미널을 다룬다(`list_terminals`·`list_workspaces`·`run_preset`·`close_session`).
맡긴 일은 작업 원장에 남고(`list_tasks`), 워커가 끝나면 원앱이 4줄 보고를 요청해 워커 → 루트 **Claude Code 내장 SendMessage** 로 돌아온다.
결정·실측의 정본은 기획서 아티팩트 '루트 세션'(https://claude.ai/artifact/NeN3YoiWgy1E5TiP7zkvxE).
지금은 **1a · 1b · 2단계 · 3단계 전부**(고정 루트 탭 — 자동 시작·이어 띄우기·⌘0 · 보고 한 바퀴·무인 연쇄 가드 · 세션·워크트리 만들기 · 배포·PR·결재·일정 화면 열기).

## 구조
- main `features/orchestrator/`: `server.ts`(MCP) · `tools.ts`(세션 도구 5개) · `terminalTools.ts`(터미널 도구 4개) ·
  `toolKit.ts`(결과 포맷·상태 해석·제외 세션·탭 순서·회사 저장소 판정·대화 기록 꼬리 읽기 `readTailLines`) · `deliver.ts`(워커에 글 넣기 — 지시와 보고 요청 공용) ·
  `tasks.ts`(작업 원장 + 감시) · `taskScan.ts`(대화 기록 순수 판정 + 테스트) · `approve.ts`(무인 연쇄 가드) · `confirm.ts`(승인 대기열 + 테스트) ·
  `createTools.ts`(만들기 도구 3개) · `deployTools.ts`(배포 도구 3개) · `prTools.ts`(PR 도구 3개) · `officeTools.ts`(결재·일정 도구 5개) · `openRequest.ts`(기능 화면 열기 요청 — `app:open-request`) · `ticketPlan.ts`(위치 판정 순수 + 테스트) · `worktreeSetup.ts`(femc-wt.sh 실행) ·
  `guard.ts`(입력 가드 순수 판정 + `guard.test.ts`) · `root.ts`(루트 폴더·신뢰·실행 명령·열기) ·
  `rootGuide.ts`(지침서 기본본) · `rootLife.ts`(자동 시작·종료 판정·재시작 상한·대화 id·⌘0) · `store.ts`(토큰·루트 런타임 기록) · `ipc.ts`(open-root·root·tasks·confirm:list/answer·tab-orders, 폰에는 안 연다).
- 터미널 쪽은 **`features/terminal/index.ts`(공개 API)로만** 쓴다 — `terminalOverview`·`sendChatText`·`sessionScreen`(`{styled: true}` = SGR 포함)·`sessionCommands`·
  `createSession`·`killSession`·`dockShellId`·`revealSession`(팝아웃·독이면 그 창, 아니면 메인 창 탭)·`whenSessionsRestored` 등.
- 렌더러 `features/orchestrator/` — `RootCommand`(⌘P '루트 세션 열기' 등록만) · `lib/rootSession.ts`(`useRootSessionId` 구독 · `useOpenRoot` 열기 —
  ⌘P 와 LNB 가 같은 것을 쓴다). 터미널 LNB **맨 위 '루트' 고정 칸**(2026-10-22, 선택 종류 `root`)이 루트 세션만 보여 주고 '기타'에서는 뺀다 —
  main 은 `setRootSessionId` 때 `orchestrator:root` 를 방송하고, 처음 그릴 때는 `orchestrator:root` 로 묻는다.
  `lib/rootTasks.ts`(`useRootTaskSessionIds` — 워커 탭의 '루트' 표시 · `reportTabOrders`) · `RootConfirmHost`(승인 모달, App 셸에 한 번).

## 지시 입력 (`send_to_session`)
- 길은 폰 채팅과 같은 `sendChatText`(bracketed paste + 250ms 뒤 Enter). ⚠️ 글은 **`sanitizeInstruction` 을 거친다** — 글 안의 `ESC[201~`
  (붙여넣기 끝 표시)가 살아 있으면 그 뒤가 **키 입력으로** 들어간다.
- ⚠️ **같은 세션에 넣기는 한 번에 하나**(`deliver.ts` 세션별 줄 — 2026-10-22 검토) — 지시와 감시의 보고 요청이 겹치면 확인(화면 읽기)과 붙여넣기 사이에
  다른 붙여넣기가 끼어 두 글이 한 입력란에서 함께 제출된다. 줄은 Enter 가 나간 뒤(`CHAT_SUBMIT_DELAY_MS` + 50ms) 비운다. 그래서 **원장의 읽기 시작점
  (offset)은 deliver 가 붙여넣기 직전에 잰 값**을 쓴다 — 돌아온 뒤 재면 이미 기록된 지시 줄을 지나쳐 '지시가 읽혔다'를 못 맞춘다.
- **작업 중이어도 넣는다** — claude 가 대기열(`queue-operation`)에 두었다가 턴이 끝나면 실행한다. 슬래시 명령도 명령으로 실행된다
  (2026-10-22 실측). 원앱이 따로 들고 있지 않는다(`delivered: 'queued'`).
- 가드 순서(`checkSend`): 루트 자신·독 셸·claude 없음 → 질문·권한·플랜 창(claude 가 `waiting` 일 때만 `parseScreenPrompt`) →
  입력 상자를 못 찾음(신뢰 확인 창 등 — Enter 가 선택지를 고른다). 처음 걸린 이유를 그대로 루트에 돌려준다(지침서: 재시도 말고 사용자에게 전달).
- **사용자가 그 탭에 쓰는 중이어도 막지 않는다**(2026-10-22 사용자 결정 — 처음엔 '최근 10초 입력·입력란에 글'이면 거부했다).
  입력란에 쓰던 글이 있으면 **claude 의 입력 보관(Ctrl+S, `STASH_KEY`)으로 치운 뒤** 붙여넣는다 — claude 가 다음 제출 뒤 그 글을 입력란에
  되돌린다(쉬는 중·작업 중 모두 실측, 화면에 `› stashed`). 안 치우면 쓰던 글 뒤에 지시가 붙어 한꺼번에 제출된다.
  ⚠️ **입력란이 비었으면 Ctrl+S 를 누르지 않는다** — 이미 보관된 글이 있으면 그걸 되살려 지시와 섞일 수 있다(미확인, 피한다).
- 입력 상자 판정 = `capture-pane -e`(`sessionScreen(id, {styled: true})`) → `inputBoxText`. 실측(2.1.307): 입력 줄은 **전체 폭 `─` 경계 다음 줄의
  `❯` + NBSP**, 제안 문구(`Try "…"`·다음 입력 제안)는 **SGR 2(흐림)**, 직접 친 글은 흐리지 않다, 지난 입력 줄은 배경색(`48;5;237`·
  트루컬러면 `48;2;55;55;55`) + 보통 공백. ⚠️ 색 지정 인자(`38;2;r;g;b`의 2)를 흐림으로 읽지 말 것(`solidText` 가 건너뛴다).

## 터미널 도구 (`terminalTools.ts`, 2026-10-22)
"다른 워크트리의 run dev 끄고 지금 워크트리에서 켜 줘" 같은 지시용. **실행·닫기 모두 승인 없이 바로** 한다(사용자 결정) — 대신
토스트로 알린다(실행은 [보기]로 그 탭을 연다). 루트 자신·독 패널 셸은 목록에서 빠지고 닫기도 거부한다(`excludedIds`).
- `list_terminals` 의 `commands` = 탭 안에서 지금 도는 명령 — `terminal/processes.ts` 가 `ps -A` **한 번**으로 탭 루트 pid 의 자손을 훑어
  **셸이 아닌 첫 자손**의 인자를 준다(`sessionCommands`, 테스트 `processes.test.ts`). 셸만 있으면 빈 배열. 셸 판정(`isShellProcess`)은 옵션만 있거나
  `-c` 래퍼일 때만 — `bash ./deploy.sh` 처럼 스크립트를 돌리는 셸은 그 자체가 명령이다(예전엔 그 안의 `sleep` 을 보고했다). ⚠️ 에이전트 프리셋이
  계정 선택(셸 함수의 `read`)에 멈춰 있으면 자식이 없어 빈 배열이다 — 탭의 `agent` 로 구분한다.
- `run_preset` 은 프리셋 바와 **같은 인자**로 세션을 만든다(`agentIdFromCommand`·명령·이름 — 렌더러 `TerminalSection` runPreset).
  `cwd` 는 루트가 넘긴 경로를 믿지 않고 **git 에 직접 물어**(`listWorktreesBrief`, 캐시 아님) 등록된 워크트리인지 확인한다. 프리셋은 id 또는
  이름(대소문자 무시), 그 워크스페이스에서 쓸 수 있는 것(전역 + 지정, 바에서 숨긴 것 포함)만. 에이전트 프리셋은 사용자의 계정 선택 화면을 거친다.
- 실측(10-22 dev): 루트에 "sleep 도는 탭이랑 계정 선택에 멈춘 claude 탭 닫고 claude 프리셋 새로 실행해줘" → list_terminals → close ×2 →
  run_preset 을 스스로 골라 26초에 끝내고 닫은 것·연 것을 보고했다.

## 루트 탭
- 실행: `CLAUDE_CONFIG_DIR=~/.claude command claude --name root --mcp-config <폴더>/mcp.json --strict-mcp-config --permission-mode manual
  --settings '{"crossSessionInbound":"accept"}' --allowedTools mcp__oneapp ListAgents SendMessage Read Grep Glob --disallowedTools Edit Write NotebookEdit Bash Agent`.
  - `--strict-mcp-config` — 루트엔 원앱 MCP 만(사용자·프로젝트 설정의 DB·브라우저 MCP 를 싣지 않는다). 실측 `/mcp`: `1 server · oneapp-dev 23 tools`.
  - `--permission-mode manual` — 사용자 설정의 기본 모드(`defaultMode: auto`)를 따르면 허용 목록 밖 도구도 자동 실행된다. ⚠️ 2.1.307 의 선택지에 `default` 가 없다
    (`acceptEdits·auto·bypassPermissions·manual·dontAsk·plan`) — '묻기'는 `manual`. 화면 상태 줄에 `⏸ manual mode on`.
  ⚠️ `--disallowedTools`·`--allowedTools` 는 목록을 받는 플래그 — **막는 목록을 맨 뒤에** 둔다. ⚠️ mcp.json 의 `"type": "http"` 를 빼면 stdio 로 읽혀 조용히 빠진다.
- `crossSessionInbound: accept` — 권한 확인을 건너뛰는 세션은 같은 종류의 메시지만 바로 받는다. 루트는 bypass 가 아니라서 이 설정이 없으면 워커 보고가 승인 대기로 간다.
- 폴더 `userData/root`(dev `root-dev`) — `mcp.json` 은 열 때마다 0600 으로 다시 쓴다(토큰 평문). `CLAUDE.md` 는 `syncGuide`:
  없으면 기본본을 쓰고, 있으면 **마지막으로 쓴 기본본 그대로일 때만**(해시 `.guide-default.sha256`) 새 기본본으로 바꾼다 — 사용자가 고쳤으면
  그대로 둔다(사용자 수정 우선). 도구를 더해 `rootGuide.ts` 를 고치면 손대지 않은 폴더는 다음 열기에 따라온다. 떠 있는 루트는 다시 열어야 읽는다.
- **폴더 신뢰**: 처음 여는 폴더는 `--dangerously-skip-permissions` 여도 신뢰 창이 뜬다(실측) → `ensureTrusted` 가 `~/.claude/.claude.json` 의
  `projects[<realpath>].hasTrustDialogAccepted` 를 쓴다(femc-wt.sh 와 같은 방식). ⚠️ 그 파일은 떠 있는 claude 들이 수시로 다시 쓴다 —
  이미 표시돼 있으면 안 건드리고, 읽은 뒤 mtime·크기가 바뀌었으면 덮지 않고 다시 읽는다(3번). 실패해도 신뢰 창이 한 번 뜰 뿐.
- ⚠️ **일반 재부팅 복원(terminal/resume.ts)에서는 빠진다** — 그 복원 명령(`resumeCommand`)은 `--disallowedTools` 를 잇지 못해 루트가 제한 없는 claude 로
  살아난다. `isRevivable` 이 도구를 막고 띄운 claude(`--disallowedTools`, 직접 띄운 claude 의 `--tools` — femc 의 `--tools` 는 femc 가 다시 붙인다)의 복원 기록을 남기지 않고(루트 전용 예외 아님 — 일반 규칙), 대신 `rootLife.ts` 가 앱 시작 때
  `openRootSession` 으로 **같은 플래그 + `--resume <대화 id>`** 로 다시 띄운다(아래 '고정 탭 수명').

## MCP 서버
- 127.0.0.1:18430(dev 18431) · **stateless**(요청마다 McpServer + 트랜스포트) — 앱을 다시 켜도 tmux 안의 루트가 재연결 없이 다음 호출을 성공한다(실측).
- 방어: Host 가 127.0.0.1/localhost:포트 아니면 403 · Origin 헤더 있으면 403 · Bearer(`lib/util` `timingEqual`). GET/DELETE 는 405.
- 토큰은 `orchestrator.json`(safeStorage, 개발·설치본 공유). ⚠️ 서버 시작은 **`whenSecretsReady()` 뒤** — 기동 경로에서 키체인을 읽으면 main 이 멈춘다.
- dev 분리: 포트 18431 · 서버 이름 `oneapp-dev` · 루트 이름 `root-dev` · 폴더 `root-dev` · 루트 세션 id 는 `runtimeFile('orchestrator-root.json')`.

## 실측 방법 (2026-10-21~22)
- 내 셸의 `CLAUDECODE`·`CLAUDE_CODE_MESSAGING_SOCKET` 이 새 세션에 새지 않게 **`env -i` 로 띄운 전용 tmux 소켓** + haiku + 의존성 없는 가짜 MCP 서버.
- '작업 중' 상태는 도구 없이 **긴 답변**을 쓰게 해서 만든다 — probe claude 도 foreground `sleep` 을 막고 백그라운드로 돌려 턴이 곧바로 끝난다.
- 테스트 대화 기록(`~/.claude/projects/*probe*`)과 FEMC 저장소에 남은 기록은 내용(사람 입력)을 확인한 뒤 지운다.

## 작업 원장·보고 한 바퀴 (`tasks.ts`, 1b-1 — 2026-10-22)
- 상태: `dispatched`(넣음) → `working` → [`waiting_prompt` — 워커에 질문 창, 사용자가 답한다] → `report_requested` → `reported`.
  닫힘: `done`(보고 생략·요청 실패·보고 없이 턴 끝·다음 지시와 합침·지시가 안 읽힘 10분 — `note` 에 이유) · `gone`(탭 닫힘·claude 끝).
  원장은 `runtimeFile('orchestrator-tasks.json')`(인스턴스별) · 7일·50개 보존. 열린 일이 있을 때만 3초마다 감시한다.
- **끝남 판정** = 우리 지시가 대화 기록에 읽혔고(`taskScan.scanWorker`) 그 뒤 답이 나왔고 claude 상태 파일 `status` 가 idle 로 **두 번 연속**.
  대기열에 들어간 지시는 그 차례가 끝나야 끝이다. 화면 휴리스틱(pty status)은 쓰지 않는다.
- ⚠️ **여러 줄 붙여넣기는 대화 기록에 `\n\n<pasted_content id="…">\n본문\n</pasted_content>` 로 감싸 남는다**(한 줄은 그대로) — 앞머리 비교 전에 벗긴다.
- **보고 요청은 지시 꼬리가 아니라 끝난 뒤 따로, 한 줄로** 넣는다(`reportRequest`). 실측(haiku)에서 두 번 되물었다:
  여러 줄이면 claude 가 `<pasted_content>`(=사용자가 안 썼을 수 있는 글)로 다뤄 "4줄을 채워 주세요"라고 되묻고,
  티켓 키만 쓰면 워커가 실제로 받은 지시와 잇지 못해 "다른 세션의 일"로 읽었다 → **지시 앞머리 + 키 · "사용자에게 묻지 말고 직접 정리해 보내라"**.
- **보고받음** = 루트 대화 기록에 그 워커 claude 의 세션 간 메시지(`origin.verifiedPeerPid` = 워커 claude pid). 실측 모양: `type: 'user'` +
  **`isMeta: true`** + `origin: {kind:'peer', from, verifiedPeerPid, name, fromMode, body}` — ⚠️ isMeta 라고 주입물로 버리면 못 잡는다.
  루트가 바쁘면 먼저 `queue-operation` enqueue(content `<cross-session-message from="uds:/tmp/cc-socks/<pid>.sock" …>`)만 남는다 — 그것도 센다.
- ⚠️ **4줄 보고엔 일의 결과(요약·답)가 없다** — 워커가 보고 요청 턴에 '보고함'으로 답해 `read_session` 의 마지막 답이 그것으로 덮였다(2026-10-22 실측:
  "scripts 3줄로 요약해" 결과를 루트가 못 가져옴). → `read_session` 은 마지막 사람 입력이 보고 요청(`REPORT_REQUEST_PREFIX`)이면 **그 앞의 답**을 준다 ·
  지침서 규칙 10 "결과를 구한 일이면 last_reply 를 함께 전한다".
- 실측(10-22, 티켓 없이): 루트에 "FO-BBJ 에 test/… 브랜치로 새 워크트리 만들어 세션 열고 ~ 시켜줘" → 루트가 `open_session`+new_branch 를 스스로 골라 승인 창 →
  워크트리(`FO-BBJ/test-root-session-check`) → femc 세션 → 보고받음까지 한 바퀴. 정리: 세션·`femc-wt.sh remove`·브랜치·그 워크트리의 대화 기록 폴더·`femc-stacks.json` 항목.
- 보고 요청 턴이 보고 없이 끝나면(쉬는 상태 10틱) `done` + 이유. 같은 세션에 보고 요청 전의 일이 있는데 새 지시가 오면 앞 일은 닫고 합친다.
- 감시 시작은 **`whenSessionsRestored()` 뒤** — 복원 전 `listSessions()` 가 비어 열린 일을 전부 `gone` 으로 닫는다.
- ⚠️ 틱은 중간에 기다린다(ps·파일 읽기·보고 요청 넣기) — 그 사이 `send_to_session` 이 같은 세션의 일을 닫고 합칠 수 있다. 닫힌 일은 건드리지 않게 **매 일 앞과
  await 뒤에 `isOpenTask` 를 다시 본다** — 안 보면 합쳐서 닫힌 일을 `report_requested` 로 되살렸다(2026-10-22 검토).
- 지시 토스트("루트가 SSB-137 에 지시했습니다" [보기])는 그 탭을 보고 있으면 생략된다(터미널 세션 토스트의 기존 규칙).

## 무인 연쇄 가드 (`approve.ts`)
- 루트의 **마지막 입력 줄의 `origin.kind`**(`taskScan.lastInputKind`)가 사람이 아니면 상태를 바꾸는 도구(send_to_session·run_preset·close_session)와
  그룹웨어에 로그인하는 조회(`get_vacation_status`)를 승인 모달(`RootConfirmHost`)에 올린다 — 3분 무응답이면 취소, 막히면 루트에 이유 문장을 돌려준다(지침서: 재시도 금지).
  대화 기록을 **못 읽으면** 통과. ⚠️ 꼬리(256KB)에 입력이 없다고 통과시키지 않는다 — 큰 도구 결과 몇 개로 꼬리가 밀리면 무인 연쇄가 빠져나갔다(2026-10-22 검토).
  4배씩 늘려 16MB 까지 다시 찾고, 끝까지 없으면 `unknown`(사람 턴 아님 → 묻는다, 안내는 '사람이 시킨 턴인지 확인하지 못했습니다').
  ⚠️ 보고가 온 뒤엔 사용자가 루트에 무언가 칠 때까지 계속 peer 다 — 그 사이의 도구 호출은 전부 승인 창을 거친다(의도).
- ⚠️ **HTTP MCP 호출은 기본 '첫 바이트 60초'**(공식 문서 mcp.md) — SDK 가 SSE 헤더를 바로 보내고 15초마다 keepalive, mcp.json 에
  `timeout: 600000`(root.ts). 실측: 실제 Claude Code 가 승인 창에서 75초 기다린 뒤 결과를 받았다.
- ⚠️ **Esc 로 멈춰도 HTTP 연결은 안 끊긴다** — `notifications/cancelled` 가 별도 POST 로 온다. stateless 라 원래 호출에 안 닿아 승인 창이 남았다 →
  `server.ts` 가 본문을 먼저 읽어 요청 id → 서버 인스턴스를 기억하고, 취소가 오면 그 인스턴스를 닫는다(핸들러 signal 이 끊겨 `cancelled`). 실측 0.5초에 모달이 거둬진다.

## 고정 탭 수명 (`rootLife.ts`, 1b-2 — 2026-10-22)
- 사용자 결정: **끄면 꺼진 채**(앱을 다시 켜도) · **켜면 지난 대화를 이어서**(⌘0·LNB '루트' 칸·⌘P·[루트 시작]) · 토글 없음 · dev 는 자동 시작 안 함.
- 루트 명령 끝 = `; echo $? > <루트 폴더>/.exit; exit` — claude 가 끝나면 셸을 남기지 않고 탭이 닫히고(`onTerminalExit`), 코드로 가른다:
  `0`(/exit·Ctrl+C 두 번) · 코드 없음(탭 ✕ — 셸째 끝나 못 적는다) = **사용자가 끔** → `off: true` / 그 밖(`kill -9` = 137 등) = **비정상 종료** →
  1.5초 뒤 같은 대화로 다시 띄우고 토스트, **1분에 3번** 넘으면 멈추고 sticky 토스트(off 는 남기지 않는다 — 다음 앱 시작엔 다시 시도). `.exit` 는 띄우기 직전에 지운다.
- 앱 시작(세션 복원 + 서버 뒤): 루트가 tmux 에 살아 있으면 그대로 · `.exit` 가 `0` 이면(앱이 꺼진 사이 /exit) off · off 가 아니면 띄운다.
- 대화 id 는 20초마다 루트 claude 의 `sessions/<pid>.json` 에서 맞춘다(/clear 하면 바뀐다) — `runtimeFile('orchestrator-root.json')` 의 `conversationId`.
  띄울 때 그 jsonl 이 `~/.claude/projects/*/` 에 없으면 새 대화로(없는 id 로 `--resume` 하면 곧바로 비정상 종료 → 재시작 고리).
- 보는 중에 루트가 꺼지면 다른 화면으로 튀지 않고 '루트 세션이 꺼져 있습니다' + [루트 시작](루트 선택은 세션이 없어도 유효 — TerminalSection 선택 보정).
- **⌘0 = main `before-input-event`**(모든 창) — ⚠️ 렌더러 keydown 으로는 못 잡는다(기본 메뉴 '실제 크기'(⌘0)가 먼저 가져간다 — `⌘W`·`⌘+/-` 와 같은 메뉴 선점).
  `preventDefault` 하면 페이지 keydown 과 메뉴 단축키가 함께 막힌다(공식 문서 web-contents). ⚠️ puppeteer(CDP) 키 입력은 이 이벤트에 안 온다 — 실제 키로 확인한다.
- 실측(10-22 dev): 탭 닫기 → off · /exit(보는 중) → 꺼진 화면 · `kill -9` 4번 → 3번 2초 만에 같은 대화 · 4번째 멈춤 토스트 · 자동 시작 → 4초에 `--resume` ·
  앱이 꺼진 사이 /exit → 다음 시작에 off. 테스트용 `devAutoStart: true`(같은 기록 파일)는 끝나면 지운다 — dev 가 떠 있는 동안 고치면 메모리 값이 덮는다.

## 세션·워크트리 만들기 (`createTools.ts`, 2단계 — 2026-10-22)
- 사용자 결정: 만들기는 **늘 승인 창**(무인 연쇄와 무관) · 여러 티켓은 한 창의 항목(체크를 풀면 뺀다) · 고를 수 있는 것은 **스택·계정만**(위치·브랜치·스킬은
  보여 주기만 — 틀리면 취소하고 루트에게 다시 말한다) · 워크트리 준비까지 **기다렸다** 결과를 준다 · 새 세션은 회사(FEMC) 저장소만, femc 로.
  승인 창은 `askApproval`(approve.ts) — 대기열이 `{decision, picks}` 를 돌려주게 확장(`confirm.ts ask`, 렌더러 `RootConfirmHost` 항목 Checkbox·선택 Select).
- `start_ticket`(티켓 1~5개): 티켓마다 계획 → 거부(이유·후보)와 함께 승인 창 하나 → 남긴 항목만 차례로 워크트리 준비 → `prepareJiraWork`(Jira [작업]과 같은 명령,
  `--stack` 포함) → `createSession(agentId 'femc', 제목 = 키)` → 작업 원장(`addTask`, claude 는 아직 없음 → 2분 기동 유예) → 토스트.
  - 이미 그 티켓의 세션이 있으면 거부(→ `send_to_session`) — `ticketOwner`: claude 가 뜬 세션(탭 제목·브랜치·첫 요청의 키) → **아직 뜨는 중인 탭**(제목 앞머리 키 —
    claude 가 안 떠 `terminalOverview` 에 없다) → 열린 작업 원장의 그 티켓. ⚠️ **루트 자신은 뺀다** — 루트의 첫 요청에 그 키가 있으면 루트를 그 티켓의 세션으로 읽어
    늘 거부했다(2026-10-22 검토). ⚠️ **같은 인스턴스의 세션만 보인다**(dev 는 설치본 탭을 모른다).
  - 키와 주소로 같은 티켓을 두 번 넘기면 하나는 '같은 티켓이 두 번 들어와 한 번만 엽니다'로 제외(승인 창 안내 띠에 줄을 나눠 보인다).
  - 루트가 호출을 멈추면(Esc — `extra.signal`) 남은 티켓은 열지 않고, 돌던 `femc-wt.sh` 도 멈춘다(execFile `signal`). 이미 연 것은 그대로 둔다.
  - 저장소: 프로젝트 레지스트리의 Jira 키 → 없으면 **그 키 접두어(`SSB-`) 브랜치가 워크트리로 올라간 회사 저장소**. ⚠️ 레지스트리 키가 실제 티켓 키와 다를 수 있다
    (실측: 레지스트리 `BBJ` · 티켓 `SSB-…` — 키만 보면 후보 0). 여럿이면 거부 + candidates(루트가 사용자에게 묻고 workspace_id 로 다시).
  - 위치(`ticketPlan.pickPlace` + 테스트): 그 티켓 브랜치의 워크트리(shared `branchIssueKey` — 마지막 조각 앞머리, `feature/SSB-137-v2` 도 SSB-137) →
    브랜치만 있으면 그 브랜치로 새 워크트리 → 주 체크아웃이 비면(기본 브랜치 main·master·develop·dev + 변경 없음 + 탭 없음) 거기 → 아니면 새 워크트리 `fix/키`·`feature/키`.
  - 스택을 모르면(`femcStackFor` null) 그 항목에 스택 선택지를 단다 — 고르기 전엔 [실행]이 잠긴다.
- `open_session`: 티켓 아닌 지시 → `femcCommand({prompt: 지시, stack})`. 위치 = cwd(기존 워크트리) · new_branch(없으면 만든다) · 없으면 주 체크아웃.
- `create_worktree`: 승인 → `femc-wt.sh setup`. 그 브랜치의 워크트리가 이미 있으면 만들지 않고 경로만. 승인 창은 그 브랜치가 로컬·원격에 있으면
  '기존 브랜치 …(기존 브랜치라 분기점 X 는 쓰지 않음)', 없으면 '새 브랜치 …(분기점 X)'(open_session 의 new_branch 도 같은 판정 — 예전엔 늘 '새 브랜치').
- ⚠️ **브랜치 이름은 `ticketPlan.isSafeBranchName`**(+ 테스트) — 조각 첫 글자 `.`·`-` · `..`·`//` · 끝 `/`·`.`·`.lock` 거부. 실측 거부: `.`·`-rf`·`src/.x`·`a//b`·`x.lock`.
- **워크트리 = femc-worktree 스킬의 `femc-wt.sh setup`**(`worktreeSetup.ts`) — 원앱 addWorktree 는 `git worktree add` 뿐이라 FEMC 저장소에선 일을 못 한다
  (.env·.claude 산출물·swagger 캐시·node_modules APFS 복제·claude 계정 3곳의 신뢰·MCP 항목). 로그인 셸(`zsh -lc`)로 · 8분 상한 · **빈 임시 폴더에서** 띄운다
  (⚠️ 스크립트는 인자가 작업 폴더 기준으로 있는 폴더면 그 폴더를 워크트리로 보고 채운다 `[ -d "$TARGET" ]` — 저장소에서 띄우면 `src` 같은 브랜치가 저장소 안 폴더로 읽힌다) · `--path` 를 명시해
  원앱 계산(`worktreePathFor` = `${FEMC_WT_ROOT:-~/projects/worktrees}/<**워크스페이스 이름**>/<브랜치 / → ->`)대로 만든다 — 스크립트 기본(저장소 폴더 이름) 대신
  사용자의 기존 배치(`~/projects/worktrees/FO-BBJ/…`)에 모이게(사용자 결정). 출력의 `[WARN]` 줄을 돌려준다.
- 실측(10-22 dev): 저장소 후보 2개(BO·FO-BBJ) 거부 · 묶음 승인 창(없는 티켓은 '제외') · 하나 빼면 'N건 실행' · 취소 → 거부 문장 ·
  `create_worktree` 13초(node_modules 복제)·`femc-wt.sh remove` 로 정리 · SSB-137 기존 워크트리로 femc 세션 → 스택 선택 창 없이 기동 → 19초에 보고받음(파일 변화 없음).
  시험 뒤 정리: 세션 kill · 그 워크트리 프로젝트 폴더의 새 대화 기록(첫 입력 확인 뒤) · 워크트리·브랜치·빈 상위 폴더.

## 원앱 기능 도구 (3단계 — 2026-10-22, 배포 → PR → 결재·일정 순으로 하나씩)
- 기획 결정: **실행은 각 기능의 기존 확인 화면에서 사용자가** — 루트 도구는 조회 + 그 화면을 값으로 채워 띄우기까지. 승인 창을 새로 만들지 않는다
  (사용자가 보는 화면·실행 경로·확인 절차가 지금과 같다). 루트 지침서: "띄웠다"고만 말하고 "실행했다"고 말하지 않는다.
- **화면 열기 = `app:open-request`**(`openRequest.ts sendOpenRequest`) — 메인 창에만(`getNotifyWindow().webContents.send` — ⚠️ `broadcast` 는 폰까지 가서
  폰에도 모달이 뜬다) + 창 앞으로. 렌더러 `RootOpenRequests`(App 셸에 한 번)가 종류별로 그 기능의 공개 요청 함수로 넘긴다. 요청 타입 `AppOpenRequest`(shared).
- 조회는 그 기능의 공유 채널을 그대로(`lib/moIpc callShared` — 폰과 같은 함수, 결과 캐시도 같다).
- **3a 배포**(`deployTools.ts`): `list_deploy_targets`(projects:get + status:fetch, refresh=캐시 무시) · `preview_deploy`(deploy:preview, 20개) ·
  `open_deploy_confirm` → ⌘P 팔레트와 같은 `requestDeployConfirm`(배포 섹션으로 가서 확인 모달). 프로젝트·대상은 id 또는 이름(대소문자 무시).
  PROD 는 모달의 대상 이름 입력 + main 재대조(deploy:trigger) — 루트가 건너뛸 길이 없다. 실측: DEV·PROD 모달이 그 대상으로 뜨고 [취소]로 닫힘(배포 안 누름).
- **3b PR**(`prTools.ts`): `list_prs`(prs:fetch 보강본 + `mine` — 토큰 주인 `/api/v1/user` 를 주소·토큰별로 기억) · `open_pr_create`(레지스트리 저장소만 ·
  head·base 가 원격에 있는지 prs:all-branches 로 먼저 확인 — 워커가 push 안 한 브랜치로 모달을 열지 않는다) · `open_pr_merge`(열린 PR 인지 확인 · method 미리 선택 · **머지할 수 있으면 [머지] 확인 창까지** — 2026-10-22 사용자 결정, 충돌이면 패널만).
  저장소는 owner/repo · 프로젝트 이름 · **워크스페이스 이름**(FO-BBJ — 저장소 경로가 같은 레지스트리 프로젝트로 잇는다. 루트는 워크스페이스 이름으로 부른다).
  렌더러 `features/prs/lib/prRequest.ts`(배포의 deployRequest 와 같은 패턴) — PrSection 이 목록·레지스트리가 뜬 뒤 소비:
  그 저장소 탭으로 + 검색 비움 → create 면 `CreatePrModal initial`(루트가 채운 제목·본문은 dirty 로 쳐 커밋 초안이 덮지 않는다) ·
  merge 면 그 PR 선택 + `PrDetail initialMethod`. 실측: 없는 브랜치 거부 · 모달이 head·base·제목으로 뜸 · #1420 상세 + Squash 선택(생성·머지 안 누름).
- **3c 결재·일정**(`officeTools.ts`): 조회 `get_approval_defaults`(지난 작성 내용·결재 소속·진행 중 잠금) · `get_worklog`(작업 기록·요일별 기준 시각) —
  둘 다 그룹웨어 로그인 없음 · `get_vacation_status` 만 그룹웨어 로그인(사용자가 물을 때만 — 동시 로그인 거부·연속 실패 잠금).
  화면 `open_approval_form`(kind + 그 종류 객체 하나, 날짜·시각·근태구분·사유 검증 — 목록은 `shared/approval-format` 의 ATT_DIV_NAMES·DOC_REASONS) ·
  `open_schedule`(항목 = 종료 시각·일정명, **뒤에 덧붙임** + 같은 시각·제목 건너뜀 — 사용자 결정). 결재 작성이 진행 중이면(`approvalLockOwner`) 폼 열기를 거부한다
  (다시 그리면 진행 중인 폼의 단계 표시·중복 방지 상태가 사라진다). `get_vacation_status` 는 무인 연쇄면 승인 창을 거친다(그룹웨어 로그인). ⚠️ 휴가는 [작성 시작]이 근태신청을 서버에 저장한다 —
  그래서 루트는 폼을 채우기까지만(작성 함수 run*Draft 는 공개 API 에 싣지 않았다).
  렌더러 `approvalRequest.ts`·`scheduleRequest.ts`(같은 요청 패턴): 결재 섹션이 그 종류로 들어가 폼에 `initial`(key = 요청 순번으로 다시 그려 확실히),
  일정 섹션은 작업 기록을 불러온 뒤 자기 상태에 더한다(main 이 worklog.json 만 고치면 떠 있는 섹션이 디바운스 저장으로 덮는다).
  ⚠️ **채움 값을 지우는 효과는 '폼 → 목록' 전환일 때만** — '종류가 비었다'로 지우면 첫 마운트에 그 효과가 빈 종류로 돌아 같은 틱에 넣은 값을 지웠다(실측 — 야근 폼만 기본값으로 떴다).
  폼은 기본값 불러오기가 채움 값을 덮지 않게 ref 로 막는다(휴가는 근태구분별 시간대 첫 리셋도 건너뛴다).
  실측: 세 폼이 채운 값으로 뜸(작성 안 누름) · 일정 2건 덧붙이고 같은 것 다시 보내도 6건 그대로 · 작업 기록은 백업으로 되돌림(dev 와 설치본이 같은 파일).

## 검토 반영 (2026-10-22, `/review main..HEAD` 23건)
- 실측(dev): 루트 재시작 → 실행 인자에 `--strict-mcp-config --permission-mode manual`, `/mcp` 1 server · 23 tools · 뜨는 중인 탭 'SSB-137'(셸)로 start_ticket 거부 ·
  키+주소 중복 → 1건 + 제외 · 승인 창 하단 바(공용 Modal `footer`) · 위험한 브랜치 이름 5건 거부 · 기존/새 브랜치 문구 · 지시 → 9초 보고 요청 → 12초 보고받음
  (무인 연쇄 승인 창 경유) · read_session 이 보고 턴을 건너뜀 · PR 모달·머지 방식 재요청이 떠 있는 화면에 반영 · 휴가 연차+시간 → 오전반차 09:00~14:00 ·
  연차 조회 무인 연쇄 승인 창(취소 — 로그인 안 함).
- 실측 못 한 것: 결재 작성 중 폼 열기 거부(작성 = 그룹웨어 기록) · 꼬리 16MB 확장(큰 대화 기록 필요) · 요청 30초 만료 · femc `run`(실제 femc 기동 필요).
