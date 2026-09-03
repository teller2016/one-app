---
paths:
  - "src/main/features/jira/**"
  - "src/renderer/features/jira/**"
---

# Jira (내 이슈 · 주간 활동 · 티켓 보고 · 작업 시작)

> 인증 헤더는 `jira.ts` 의 `jiraAuth()` 하나뿐 — 조립 금지. 티켓 무인 분석은 `features/nightwatch`.

`renderer/features/jira` + `main/features/jira`

내게 할당된 미해결 이슈 목록(최신 갱신순 50개, 다시열림 누락 방지 JQL 보정). 프로젝트 탭 + 타입별 그룹 카드 + 해결됨 접힘 그룹, 행에 **우선순위 화살표·상위항목 칩**, [⋯] 메뉴로 **상태 전환**(전환 목록 동적 조회)·링크 복사, 내용 확인은 클릭 → 브라우저(Jira)로.

**사이드바 뱃지**에 미해결 수 표시 — 확인 안 한 새 티켓은 액센트 강조(App.tsx, localStorage `jira:seenKeys`).

인증은 환경설정 → 연동의 Jira 주소 + **이메일 + API 토큰**(Basic Auth, 토큰은 safeStorage 암호화) — 셋 다 있어야 동작, 미설정이면 안내 배너. REST `search/jql`(신형) 우선, 404 시 구형 `search` 폴백. 2분 자동 새로고침.

### 직접 추가한 티켓 (2026-08-12)
담당으로 안 날아왔는데 내가 작업해야 하는 이슈를 **주소·번호로 끌어온다**. 헤더 `[+ 티켓]` → 주소 입력 → **존재 확인(제목·타입·상태를 보여줌)** → 추가. 저장은 `userData/jira.json`(`{ added: [{key, addedAt}] }`, 평문 — **키만** 저장하고 내용은 매 조회 때 받는다). 목록 병합은 `fetchMyIssues()` 한 곳이라 **Jira 섹션·사이드바 뱃지·폰 셸·Nightwatch 후보가 전부 자동으로 따라온다.**

- ⚠️ **기존 JQL 에 `OR key IN (…)` 로 합치지 말 것** — 삭제됐거나 권한이 빠진 키가 하나라도 섞이면 Jira 가 400 으로 **쿼리 전체를 거절**해 내 담당 목록까지 사라진다. `searchJql()` 을 따로 한 번 더 불러 병합하고, 추가분만 실패하면 `JiraListResult.addedError` 로 경고 배너를 띄운다(본 목록은 그대로).
- 담당·추가에 모두 있으면 하나로 합치고 `pinned` 만 붙인다 — 핀은 전부 '직접 추가' 그룹 한곳에 모인다.
- 표시는 **타입 그룹들 위의 '직접 추가' 그룹**(2026-08-12 사용자 선택). 해결되면 기존 로직대로 하단 '해결됨' 그룹으로 내려가고 **자동 제거하지 않는다**.
- **제거 = 행의 핀 클릭**(hover 하면 ✕ 로 바뀐다 — 구분 표시와 제거 버튼을 한 자리에 겹쳐 둬 행에 요소가 늘지 않는다). 되돌리기 쉬운 동작이라 확인창 없이 토스트로만 알린다.
- 키 파싱(`store.ts` 의 `normalizeIssueKey`)은 `/browse/KEY`·`selectedIssue=KEY` 를 **먼저** 본다 — 주소 안에서 아무 `단어-숫자` 나 집으면 호스트명(`repo-2.example.com`)을 오인한다. 보관 상한 50개(JQL 길이 방어).
- 채널은 `handleShared`(`jira:added:*`) — 키 문자열만 오가고 파일 경로가 없어 폰에 열어도 안전하다.

