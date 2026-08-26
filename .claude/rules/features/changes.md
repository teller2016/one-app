---
paths:
  - "src/main/features/changes/**"
  - "src/renderer/features/changes/**"
  - "src/mobile-app/views/MoChangesView.tsx"
---

# 변경사항 (워킹트리 git 상태·diff·커밋·push)

`renderer/features/changes` + `main/features/changes`

"AI 에 작업 시키고 → 변경 확인 → 커밋 → 푸시" 루프의 **확인·커밋·푸시** 담당. 커밋은 메시지 입력 + `add -A` 일괄(2026-08 Superset 스타일 개편에서 UI 추가).

## 진입점 셋
- **터미널 우측 드로어**: 툴바 git-branch 토글, localStorage `terminal:changesOpen`, 활성 세션 cwd 대상 — 좌측 grip 드래그로 너비 조절 240~640px, localStorage `terminal:changesWidth`.
- **전체 화면 오버레이**(`ChangesOverlay`): 드로어 헤더 **⤢ 버튼** 또는 **파일 행 더블클릭** — 좌측 패널(커밋 작성·파일 리스트·커밋 목록) + 우측 **사이드-바이-사이드 diff**(`SplitDiff`, unified→행 페어 파싱은 `lib/diff.ts`). body portal + fixed(z 90), Escape 닫기. 데스크톱 전용.
  - ⚠️ 진입 버튼은 **테두리 + 15px 글리프**로 띄운다 — 13px 아이콘 버튼으로 다른 아이콘 무리에 섞어 뒀더니 사용자가 기능이 있는 줄도 몰랐다(2026-08-07). 더블클릭 경로를 함께 둔 이유도 같다.
  - ⚠️ 오버레이 루트에 **`-webkit-app-region: no-drag` 필수** — 밑에 깔린 사이드바·탑바가 `drag` 라 이게 없으면 창 끌기가 헤더 클릭(닫기·푸시)을 통째로 삼킨다(2026-08-07 실측). 헤더 좌측 패딩은 `--titlebar-safe`(신호등 자리).
  - 좌측 패널 폭·좌우 diff 비율은 **grip 드래그**(터미널 패널과 같은 규칙: 히트 11px·선 2px·포인터 캡처·놓는 순간 localStorage 1회). 비율 손잡이를 한 지점에 놓으려고 `SplitDiff` 를 **2열 grid**(각 열 = 번호+본문)로 짰다 — 번호를 별도 열로 빼면 경계가 두 군데로 갈라진다.
- ⚠️ **툴바의 푸시는 `primary` 필로 두지 말 것** — 섹션 툴바 중 유일한 채운 블루라 혼자 떠 보였다(2026-08-07 사용자 지적). ghost 톤 + 아이콘으로 두고 **올릴 커밋이 있을 때만**(`--ready`) 액센트 글자·테두리로 신호한다.
  - 좌측 파일 목록은 **평면 리스트**(`FileTree`)다 — 폴더 트리로 만들었더니 자식이 하나뿐인 폴더가 계단처럼 쌓여(`.claude > rules > features`) 폭만 먹었다(2026-08-07 사용자 요청으로 되돌림). 파일명을 앞세우고 디렉터리는 뒤에 흐리게(`direction: rtl` 로 앞쪽 말줄임).
- **MO '변경' 탭**: `mobile-app/views/MoChangesView` — 프로젝트 레지스트리 선택 + 같은 `ChangesView` 재사용.

## 상태 로직은 `lib/useChanges.ts` 훅 (드로어·오버레이 공유)
5초 폴링 + 모드 전환 + 커밋 선택 + 파일 diff 를 한 곳에서. 훅은 IPC·상태만, confirm/토스트는 뷰가.

- **모드 2개**: `work`(HEAD 대비 워킹트리) ↔ `branch`(베이스 브랜치 분기점 대비 — Superset 'Against main'). 베이스는 main→master 순으로 찾고 **현재 브랜치가 베이스면 세그먼트 자체를 감춘다**(`status.baseBranch` 없음).
- **커밋 선택**: 커밋 목록(`changes:log`, 최근 30개·미푸시 점 표시)에서 클릭 → 그 커밋의 파일(`changes:commit-files`)·diff(scope `{commit}`)로 전환. 커밋은 불변이라 폴링 갱신에서 제외.
- setMode 직후 stale ref 로 옛 모드를 조회하지 않게 **refresh 는 모드를 인자로 받는다**(`doRefresh(m)`).

