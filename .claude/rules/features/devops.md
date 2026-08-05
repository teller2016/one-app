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

상태는 배포 탭을 보는 동안 1분마다 자동 새로고침(젠킨스에서 직접 돌린 빌드도 반영), 빌드중엔 5초 틱으로 진행률 갱신. 프로젝트 하나에 배포 대상 여러 개(스토어·어드민 등) 등록 가능. 젠킨스 URL·계정은 배포 탭에서 프로젝트별로 등록하고, API 토큰(또는 비밀번호)은 `safeStorage` 로 암호화해 `userData/deploy.json` 에 저장. 인증은 Basic Auth + API 토큰 권장(비밀번호 인증은 CSRF crumb 자동 처리).

## PR (Gitea)
`renderer/features/prs` + `main/features/prs`

push → PR 생성 → 머지 루프를 앱에서 끝내는 섹션.

**빠른 PR**: **프로젝트 레지스트리의 Gitea 프로젝트**(`remoteKind==='gitea'` + owner/repo 파싱 가능)별로 최근 push 브랜치를 자동 표시(branches API, 커밋시간 정렬 — 저장소 관리는 프로젝트 탭, 여기엔 추가/삭제 UI 없음) → [PR 만들기] 모달에서 **프로젝트 defaultBranch(빈 값 develop)** 대비 커밋 확인 + 제목(브랜치명의 BBJ-#### 자동 추출)·본문(커밋 불릿) 자동 생성 → 생성 성공 시 **머지 모달로 자동 연결**.

**머지**: 목록 행 [머지] → `mergeable`(컨플릭트) 사전 확인 + 방식(merge/squash/rebase) 선택 → `/pulls/{n}/merge`.

생성·머지는 **Gitea 토큰 필수**(없으면 배너 안내·버튼 숨김). 목록은 **전역 이슈 검색 API**(`/repos/issues/search?type=pulls&state=open`)로 접근 가능한 전체 저장소의 열린 PR + 리뷰 승인 수 뱃지, **조직(owner)별 그룹핑** + 조직 칩 제외 필터(`store.ts`, `userData/prs.json`), 2분 자동 새로고침.

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
