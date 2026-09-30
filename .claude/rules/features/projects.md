---
paths:
  - "src/main/features/projects/**"
  - "src/renderer/features/projects/**"
---

# 프로젝트 레지스트리 (중앙 관리 지점)

> 배포·PR·Jira·Nightwatch 가 전부 여기를 참조한다 — `features/deploy`·`features/prs`·`features/jira`·`features/nightwatch`.

`renderer/features/projects` + `main/features/projects`

**프로젝트 중앙 레지스트리(관리 지점)** — 이름·로컬 경로(필수) + 원격 저장소 종류(gitea/bitbucket/기타)·주소·기본 브랜치·Jira 프로젝트 키를 `userData/projects.json`(평문 — 비밀 없음, 토큰은 환경설정 담당)에 CRUD.

**새 기능이 프로젝트 경로·저장소 정보가 필요하면 자체 저장하지 말고 여기를 참조할 것**:
- main 은 `features/projects/store.ts` 의 조회 헬퍼(`getProject`·`findProjectByPath`·`findProjectByRepo`·`findProjectsByJiraKey`·`remoteOwnerRepo`)를 직접 import
- 렌더러는 `window.oneApp.projects.*`(list/save/delete/pickDir/onChanged)
- 원격 주소의 owner/repo 파싱은 `shared/types.ts` 의 `ownerRepoFromUrl`(main·렌더러 공용)

저장·삭제 시 `projects:changed` 브로드캐스트로 전 창 실시간 반영. sanitize: 로컬 경로 `~/` 치환+절대경로 정규화·끝 슬래시 제거, Jira 키 대문자, remoteKind 검증 실패 시 gitea.

**PR(빠른 PR)·Nightwatch(분석 대상)는 레지스트리 참조로 전환 완료** — 배포(젠킨스)는 저장소 주소를 빌드 메타데이터에서 런타임 추출하므로 아직 자체 관리(연결 키가 없어 스키마 변경이 선행돼야 한다).

## 화면 구조 (2026-09-30 리디자인 — 목업 Projects·ProjectForm 이 정본)
- 목록: 섹션 제목 없음 · [프로젝트 추가]는 탑바 오른쪽 끝(`TopbarSlot`) · 본문 padding 24 28 · 카드 목록 max 920 · gap 10. 카드 padding 14 16 · gap 8 · hover 윤곽만 한 단, 이름 15/600 + 원격 종류 뱃지(원격 주소 있을 때만) + [편집][삭제] `Button xs`, 경로 모노 12, 메타 12 · gap 14(원격 주소 모노 액센트 + 외부 아이콘 — http(s) 만 링크, `git@` 는 글자만 · 브랜치/Jira 값은 모노).
- 폼: 페이지 제목 h1(20/600) + 패널 안 2열 그리드(라벨 120 · column-gap 16 · row-gap 14) · 경로·주소·브랜치·키 입력은 모노 12.5 · 원격 종류 Select 132 · 브랜치 max 240 · Jira 키 max 160 · 안내 · 구분선 · [저장][취소]. 폼은 목록 자리를 대체한다(모달 아님).
- 탑바 경로는 `그룹 / 섹션 / 하위 화면` 세 단 — 폼은 `<TopbarSlot crumb='프로젝트 편집'>` 으로 셋째 칸을 채운다(탑바 없는 셸은 페이지 h1 이 대신).
