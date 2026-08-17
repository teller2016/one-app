---
paths:
  - "src/main/features/nightwatch/**"
  - "src/renderer/features/nightwatch/**"
---

# Nightwatch (Jira 티켓 무인 분석)

> 후보 조회는 `features/jira` 의 `fetchMyIssues()`, 분석 대상은 프로젝트 레지스트리(`features/projects`).

`renderer/features/nightwatch` + `main/features/nightwatch`

Jira 버그 티켓을 골라 **headless `claude` CLI 미션으로 읽기 전용 분석**을 돌려 리포트+작업 프롬프트를 만든다(아침에 실제 세션에 붙여넣어 수정 작업).

흐름: 후보 조회(내 미해결 이슈 − 해결·숨김·기분석) → [분석] → **프로젝트 선택(프로젝트 레지스트리 참조 — 학습값 suggestedRepoId → Jira 키 일치 → 첫 프로젝트 순 기본 선택, 티켓의 Jira 키와 일치하는 프로젝트가 목록 앞에 정렬)** → Jira REST 로 티켓·댓글·첨부 수집 → 관찰 모드 미션 실행 → 저장소 변조 사후 검증 → 원장 기록.

**이름과 달리 야간 자동 스케줄러는 없음 — 수동 트리거가 유일한 진입점**, 실행 중 추가 요청은 대기열로 순차 처리.

안전장치: `--disallowedTools Edit MultiEdit NotebookEdit` 로 편집 도구 차단 + 읽기 전용 계약 프롬프트 + 미션 전후 `git status/diff` 비교로 변조 감지(`violation_edited` 경고, patch 증거 보존).

산출물은 `userData/nightwatch/` — `reports/{key}.md`(마크다운 렌더)·`{key}.prompt.md`(복사용)·`work/{key}/`·`logs/`, 원장 `state.json`, 설정 `config.json`(Claude 계정·타임아웃 기본 40분 — 분석 대상 저장소 목록은 프로젝트 레지스트리로 이관). 비용은 stream-json 의 `total_cost_usd` 를 기록해 처리한 티켓 행에 표시. 숨김·[재분석]·30일 자동 정리·앱 시작 시 좀비 정리 포함. 1분 자동 새로고침.
