---
paths:
  - "src/main/features/changes/**"
  - "src/renderer/features/changes/**"
  - "src/mobile-app/views/MoChangesView.tsx"
---

# 변경사항 (워킹트리 git 상태·diff·push)

`renderer/features/changes` + `main/features/changes`

"AI 에 작업 시키고 → 변경 확인 → AI 로 커밋 → 푸시" 루프의 **확인·푸시** 담당 — **커밋은 만들지 않는다**(커밋은 터미널 세션의 에이전트가).

## 진입점 둘
- **터미널 우측 드로어**: 툴바 git-branch 토글, localStorage `terminal:changesOpen`, 활성 세션 cwd 대상 — 좌측 grip 드래그로 너비 조절 240~640px, localStorage `terminal:changesWidth`.
- **MO '변경' 탭**: `mobile-app/views/MoChangesView` — 프로젝트 레지스트리 선택 + 같은 `ChangesView` 재사용.

## main 의 git 실행 (`/usr/bin/git` execFile)
1. **상태**: `status --porcelain --branch --untracked-files=all`(⚠️ 기본값은 새 디렉터리를 통째 `dir/` 로 묶어 파일별 diff 가 안 된다 — 2026-08 실측) + `diff HEAD --numstat`(+/− 수) + `log @{u}..HEAD`(푸시 대기 커밋)
2. **파일 diff**: 추적 파일은 `diff HEAD`, untracked 는 `--no-index /dev/null`(**exit 1 이 정상**), 512KB 초과는 truncated
3. **푸시**: upstream 없으면 `-u origin HEAD`

전 명령 `core.quotepath=false`(한글 경로 보존) + `GIT_TERMINAL_PROMPT=0` + 타임아웃(headless 인증 프롬프트 hang 차단).

## 보안 — 폰에 열리는 채널
IPC 3채널 전부 `handleShared`(MO 화이트리스트) — ⚠️ **클라이언트가 경로를 직접 못 넘긴다**: `ChangesTarget`(projectId/sessionId)만 받아 main 이 해석하고, diff 파일 경로도 저장소 밖 탈출을 검증한다(폰에 열리는 채널이라 임의 디렉터리 git 실행 차단).

## 뷰
보이는 동안 5초 폴링(선택 파일 diff 도 함께 갱신 — 에이전트가 고치는 중 따라감), 커밋되면 파일 목록이 비고 '푸시 대기 커밋'+[푸시 ↑N] 로 나타난다. 세션 종료와 폴링의 레이스는 try/catch 로 에러 화면 처리(안 하면 매 틱 unhandled rejection — 실측). diff 렌더는 라이브러리 없이 줄 prefix 파싱 + `panel-dark` 토큰(--ok/--danger 재매핑).