### 주간 활동 — '주간' 탭 (2026-08-13)
섹션 헤더 아래 `[내 이슈 | 주간]` Segment(마지막 선택은 localStorage `jira:view`). 주간 화면은 **한 주(월~일) 동안 내가 손댄 티켓**을 관여도와 함께 나열한다 — `WeekActivityPanel` + main 의 `jira:activity`(`jira/activity.ts`). 주 이동 `◀ ▶`(미래 차단·최대 52주 과거), 관여도 필터 Segment(`전체/해결/진행/연관` — 개수가 곧 요약 통계), 프로젝트 분포는 오른쪽 텍스트, 행을 펼치면 **그 주의 내 변경 이력**(시각·필드·전→후)이 보인다. 툴바 오른쪽 **[링크 N]** 은 주간보고에 붙여넣을 용도로 **보이는 목록(필터 반영)의 URL 만** 복사한다(2026-08-13 사용자 선택 — 키·제목은 넣지 않는다). 구분은 **빈 줄 하나**(`\n\n`) — 붙여넣은 뒤 링크 사이에 설명을 적어 넣는 사용 방식이다. 개수를 버튼 라벨에 실어 필터가 걸린 상태임을 드러낸다. 상세 패널은 내 이슈 탭과 **하나를 공유**한다(`onOpenDetail` 콜백 — 두 번 마운트하지 않는다).

**Jira 에는 '내가 작업했다'는 필드가 없다** → 세 갈래로 나눠 묻고 키로 병합한다. ⚠️ **하나의 JQL 로 OR 합치지 말 것** — 인스턴스가 한 조건을 거절하면 400 으로 쿼리 전체가 죽는다(직접 추가 티켓과 같은 함정). 갈래별로 부르면 실패한 것만 경고 배너로 알리고 나머지는 그대로 보여준다.

1. `assignee WAS currentUser() DURING (…) AND updated …` — 그 주 내 담당이었고 움직인 티켓
2. `status CHANGED BY currentUser() DURING (…)` — 내가 상태를 옮긴 티켓
3. `worklogAuthor = currentUser() AND worklogDate …` — 작업시간을 남긴 티켓

관여도는 **changelog 에서 그 기간 + 내 계정 항목만** 추려 판정한다: 완료 계열로 전환/resolution 채움 → `resolved`, 그 외 상태 변경 → `progressed`, 상태 변경 없이 담당·필드만 → `touched`.

⚠️ **실측 (2026-08-13, 사내 Jira Cloud REST v3)**
- 세 갈래 **모두 지원**된다(경고 0건). 한 주 8~17건 조회가 **약 1초**.
- 검색에 `expand=changelog` 를 실을 수 있고 **최신순 + `total === histories.length`** 로 온전히 온다(실측 total 11~28) → 티켓별 추가 조회가 17건 중 1건으로 줄었다. 잘렸을 때만 개별 조회로 보강한다.
- ⚠️ **정렬 방향을 가정하지 말 것** — 검색 expand 는 **최신순**인데 `/issue/{key}/changelog` 는 **오래된 순**이다. 그래서 개별 조회는 첫 페이지에 기간이 안 걸리면 마지막 페이지도 받아 합친다(최대 2요청).
- ⚠️ **`DURING` 에 날짜만 주면 끝 경계를 '그 날 끝까지'로 해석**해 다음 주 월요일 활동이 지난주로 새어 들어온다(월요일에 닫은 티켓이 지난주 목록에서 '해결'로 찍혔다). → `"YYYY-MM-DD 00:00"`·`"… 23:59"` 로 **시각을 반드시 붙인다**. `worklogDate` 는 날짜 단위 필드라 시각 없이 종료일 포함 비교.
- ⚠️ **이력을 받았으면 이력만 믿는다** — "status 갈래에서 왔으니 전환은 했을 것"이라는 폴백이 위 경계 누출과 겹쳐 오판을 만들었다. 검색 갈래 추정은 **이력을 못 받았을 때만**(`historyMissing` — 마크가 흐리게 표시된다).
- 그래도 **근거가 status 갈래뿐인데 이력에 내 변경이 0건**이면 경계 잡음이므로 목록에서 뺀다. 담당·작업시간 갈래는 changelog 에 안 남는 활동이라 이력이 비어도 '연관'으로 남긴다.
- 이력 작성자 대조는 `/myself` 의 **accountId 우선**(Cloud) → 이메일 → name/key → 표시명 순. Server/DC 는 accountId 가 없어서 폴백이 필요하다.
- 상한: 갈래별 100건 · 이력 개별 조회 40건(초과분은 추정 + 경고) · 동시 4.
- 캐시는 **주 단위**(진행 중인 주 60초, 지난 주 10분, 8개 유지) — 주 이동 왕복이 매번 재조회하지 않는다. 주간 화면은 **자동 폴링 없음**(수동 새로고침), 대신 주간 탭을 보는 동안 내 이슈 목록의 2분 폴링은 `enabled: false` 로 멈춘다.
- ⚠️ 날짜는 JQL 문자열에 그대로 들어가고 `jira:activity` 는 `handleShared`(폰에서도 호출)다 → `activity.ts` 진입부에서 `YYYY-MM-DD` 정규식을 통과한 값만 쿼리에 넣는다.

