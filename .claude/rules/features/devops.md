---
paths:
  - "src/main/features/deploy/**"
  - "src/main/features/prs/**"
  - "src/main/features/jira/**"
  - "src/main/features/projects/**"
  - "src/main/features/nightwatch/**"
  - "src/renderer/features/deploy/**"
  - "src/renderer/features/prs/**"
  - "src/renderer/features/jira/**"
  - "src/renderer/features/projects/**"
  - "src/renderer/features/nightwatch/**"
---

# 개발 워크플로 기능 (프로젝트 · 배포 · PR · Jira · Nightwatch)

## 프로젝트 (중앙 레지스트리)
`renderer/features/projects` + `main/features/projects`

**프로젝트 중앙 레지스트리(관리 지점)** — 이름·로컬 경로(필수) + 원격 저장소 종류(gitea/bitbucket/기타)·주소·기본 브랜치·Jira 프로젝트 키를 `userData/projects.json`(평문 — 비밀 없음, 토큰은 환경설정 담당)에 CRUD.

**새 기능이 프로젝트 경로·저장소 정보가 필요하면 자체 저장하지 말고 여기를 참조할 것**:
- main 은 `features/projects/store.ts` 의 조회 헬퍼(`getProject`·`findProjectByPath`·`findProjectByRepo`·`findProjectsByJiraKey`·`remoteOwnerRepo`)를 직접 import
- 렌더러는 `window.oneApp.projects.*`(list/save/delete/pickDir/onChanged)
- 원격 주소의 owner/repo 파싱은 `shared/types.ts` 의 `ownerRepoFromUrl`(main·렌더러 공용)

저장·삭제 시 `projects:changed` 브로드캐스트로 전 창 실시간 반영. sanitize: 로컬 경로 `~/` 치환+절대경로 정규화·끝 슬래시 제거, Jira 키 대문자, remoteKind 검증 실패 시 gitea.

**PR(빠른 PR)·Nightwatch(분석 대상)는 레지스트리 참조로 전환 완료** — 배포(젠킨스)는 저장소 주소를 빌드 메타데이터에서 런타임 추출하므로 아직 자체 관리(연결 키가 없어 스키마 변경이 선행돼야 한다).

## 배포 (젠킨스)
`renderer/features/deploy` + `main/features/deploy`

프로젝트별 젠킨스 잡을 REST API 로 트리거하고 상태(대기→빌드중→성공/실패)를 폴링해 표시.

[배포]를 누르면 **확인 모달**이 뜨는데, 환경설정에 Gitea 주소가 있으면 **이번 배포에 포함될 커밋 미리보기**(마지막 빌드 revision vs 저장소 HEAD 를 Gitea compare API 로 비교, `gitea.ts`)를 보여주고, 프로젝트가 **운영(PROD)으로 표시**돼 있으면(폼 체크박스, 카드에 PROD 뱃지) **대상 이름을 타이핑해야 배포 버튼이 활성화**된다(오배포 방지).

커밋 내역의 **커밋 해시는 Gitea 커밋 페이지로, 메시지 속 이슈 키(BBJ-1234)는 Jira 로 링크화**(환경설정의 Gitea/Jira 주소 사용, 미설정이면 평문 — 젠킨스가 기록한 저장소 주소는 내부망이라 호스트는 설정된 Gitea 주소로 치환).

대상별 [커밋 내역]을 누르면 **공용 Modal** 로 열리며, 안에 **최근 10개 빌드 이력 스트립**(성공/실패 색, 클릭 시 그 빌드의 커밋 내역으로 전환)과 **콘솔 로그 tail**(마지막 64KB, progressiveText 2단계 조회 — 크기 probe 후 끝부분만)이 있고, **빌드중이면 진행바(estimatedDuration 대비 경과)와 [중지] 버튼**(`/stop`, crumb 재시도)이 뜬다.

상태는 배포 탭을 보는 동안 1분마다 자동 새로고침(젠킨스에서 직접 돌린 빌드도 반영), 빌드중엔 5초 틱으로 진행률 갱신.

**추적은 두 갈래이고, 그게 맞다**(2026-08-09 감사 결론): main 의 `watchBuild` 는 **앱에서 트리거한 빌드 하나**를 완료까지 좇아 `deploy:status` 를 broadcast 하고 **완료 알림의 유일한 소스**다(창을 닫아도 돈다). 렌더러 60초 폴링은 **젠킨스에서 직접 돌린 빌드**를 보기 위한 것이라 없앨 수 없고, `fetchStatuses` 가 프로젝트 단위 조회라 추적 중인 대상만 빼도 요청 수가 줄지 않는다 — **일원화 시도는 이득이 0이라 하지 않았다.** 충돌은 이미 `optimistic` 가드가 막고 있다.

- 대신 `watchBuild` 의 폴링 간격을 **고정 3초 → 3s/8s/15s 적응형**(`watchPollMs`)으로 바꿨다. 짧은 빌드는 첫 2분 안에 끝나므로 그 구간만 촘촘하게 두고, 10분짜리 빌드의 200회 요청을 약 60회로 줄인다. ⚖️ 대가는 **완료 감지가 최대 15초 늦어지는 것**(화면 반영·완료 알림).
- 큐 대기는 사용자가 '대기중'을 보며 기다리는 지점이라 첫 2분은 2초로 더 촘촘하다. 프로젝트 하나에 배포 대상 여러 개(스토어·어드민 등) 등록 가능. 젠킨스 URL·계정은 배포 탭에서 프로젝트별로 등록하고, API 토큰(또는 비밀번호)은 `safeStorage` 로 암호화해 `userData/deploy.json` 에 저장. 인증은 Basic Auth + API 토큰 권장(비밀번호 인증은 CSRF crumb 자동 처리).