## main 의 git 실행 (`/usr/bin/git` execFile)
1. **상태**: `status --porcelain --branch --untracked-files=all`(⚠️ 기본값은 새 디렉터리를 통째 `dir/` 로 묶어 파일별 diff 가 안 된다 — 2026-08 실측) + `diff <ref> --numstat`(+/− 수, work 는 HEAD·branch 는 merge-base) + `log @{u}..HEAD`(푸시 대기 커밋)
2. **branch 모드 파일 목록**: `diff --name-status -M <merge-base>` — 커밋된 것 + 워킹트리 변경이 한 번에 잡히지만 **untracked 는 diff 에 안 잡혀** porcelain 결과에서 합친다.
3. **파일 diff**: 추적 파일은 `diff <ref>`, untracked 는 `--no-index /dev/null`(**exit 1 이 정상**), 커밋 한 건은 `show --format= -M <hash> -- <path>`(--format= 이 커밋 헤더 억제), 512KB 초과는 truncated
   - **증분 응답**(2026-08-09): 응답에 본문의 sha1 `hash` 를 함께 싣고, 호출부가 다음 조회에 `knownHash` 로 되돌려주면 내용이 같을 때 **본문 없이 `{unchanged:true}`** 만 준다 — 5초 폴링이 바뀌지도 않은 512KB 를 매번 IPC 로 실어 나르던 것을 없앤다(실측 351B → 0B). 해시는 **잘라낸 뒤의 최종 본문**으로 계산한다(화면에 가는 내용과 1:1).
   - ⚠️ `knownHash` 는 폰에도 열린 채널의 입력이라 **40자 hex 형식을 검증**한다(비교에만 쓰이지만 규칙은 규칙).
   - MO 터미널 페이지(`src/mobile`)는 `knownHash` 를 보내지 않으므로 항상 전체를 받는다(하위 호환 — 거긴 폴링도 안 한다).
4. **커밋 목록**: `log --pretty=%h\t%ct\t%s`(커밋 0개면 log 자체가 실패 → 빈 목록), 미푸시 집합은 `@{u}..HEAD`(upstream 없으면 전부 미푸시)
5. **커밋**: `add -A` 후 `commit -m`(통째 한 번 — 여러 -m 은 문단 분리) / **푸시**: upstream 이 없거나 **현재 브랜치와 다른 이름을 가리키면** `-u origin HEAD` 로 추적을 바로잡으며 푸시
   - ⚠️ 워크트리 `-b` 를 원격 베이스(origin/main)로 만들면 git 이 **origin/main 을 추적으로 잡는다** — 사용자 `push.default=current` 라 푸시는 제 이름 브랜치로 잘 가지만 `@{u}..HEAD` 가 안 비어 '푸시할 커밋'이 영영 남았다(2026-08-14 실측). 그래서 워크트리 생성은 `--no-track`(workspaces/git.ts), 푸시는 위 이름 불일치 교정. 확인 다이얼로그 문구도 같은 판정(`lib/push.ts` `pushConfirmMessage`)으로 실제 목적지를 보여준다.

전 명령 `core.quotepath=false`(한글 경로 보존) + `GIT_TERMINAL_PROMPT=0` + 타임아웃(headless 인증 프롬프트 hang 차단).
**조회 명령은 `runGit(..., { readOnly: true })`** — `GIT_OPTIONAL_LOCKS=0` 이 붙어 5초 폴링이 매 tick `.git/index` 를 다시 쓰고 사용자·에이전트의 git 작업과 index.lock 을 두고 경합하던 것을 막는다. **쓰기(add/commit/push)에는 붙이지 않는다.**