### ⚠️ 목록은 터미널 브로드캐스트에 통째로 반응하면 안 된다 (2026-08-26)
행에 femc 세션 칩을 띄우려고 `terminal:sessions` 를 구독하는데, 그 브로드캐스트는 출력·상태 변화마다 온다. 예전엔 그때마다 **이슈 목록 전체가 다시 그려졌다**. 지금 구조:

- `IssueRow` 는 **`memo`** — 부모가 넘기는 콜백은 **전부 `useCallback` 으로 고정**돼야 한다(인라인 화살표를 하나라도 되살리면 memo 가 통째로 무력화된다). 열린 메뉴 키(`menuKey`)는 **ref 로 읽는다** — 의존성에 넣으면 메뉴를 여닫을 때마다 전 행이 다시 그려진다.
- 세션 상태는 **관심 필드(femc 세션의 id·제목·상태·cwd)가 같으면 이전 배열을 유지**한다(`applySessions`). 칩에 새 값을 쓰려면 그 키 문자열에도 넣어야 반영된다.
- `visible`/`open`/`done`/`pinnedOpen`/`typedOpen` 은 전부 `useMemo` — 하나라도 매 렌더 새 배열이면 그 아래 `groups` 메모가 **항상 무효**가 된다.

### [작업] — 티켓을 femc 세션으로 넘긴다 (2026-08-12)
행 맨 끝 `▶`(상세 패널은 액션 줄 맨 앞 주 버튼) → **위치 선택 모달**(`StartWorkModal`) → `femc` 세션 생성 + 터미널 섹션으로 이동. main 의 `jira:prepare-work`(`jira/work.ts`)가 티켓 본문·댓글을 마크다운으로, 첨부를 파일로 `userData/jira-work/<KEY>/`(`ticket.md` + `attachments/`)에 받아 두고 **실행 명령까지 조립해** 돌려준다. 렌더러는 그 `command` 를 가공 없이 `terminal:create` 에 넘긴다.

- **femc 는 Jira 를 직접 못 읽는다** — 사내 Jira 는 Basic Auth 가 필요한데 femc 쪽엔 자격증명도 MCP 도 없다(`~/.femc` 에 `mcpServers` 없음 — 2026-08-12 확인). 그래서 **이미 인증된 앱이 받아서 파일로 건네주는 것이 첨부 이미지를 전달하는 유일한 경로**다. 본문의 `<img>` 는 첨부 id 로 매칭해 `![](attachments/…)` 로 이어 붙인다(실측: 인라인 스크린샷이 정확히 연결됨).
- ⚠️ **`@경로` 파일 참조를 쓰지 말 것** — userData 경로에 공백이 있어(`~/Library/Application Support/One App/…`) `@` 뒤가 잘린다. "이 파일을 먼저 읽어줘: <절대경로>" 로 지시하면 Read 가 경로를 그대로 받아 공백과 무관하게 열린다.

