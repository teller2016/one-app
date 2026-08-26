---
paths:
  - "src/main/features/prs/**"
  - "src/renderer/features/prs/**"
---

# PR (Gitea)

> 저장소 탭은 프로젝트 레지스트리(`features/projects`), Gitea 호출은 `main/lib/gitea.ts` 공용 클라이언트.

`renderer/features/prs` + `main/features/prs`

push → PR 생성 → 머지 루프를 앱에서 끝내는 섹션. **마스터-디테일**(2026-08-06 전면 개편, 사용자 시안 선택: A안 + 모달형 새 PR) — 좌측 목록(`PrList`)에서 고르면 우측 상세 패널(`PrDetail`)에 커밋·변경 파일·충돌 여부·머지 버튼이 뜬다. 섹션 폭은 `--w-wide`(주간보고와 동일), 1080px 미만이면 1컬럼 스택.

**저장소 탭(최상단) — 저장소별 완전 분리**(2026-08-06 사용자 확정: 전체 보기 없음): 탭을 고르면 목록·검색·상세·생성이 전부 그 저장소 스코프. 탭 = **프로젝트 레지스트리의 Gitea 저장소 전부**(등록 순, **PR 0건이어도 탭 존재** — 생성 진입점) + 레지스트리 밖인데 열린 PR 이 있는 저장소(이름순, 이 탭에선 생성 불가). 라벨은 레지스트리 표시명 우선 + 열린 PR 수(0이면 숫자 생략), 마지막 탭은 `localStorage('prs:repoTab')` 에 기억(사라지면 첫 탭 폴백). 탭 줄 오른쪽에 현재 저장소의 **Gitea PR 경로 링크**(`{giteaUrl}/{owner/repo}/pulls`, 설정에 Gitea 주소가 있을 때만).

### 목록 조회는 2단계 + main 캐시 (2026-08-26)
`prs:fetch` 는 **`light`** 면 목록만(요청 1건), 아니면 승인 수(PR별 리뷰 = N+1)·머지 방향까지 보강한다. 섹션은 **light 를 먼저 그리고 보강본으로 갈아끼운다** — 실측 75ms vs 559ms. 보강 전 `approvals`·`mergeable` 은 `undefined` 라 '충돌' 같은 표시가 잘못 뜨지 않는다(전부 optional 필드이므로 **새 필드를 추가할 때도 undefined 를 '모름'으로 그릴 것**).

- main 에 **60초 목록 캐시**(+ 진행 중 조회 공유) — 섹션을 오갈 때마다 N+1 이 다시 돌던 것을 막는다. `light` 요청은 보강된 캐시도 히트로 쳐준다(더 풍부한 결과라 손해가 없다). 반대로 **보강 요청은 light 캐시를 히트로 치지 않는다** — 그래야 2단계가 성립한다.
- ⚠️ **캐시를 버리는 곳**: 수동 새로고침(`force`)·PR 생성·머지. 목록을 바꾸는 API 를 새로 추가하면 `invalidatePrList()` 를 함께 부를 것.
- 뒤늦은 응답이 최신 화면을 덮지 않게 섹션은 **순번(`loadSeq`)으로 stale 응답을 버린다**.

**목록(좌)**: 현재 저장소의 최신순 목록 — 제목·승인/충돌 뱃지·`#번호`. 대상이 프로젝트 기본 브랜치가 아니면 행에 주의색 칩(`→ main`). 툴바에 **검색**(제목·브랜치·작성자, 현재 탭 범위 프론트 필터)·**[새 PR]**(현재 탭이 레지스트리 저장소일 때만 활성)·새로고침, 조직 칩 제외 필터는 유지(알림 폴러와 같은 `excludedOrgs` 를 쓰므로 의미 보존).

**상세(우)**: `prs:merge-info` + `prs:branch-commits`(생성 미리보기와 같은 채널 재사용)로 방향·충돌·커밋·파일(+증감)을 표시하고, 방식(merge/squash/rebase) Segment + [머지] → `useConfirm` 확인 후 `/pulls/{n}/merge`. 충돌 여부는 merge-info 가 오기 전까지 목록의 `mergeable`(아래)로 우선 표시. 머지 성공 → 목록 갱신 + Jira 해결 제안(제목의 이슈 키 매칭). **별도 머지 모달은 없다**(패널로 흡수).

