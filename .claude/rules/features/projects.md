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