#### ⚠️ femc 는 **뜨자마자 입력 가능해야 한다** — 게이트 3중 (2026-08-12 실측)
그냥 `femc --add-dir … "<프롬프트>"` 로 띄우면 사람이 셋을 넘겨야 했고(사용자 신고), **프롬프트도 유실**됐다. 지금 명령은 `CLAUDE_CONFIG_DIR=<계정> FEMC_SKIP_UPDATE_CHECK=1 command femc '<프롬프트>' --add-dir '<폴더>'` 다.

1. **계정 선택** — 앱이 아니라 **`~/.zshrc` 의 `femc()`·`claude()` 셸 함수**가 묻는다(`CLAUDE_CONFIG_DIR` 을 정하려고 Personal `~/.claude` / Team `~/.claude-team` 중 고르게 한다). → **`command femc`** 로 함수를 건너뛰고, 그 함수가 하던 일을 앱이 직접 한다. 계정은 시작 모달의 Select(마지막 선택은 localStorage `jira:workAccount`)로 고르고 `work.ts` 가 `CLAUDE_CONFIG_DIR` 을 넘긴다. 후보·로그인 이메일은 `jira:work-accounts`(각 프로필의 `.claude.json` 을 읽는다).
2. **femc 메뉴** — femc 런처는 **첫 인자가 플래그면 `runMenuLoop()`**(Run/Resume/Git/Setup…)로 빠진다. `femc --add-dir …` 가 정확히 그 경우였다. → **프롬프트를 첫 인자로** 두면 `runClaude()` 로 직행한다.
3. **업데이트 확인** — 그 메뉴 경로에서만 도는 `maybeUpdate()`. → 2번으로 이미 안 타지만 `FEMC_SKIP_UPDATE_CHECK=1` 로 한 번 더 막는다.

- `--dangerously-skip-permissions` 는 femc 가 `buildClaudeArgs()` 에서 자체적으로 붙이므로 권한 창·신뢰 확인도 없다.
- 실측 확인법: 개발 인스턴스는 **tmux 소켓이 갈린다**(`-L oneapp-dev`, sidecar 도 `terminal-sessions-dev.json`) — 빌드 앱 세션(`-L oneapp`)과 헷갈리지 말 것. ⚠️ `capture-pane` 은 pane 타깃이라 `=이름` 이 안 먹는다(`-t oneapp-<id>` 로 줄 것). attach replay 로는 TUI 화면을 볼 수 없다(대체 화면이면 replay 를 생략하는 설계).
- 이 회피는 **Jira [작업] 경로에만** 적용했다(2026-08-12 사용자 선택). 터미널 `[+]` 새 세션·프리셋은 그대로라 거기선 계정 선택이 뜬다.
- ⚠️ **셸 명령 조립은 main 에서만** — 티켓 제목·본문이 섞인 프롬프트라 인용이 곧 사고다. `lib/util.ts` 의 `shQuote`(pty.ts 에서 이관, 두 곳이 공유)를 쓴다. 실측 검증: 공백 경로·개행·`'`·`"` 가 모두 온전히 한 인자로 전달됨.
- ⚠️ **시각은 `renderedFields` 가 아니라 원본 ISO** 를 쓴다 — 렌더된 값은 "오늘 9:44 오전" 같은 상대 표기라 나중에 읽는 에이전트에겐 기준이 없다.
- 시작 스킬은 모달에서 고른다(기본 `자동` = 버그 계열 → `/bugfix`, 그 외 → `/dev`. 선택은 localStorage `jira:workSkill`). '부가 설명' 한 줄은 프롬프트 끝에 붙는다.
- **시작 성공 직후 진행중 전환을 제안**한다(2026-08-19) — PR 머지 → 해결됨 제안과 같은 패턴. `jira:start-progress`(`startProgressIssue`, 전환 이름 `/진행|progress/i` 휴리스틱)로 전환하고, 이슈가 이미 진행중 계열(`statusCategory === 'indeterminate'`)이면 묻지 않는다. 확인창은 App 루트 `ConfirmProvider` 라 모달이 닫히고 터미널 섹션으로 이동한 뒤에도 뜬다.
- **이어서 쓰기**는 그 위치의 femc 세션이 `waiting` 일 때만 뜬다(busy 에 밀어 넣으면 진행 중인 답변이 끊긴다). 이때 넣는 문구(`paste`)는 **한 줄**이어야 한다 — TUI 에선 개행이 곧 전송이라 중간에 잘려 제출된다.
- 목록의 `● femc` 칩·진행 표시는 **세션 제목이 티켓 키로 시작하는지**로 매칭한다(작업 시작 시 제목 = 키). 사용자가 세션 이름을 바꾸면 칩만 사라진다 — 세션 타입에 티켓 필드를 더하면 sidecar 스키마까지 번져서 표시 하나에 감수할 비용이 아니라고 봤다.
- 티켓 폴더는 **최근 20개만 유지**(세션이 물고 있는 티켓은 제외), 첨부는 파일당 20MB·티켓당 12개(이미지 우선). 같은 티켓을 다시 시작하면 최신 내용으로 덮어쓴다.
- 섹션 이동·세션 포커스는 `renderer/lib/sectionNav.ts`(`sectionBack.ts` 와 같은 얇은 등록소). ⚠️ 요청이 **TerminalSection 마운트보다 먼저** 도착하므로 담아 뒀다가 워크트리 목록이 준비된 뒤 소비한다 — 그때 **세션의 cwd 로 선택을 옮기지 않으면** 다른 워크트리를 보던 중일 때 탭에 그 세션이 없다.