### ⚠️ tick 당 프로세스 수를 늘리지 말 것 (2026-08-26 계측)
5초 폴링이라 tick 당 git 스폰 수가 그대로 비용이다. **6개 → 4개**로 줄여 둔 상태이고(`main` 브랜치 실측, work 모드 + 커밋 목록), 그 근거는:
- `rev-parse --is-inside-work-tree` 는 **경로별 5분 캐시** — status 가 실패하면 버린다(워크트리 삭제·이동 대응).
- 베이스 브랜치는 `for-each-ref refs/heads/main refs/heads/master` **한 번**(옛 `rev-parse --verify` 는 브랜치당 1회라 최대 2스폰) + **60초 캐시**.
- `@{u}..HEAD` 는 상태 조회와 커밋 목록이 **같은 tick 에 함께 부르므로 2초 창으로 Promise 를 공유**한다(포맷을 `%h\t%s` 로 통일해 한 명령으로 합쳤다). ⚠️ **커밋·푸시 후에는 `invalidateRepo()` 로 버린다** — 안 버리면 직후 재조회가 옛 미푸시 목록을 보여준다.
- status·베이스·numstat 은 서로 독립이라 `Promise.all`(branch 모드는 분기점을 알아야 하는 numstat 만 뒤로 뺀다).

## 보안 — 폰에 열리는 채널
IPC 6채널 전부 `handleShared`(MO 화이트리스트) — ⚠️ **클라이언트가 경로를 직접 못 넘긴다**: `ChangesTarget`(projectId/sessionId)만 받아 main 이 해석하고, diff 파일 경로도 저장소 밖 탈출을 검증한다(폰에 열리는 채널이라 임의 디렉터리 git 실행 차단). ⚠️ **커밋 해시·diff scope 도 화이트리스트 검증**(`HASH_RE` + `sanitizeScope`) — 임의 문자열이 git 인자가 되면 안 된다.

## 뷰
보이는 동안 5초 폴링(선택 파일 diff 도 함께 갱신 — 에이전트가 고치는 중 따라감). 세션 종료와 폴링의 레이스는 try/catch 로 에러 화면 처리(안 하면 매 틱 unhandled rejection — 실측). 드로어 diff 는 라이브러리 없이 줄 prefix 파싱 + `panel-dark` 토큰(--ok/--danger 재매핑), 오버레이는 `SplitDiff`(4열 grid — `display: contents` 행, 긴 줄은 열 안 줄바꿈, 색은 글자 대신 **배경 틴트**: 행 soft + 달라진 구간 `<mark>` strong — 구간은 파서가 좌우 공통 접두/접미로 계산).

### ⚠️ 증분 diff 를 쓰는 쪽의 규칙 (`useChanges`)
훅은 화면에 떠 있는 diff 의 **(파일 + 기준) 키**와 그 해시를 함께 들고 있다가, **키가 일치할 때만** `knownHash` 를 보낸다.

- ⚠️ **다른 파일에 보내면 안 된다** — 빈 diff 처럼 우연히 해시가 같으면 main 이 '변경 없음'을 돌려줘 **남의 diff 가 화면에 남는다**.
- ⚠️ `unchanged` 응답에서 **`setDiff` 를 부르면 안 된다**(본문이 없어 diff 가 사라진다). 그냥 반환하는 게 폴링의 정상 경로다.
- ⚠️ diff 를 비울 때는 **캐시 키도 같이 비운다**(`clearDiff`) — 둘이 어긋나면(state 는 null 인데 키는 남음) 다음 조회가 '변경 없음'을 받아 화면이 빈 채로 굳는다.

## ⚠️ diff 렌더 성능 (2026-08-06 CPU 폭주 사후 수정)
1. **폴링 콜백은 안정화해서** — `usePolling` 에 인라인 화살표를 넘기면 렌더마다 인터벌 재시작+immediate 실행이 반복돼 IPC 왕복 주기로 폭주한다(`renderer-ui.md` 참고).
2. **내용이 같으면 이전 상태 객체를 유지한다** — IPC 응답은 매번 새 객체라 그대로 set 하면 5초마다 diff 전체가 재렌더된다. `useChanges` 가 status/log 는 JSON 키, diff 는 필드 비교로 같으면 이전 객체를 반환 → `SplitDiff`/`UnifiedDiff` 의 `memo` 가 실제로 먹는다.
3. **청크 렌더** — 512KB diff 를 통째로 그리면 수만 DOM 노드. SplitDiff 800행·UnifiedDiff 1200줄씩 '더 보기'로 끊고, **key=파일 경로**로 파일 전환 시 상한을 리셋한다(같은 파일 갱신은 유지).
4. **오버레이가 떠 있는 동안 드로어 폴링 중지** — `ChangesView` 의 `polling` prop(← `useChanges` `enabled`). 같은 대상을 둘이 동시에 git 조회할 이유가 없다.