## PR (Gitea)
`renderer/features/prs` + `main/features/prs`

push → PR 생성 → 머지 루프를 앱에서 끝내는 섹션. **마스터-디테일**(2026-08-06 전면 개편, 사용자 시안 선택: A안 + 모달형 새 PR) — 좌측 목록(`PrList`)에서 고르면 우측 상세 패널(`PrDetail`)에 커밋·변경 파일·충돌 여부·머지 버튼이 뜬다. 섹션 폭은 `--w-wide`(주간보고와 동일), 1080px 미만이면 1컬럼 스택.

**저장소 탭(최상단) — 저장소별 완전 분리**(2026-08-06 사용자 확정: 전체 보기 없음): 탭을 고르면 목록·검색·상세·생성이 전부 그 저장소 스코프. 탭 = **프로젝트 레지스트리의 Gitea 저장소 전부**(등록 순, **PR 0건이어도 탭 존재** — 생성 진입점) + 레지스트리 밖인데 열린 PR 이 있는 저장소(이름순, 이 탭에선 생성 불가). 라벨은 레지스트리 표시명 우선 + 열린 PR 수(0이면 숫자 생략), 마지막 탭은 `localStorage('prs:repoTab')` 에 기억(사라지면 첫 탭 폴백). 탭 줄 오른쪽에 현재 저장소의 **Gitea PR 경로 링크**(`{giteaUrl}/{owner/repo}/pulls`, 설정에 Gitea 주소가 있을 때만).

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

⚠️ **전역 이슈 검색 API 는 브랜치를 주지 않는다**(`base`·`head` 는 `null`, `ref` 는 빈 문자열 — 2026-08-06 실측). 그래서 `enrichBranches` 가 **저장소별 `/pulls?state=open` 1요청**으로 한꺼번에 채운다(PR 마다 `/pulls/{n}` 을 부르면 PR 수만큼 요청 — 저장소 수 ≪ PR 수). **같은 응답의 `mergeable` 도 함께 실어** 목록의 충돌 뱃지가 추가 요청 없이 나온다. 승인 수 보강과는 서로 독립이라 `Promise.all` 로 함께 돌린다. 상세 패널의 방향·충돌 정본은 `prs:merge-info`(`/pulls/{n}`).

## Jira (내 이슈)
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
- **이어서 쓰기**는 그 위치의 femc 세션이 `waiting` 일 때만 뜬다(busy 에 밀어 넣으면 진행 중인 답변이 끊긴다). 이때 넣는 문구(`paste`)는 **한 줄**이어야 한다 — TUI 에선 개행이 곧 전송이라 중간에 잘려 제출된다.
- 목록의 `● femc` 칩·진행 표시는 **세션 제목이 티켓 키로 시작하는지**로 매칭한다(작업 시작 시 제목 = 키). 사용자가 세션 이름을 바꾸면 칩만 사라진다 — 세션 타입에 티켓 필드를 더하면 sidecar 스키마까지 번져서 표시 하나에 감수할 비용이 아니라고 봤다.
- 티켓 폴더는 **최근 20개만 유지**(세션이 물고 있는 티켓은 제외), 첨부는 파일당 20MB·티켓당 12개(이미지 우선). 같은 티켓을 다시 시작하면 최신 내용으로 덮어쓴다.
- 섹션 이동·세션 포커스는 `renderer/lib/sectionNav.ts`(`sectionBack.ts` 와 같은 얇은 등록소). ⚠️ 요청이 **TerminalSection 마운트보다 먼저** 도착하므로 담아 뒀다가 워크트리 목록이 준비된 뒤 소비한다 — 그때 **세션의 cwd 로 선택을 옮기지 않으면** 다른 워크트리를 보던 중일 때 탭에 그 세션이 없다.

## Nightwatch (Jira 티켓 무인 분석)
`renderer/features/nightwatch` + `main/features/nightwatch`

Jira 버그 티켓을 골라 **headless `claude` CLI 미션으로 읽기 전용 분석**을 돌려 리포트+작업 프롬프트를 만든다(아침에 실제 세션에 붙여넣어 수정 작업).

흐름: 후보 조회(내 미해결 이슈 − 해결·숨김·기분석) → [분석] → **프로젝트 선택(프로젝트 레지스트리 참조 — 학습값 suggestedRepoId → Jira 키 일치 → 첫 프로젝트 순 기본 선택, 티켓의 Jira 키와 일치하는 프로젝트가 목록 앞에 정렬)** → Jira REST 로 티켓·댓글·첨부 수집 → 관찰 모드 미션 실행 → 저장소 변조 사후 검증 → 원장 기록.

**이름과 달리 야간 자동 스케줄러는 없음 — 수동 트리거가 유일한 진입점**, 실행 중 추가 요청은 대기열로 순차 처리.

안전장치: `--disallowedTools Edit MultiEdit NotebookEdit` 로 편집 도구 차단 + 읽기 전용 계약 프롬프트 + 미션 전후 `git status/diff` 비교로 변조 감지(`violation_edited` 경고, patch 증거 보존).

산출물은 `userData/nightwatch/` — `reports/{key}.md`(마크다운 렌더)·`{key}.prompt.md`(복사용)·`work/{key}/`·`logs/`, 원장 `state.json`, 설정 `config.json`(Claude 계정·타임아웃 기본 40분 — 분석 대상 저장소 목록은 프로젝트 레지스트리로 이관). 비용은 stream-json 의 `total_cost_usd` 를 기록해 처리한 티켓 행에 표시. 숨김·[재분석]·30일 자동 정리·앱 시작 시 좀비 정리 포함. 1분 자동 새로고침.