### 티켓 보고 — '보고' 탭 (2026-09-03)
Segment 가 `[내 이슈 | 주간 | 보고]` 3개다. 보고 화면(`JiraReportPanel` + main `jira/report.ts`)은
**프로젝트·기간으로 티켓을 모아 필터한 뒤 템플릿대로 한 번에 복사**한다 — 달마다 프로젝트별
처리 티켓을 보고하는 용도(사용자 요청). 단독 배포판 `standalone/lite` 가 **같은 컴포넌트·같은 main
모듈을 import** 해 띄우므로, 여기 고치면 그쪽도 함께 바뀐다.

- **필터는 두 층**: 서버(JQL)는 `project IN (…)` + 기간(월/직접/전체 × 기준 필드 생성·해결·갱신)만
  자르고, **상태·담당자·레이블·유형은 받은 결과 안에서 facet 으로 거른다**(`MultiSelect`,
  선택지 = 결과에 실제로 있는 값 + 개수). 레이블·담당자 후보 API 는 인스턴스마다 달라 기대지 않는다.
  JQL 조립은 `shared/jira-report.ts` 의 `buildReportJql` 하나 — 렌더러가 미리보기로 같은 문자열을
  보여준다(vitest 있음). 고급용 [JQL 직접 입력] 은 조건을 무시하고 그대로 보낸다.
- ⚠️ **기간 끝 경계는 항상 `< 다음 날(다음 달 1일)`** — `<= "2026-08-31"` 은 그날 00:00 까지라
  말일 활동이 빠진다(주간 활동의 DURING 경계 함정과 같은 뿌리).
- 페이징은 신형 `search/jql` 의 `nextPageToken`(total 없음 — isLast 로만 끝 판정), 404 면 구형
  `search` 의 startAt/total 로 폴백. 상한 1000건(`truncated` 배너). 400 은 응답 본문의
  `errorMessages` 를 그대로 보여준다(JQL 오타 위치가 거기 온다).
- 프로젝트 선택지는 `project/search`(50개씩 isLast 까지, 10분 캐시), 404 면 `project` 배열 폴백.
- **복사 형식은 템플릿** `{key} {summary}` 기본(→ "SSB-111 티켓명"). 자리표시자 목록·프리셋·
  `\t`/`\n` 이스케이프는 `features/jira/lib/reportTemplate.ts`(vitest 있음). 체크박스로 고른 행만,
  없으면 보이는 전체를 복사한다. 첫 줄 미리보기가 템플릿 아래 붙는다.
