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

## Nightwatch (Jira 티켓 무인 분석)
`renderer/features/nightwatch` + `main/features/nightwatch`

Jira 버그 티켓을 골라 **headless `claude` CLI 미션으로 읽기 전용 분석**을 돌려 리포트+작업 프롬프트를 만든다(아침에 실제 세션에 붙여넣어 수정 작업).

흐름: 후보 조회(내 미해결 이슈 − 해결·숨김·기분석) → [분석] → **프로젝트 선택(프로젝트 레지스트리 참조 — 학습값 suggestedRepoId → Jira 키 일치 → 첫 프로젝트 순 기본 선택, 티켓의 Jira 키와 일치하는 프로젝트가 목록 앞에 정렬)** → Jira REST 로 티켓·댓글·첨부 수집 → 관찰 모드 미션 실행 → 저장소 변조 사후 검증 → 원장 기록.

**이름과 달리 야간 자동 스케줄러는 없음 — 수동 트리거가 유일한 진입점**, 실행 중 추가 요청은 대기열로 순차 처리.

안전장치: `--disallowedTools Edit MultiEdit NotebookEdit` 로 편집 도구 차단 + 읽기 전용 계약 프롬프트 + 미션 전후 `git status/diff` 비교로 변조 감지(`violation_edited` 경고, patch 증거 보존).

산출물은 `userData/nightwatch/` — `reports/{key}.md`(마크다운 렌더)·`{key}.prompt.md`(복사용)·`work/{key}/`·`logs/`, 원장 `state.json`, 설정 `config.json`(Claude 계정·타임아웃 기본 40분 — 분석 대상 저장소 목록은 프로젝트 레지스트리로 이관). 비용은 stream-json 의 `total_cost_usd` 를 기록해 처리한 티켓 행에 표시. 숨김·[재분석]·30일 자동 정리·앱 시작 시 좀비 정리 포함. 1분 자동 새로고침.