**새 PR 모달**(`CreatePrModal`, 툴바 버튼으로 진입): **저장소는 현재 탭으로 고정**(모달에 저장소 셀렉트 없음 — 제목에 `새 PR — 표시명`). `원본(head) → 대상(base)` 한 줄(둘 다 검색형 Select, `Modal wide`) → 그 사이 커밋·변경 파일 확인 → 제목(브랜치명의 BBJ-#### 자동 추출)·본문(커밋 불릿) 자동 생성. 생성 성공 시 **낙관적 항목으로 그 PR 을 자동 선택**해 상세 패널에서 바로 머지로 잇는다(재조회 완료 전에도 상세가 뜬다). 사용자가 손댄 제목·본문은 덮어쓰지 않는다(dirty ref). 서로를 후보에서 제외하므로 head=base 는 고를 수 없다. 저장소 등록·관리는 프로젝트 탭(`remoteKind==='gitea'` + owner/repo 파싱 가능해야 탭·생성 대상이 된다).

**브랜치 후보** — 모달을 열 때 두 채널을 함께 부른다: `prs:base-branches`(주요 브랜치 = 저장소 `default_branch` + 보호 + `mainBranchRank()` 관례 이름)와 `prs:all-branches`(전체 이름, 검색용 프리페치). 정렬은 `renderer/features/prs/lib/baseBranches.ts` 한 곳 — **프로젝트 설정 defaultBranch → Gitea default_branch → 최근 사용(MRU) → 관례 이름표 → 보호 → 커밋 최신순**. head 는 최근 push 8개(시각 표시)를 위로, 나머지 전체를 이름순으로 붙인다. 팝오버는 `limit={50}` 이라 초과분은 개수만 알리고 검색으로 좁히게 한다.

- 고른 base 는 **저장소별로 `userData/prs.json`(`PrsConfig.recentBases`)에 영구 저장** → 다음 PR 의 기본 선택값.
- 프로젝트 기본 브랜치가 **아닌 주요 브랜치**(보호 또는 관례 이름 — 예: `main`)를 base 로 고르면 **브랜치명 타이핑 확인**을 요구한다(배포 PROD 확인과 같은 패턴). 임의 feature 브랜치는 확인 없음.

⚠️ **Gitea 브랜치 API 실측**(2026-08-06, 사내 서버):
- `/branches` 는 **페이지당 최대 50개**(`limit` 을 더 크게 줘도 무시) · `X-Total-Count` 로 총수 · **커밋 최신순**. 실제 저장소는 브랜치가 **700개 내외**라 전수 페이징은 금지.
- 전체 목록이 필요하면 **`/git/refs/heads`(1요청, 이름 사전순, 커밋 시각 없음)** — 700개 ≈ 277KB 인데 사내망에서 **69ms**(실측)라 모달 오픈 시 프리페치하고 60초 캐시한다.
- 응답의 `protected` 는 저장소마다 설정이 달라 **단독 신호로 못 쓴다**(store·admin 은 `['develop','main']`, api 는 `[]`) → 관례 이름표를 함께 본다.
- `/branch_protections` 는 **repo admin 토큰이 필요(401)** 하므로 사용하지 않는다.
- 최근 50개에 없는 관례 이름(`main`·`master`·`develop`·`development`·`staging`·`qa`)과 기본 브랜치는 **`/branches/{name}` 단건 프로빙**으로 확인한다(404 = 없음). 대부분 404 라 결과를 60초 캐시하고, `default_branch` 는 10분 캐시한다.
- head(원본) 후보에서 주요 브랜치를 빼는 기준도 같은 `mainBranchRank()` + `default_branch` 다 — 예전 `BASE_BRANCHES` 하드코딩(develop/master/main)을 대체했다.

⚠️ `prs:*` 채널은 `handleShared`(폰에서도 호출 가능)라 `repo` 인자를 **`owner/repo` 형식으로 검증**한다(API 경로에 그대로 들어가는 값).

생성·머지는 **Gitea 토큰 필수**(없으면 배너 안내·버튼 숨김). 목록은 **전역 이슈 검색 API**(`/repos/issues/search?type=pulls&state=open`)로 접근 가능한 전체 저장소의 열린 PR + 리뷰 승인 수 뱃지 + **머지 방향(`head → base`)·충돌 여부**, 2분 자동 새로고침.

⚠️ **머지 직후 다른 PR 이 전부 '충돌'로 뜨던 함정**(2026-08-19 실측·수정): Gitea 는 base 브랜치가 갱신되면(= 그 브랜치로 PR 이 머지되면) 그 base 를 향한 **열린 PR 전부**를 다시 충돌 검사하고, 그동안 `mergeable` 을 false 로 준다. PR 응답에는 상태 구분 필드가 없어(**1.25.4** swagger 확인 — `mergeable` 불리언 하나뿐) **재검사 중과 실제 충돌을 API 로 구분할 수 없다.** 그래서 머지 성공 후 `RECHECK_MS`(30초) 동안 그 저장소의 false 를 **모름(undefined)으로 낮춰** 목록 충돌 칩·상세 충돌 배너를 억제하고(머지 버튼은 그대로 비활성 — 서버도 거부한다), `RECHECK_POLL_MS`(3초)마다 재확인해 확정한다. false 가 사라지면 창을 **조기 종료**, 창이 만료되도록 남은 false 는 **실제 충돌로 확정**. 상세 패널도 같은 창 동안 `prs:merge-info` 를 3초마다 다시 본다. 상수·배경은 `renderer/features/prs/lib/conflictRecheck.ts` 한 곳.

- 재확인 채널은 **`prs:mergeables`(저장소당 1요청** — 열린 PR 의 `번호 → mergeable` 맵). ⚠️ **재검사 폴링에 `prs:fetch` 를 쓰지 말 것** — 승인 수 보강이 PR 마다 요청(N+1)이라 3초 폴링에서 요청이 폭발한다.
- 저장소별 `/pulls?state=open` 1요청 로직은 `fetchRepoPrStates()` 하나로 모았다(`enrichBranches` 와 `fetchRepoMergeables` 가 공용).

⚠️ **전역 이슈 검색 API 는 브랜치를 주지 않는다**(`base`·`head` 는 `null`, `ref` 는 빈 문자열 — 2026-08-06 실측). 그래서 `enrichBranches` 가 **저장소별 `/pulls?state=open` 1요청**으로 한꺼번에 채운다(PR 마다 `/pulls/{n}` 을 부르면 PR 수만큼 요청 — 저장소 수 ≪ PR 수). **같은 응답의 `mergeable` 도 함께 실어** 목록의 충돌 뱃지가 추가 요청 없이 나온다. 승인 수 보강과는 서로 독립이라 `Promise.all` 로 함께 돌린다. 상세 패널의 방향·충돌 정본은 `prs:merge-info`(`/pulls/{n}`).