- **자리표시자는 `(i)` 버튼으로 펼치는 목록**이다(2026-09-03 사용자 지적 — 툴팁이라 눌러도 반응이
  없었다). 칩마다 `{이름} · 설명 · **첫 티켓의 실제 값**`을 보여주고, 누르면 템플릿의 **커서 자리**에
  삽입된다.
  - ⚠️ **커서는 `onSelect` 추적만 믿지 말고 입력 요소에서 직접 읽을 것**(`selectionStart`) — React 의
    select 이벤트는 실제 마우스·키 조작에서만 합성돼, 코드로 옮긴 커서를 핸들러가 못 본다(실측:
    중간에 커서를 둬도 끝에 붙었다). 공용 `Input` 은 ref 를 받지 않으므로 요소는 `onFocus` 이벤트에서 집는다.
  - ⚠️ 칩에 **`onMouseDown` preventDefault** 가 필요하다 — 없으면 클릭이 입력칸의 포커스·커서를
    빼앗아 연달아 넣을 때 자리가 끝으로 튄다.
- **저장**: 템플릿·프로젝트·기간 기준·기간 방식은 `userData/jira.json` 의 `report`
  (`jira:report:prefs:*`) — localStorage 아님(보존 데이터). 저장된 프로젝트가 있으면 탭을 열자마다
  한 번 자동 조회한다. 월은 저장하지 않고 항상 이번 달로 시작한다(다음 달 ▶ 는 이번 달까지만).
- 채널은 `ipcMain.handle`(`jira:report:*`) — 폰에 열 이유가 없어 handleShared 가 아니다.
  `registerJiraReportIpc()` 는 `report.ts` 에 있고 `registerJiraIpc()` 가 부른다(단독판은 직접 부른다).
- 제목 클릭은 `onOpenDetail` 이 있으면 앱 안 상세 패널(본체), 없으면 브라우저(단독판).

## ⚠️ 베이스 주소에 경로가 붙으면 REST 가 HTML 200 을 받는다 (2026-09-03 실측)

환경설정의 Jira 주소에 티켓 주소를 붙여넣으면(`https://x.atlassian.net/browse/ABC-1`) 호출이
`…/browse/ABC-1/rest/api/3/project/search` 가 되는데, Atlassian 은 이것을 **SPA 라우팅으로 받아
HTTP 200 + `text/html`** 을 돌려준다(본문이 `<div id="jira-frontend">…`). 그래서
`Unexpected token '<', "<div id="j"… is not valid JSON` 만 배너에 뜨고 원인을 알 수 없었다
(One App Lite 2.0.0 Windows 제보). 실측 응답:

| 저장된 베이스 | `/rest/api/3/project/search` |
|---|---|
| `https://x.atlassian.net` | 200 · `application/json` |
| `https://x.atlassian.net/browse/ABC-1` | 200 · `text/html` (`<div id="jira-frontend">`) |
| `https://x.atlassian.net/jira/your-work` | 200 · `text/html` (`<!doctype html>`) |

방어는 두 겹이다 — 둘 중 하나만 두지 말 것.
- `shared/jira-url.ts` 의 `normalizeJiraBase` 가 경로를 떼어 낸다(Cloud 는 origin 강제, 설치형은
  `browse`·`rest`·`secure`·`issues`·`projects`·`plugins` 만 자른다 — ⚠️ `/jira` 서브패스 배포를
  깨지 않으려고 `/jira` 는 **일부러 남긴다**). vitest 있음.
- 응답 파싱은 `readJson(res, 'Jira')`(`main/lib/http.ts`) — JSON 이 아니면 주소를 확인하라는
  문구로 바꿔 던진다. Jira 계열 전 호출(report·jira·activity·work)이 이걸 쓴다.
