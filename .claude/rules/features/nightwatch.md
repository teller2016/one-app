---
paths:
  - "src/main/features/nightwatch/**"
  - "src/renderer/features/nightwatch/**"
---

# Nightwatch (Jira 티켓 무인 분석)

> 후보 조회는 `features/jira` 의 `fetchMyIssues()`, 분석 대상은 프로젝트 레지스트리(`features/projects`).

`renderer/features/nightwatch` + `main/features/nightwatch`

Jira 버그 티켓을 골라 **headless `claude` CLI 미션으로 읽기 전용 분석**을 돌려 리포트+작업 프롬프트를 만든다(아침에 실제 세션에 붙여넣어 수정 작업).

흐름: 후보 조회(내 미해결 이슈 **+ Jira 섹션에서 직접 추가한 티켓(pinned)** − 숨김·기분석) → [분석] → **프로젝트 선택(프로젝트 레지스트리 참조 — 학습값 suggestedRepoId → Jira 키 일치 → 첫 프로젝트 순 기본 선택, 티켓의 Jira 키와 일치하는 프로젝트가 목록 앞에 정렬)** → Jira REST 로 티켓·댓글·첨부 수집 → 관찰 모드 미션 실행 → 저장소 변조 사후 검증 → 원장 기록.

진입점 둘 — **수동 [분석]** 과 **자동 순회**(`scheduler.ts`). 실행 중 추가 요청은 대기열로 순차 처리.

**자동 순회** (설정 → 자동 분석 토글, `config.json` 의 `auto`): 시각 스케줄이 아니라 **토글이 스위치**다.
켜져 있는 동안 **5분마다** 미처리 후보를 확인해 **한 건씩** 시작한다(`isAnalysisActive()` 게이트 —
수동 분석·대기열과 경합하지 않는다). 토글은 `nightwatch:config:save` 가 `refreshNightwatchSchedule()`
을 불러 **재시작 없이** 붙었다 떨어지고, 꺼두면 인터벌 자체가 없다.
- **저장소 결정 3단 폴백**: ① 학습값(`repoDefaults`) → ② `pickRepoWithClaude()` 경량 호출(도구 전면
  차단·`--output-format json`·신뢰도 0.5 미만이면 불채택) → ③ Jira 키 일치 프로젝트가 **정확히 하나**일 때.
  ⚠️ 선택 호출은 **haiku 고정**(`PICK_MODEL`)이고 설정의 자동 분석 모델과 분리돼 있다 — 2026-08-20 실측
  8초·$0.033 로 분류엔 충분했고, 상위 모델로 돌리면 학습값 없는 티켓마다 고정비가 붙는다.
  ⚠️ "no code fence" 라고 지시해도 응답이 ```json 펜스로 온다(실측) → `extractJsonObject()` 로만 파싱.
  ⚠️ `execFile` 뒤 **`child.stdin?.end()`** 를 부른다 — 안 닫으면 CLI 가 파이프 입력을 3초 기다린다.
  셋 다 실패하면 그 티켓은 **그날 하루** 건너뛴다(`auto-state.json` 의 `skipped`) — 매 tick 마다 같은
  티켓에 선택 호출을 다시 태우면 비용만 쓴다. 모델이 낸 `repoId` 는 **레지스트리로 다시 검증**한다.
- ⚠️ **같은 티켓 반복 분석 경로는 없다** — `listCandidates()` 가 원장에 있는 티켓(실패·위반 포함)을
  후보에서 빼므로, 후보가 소진되면 조용히 대기하다 새 티켓이 생길 때만 다시 집는다.
- 진행 상태는 `auto-state.json`(날짜·오늘 건수·skipped·마지막 확인/선택/오류)에 **즉시 저장**한다.
  메모리에만 두면 재시작이 하루 상한과 '오늘 건너뜀' 기억을 지워 선택 호출을 다시 태운다.
- 하루 상한 `maxPerDay` 는 **기본 0 = 무제한**(후보 소진이 자연 종료 조건). 부팅 경로는 즉시 돌지 않고
  첫 tick(5분 뒤)부터 — 앱을 켜자마자 무인 미션이 뜨지 않게 `refreshNightwatchSchedule({immediate})` 로 갈랐다.
- 자동 실행은 **알림을 띄우지 않는다**(알럿이 무인 실행마다 뜨면 방해). 결과는 섹션 목록·사이클 로그로 확인.
- 자동으로 돌던 미션이 앱 종료로 끊기면 `sweepInterruptedTickets()` 가 `failed` 로 남긴다 → 원장에 있으니
  자동으로 다시 집지 않는다(의도 — 무인 재시도 루프 방지). 필요하면 [재분석]으로 수동 재실행.

⚠️ **pinned 티켓은 해결 상태여도 후보에 남긴다** — 내 담당이 아닐 수 있고 사용자가 명시적으로 넣은
티켓인데, 해결됨으로 사라지면 분석할 경로가 없다(Jira 섹션은 '해결됨' 그룹에 접어 두지만 여기엔 그
그룹이 없다). 대신 후보에 `resolved` 를 실어 **자동 순회는 해결건을 건너뛴다**(이미 끝난 일에 무인
비용을 쓰지 않는다 — 수동 [분석]은 언제든 가능). 후보 행에는 `pin` 아이콘으로 출처를 표시한다.

안전장치: `--disallowedTools Edit MultiEdit NotebookEdit` 로 편집 도구 차단 + 읽기 전용 계약 프롬프트 + 미션 전후 `git status/diff` 비교로 변조 감지(`violation_edited` 경고, patch 증거 보존).

산출물은 `userData/nightwatch/` — `reports/{key}.md`(마크다운 렌더)·`{key}.prompt.md`(복사용)·`work/{key}/`·`logs/`, 원장 `state.json`, 자동 순회 진행 `auto-state.json`, 설정 `config.json`(Claude 계정·타임아웃 기본 40분 — 분석 대상 저장소 목록은 프로젝트 레지스트리로 이관). 비용은 stream-json 의 `total_cost_usd` 를 기록해 처리한 티켓 행에 표시. 숨김·[재분석]·30일 자동 정리·앱 시작 시 좀비 정리 포함. 1분 자동 새로고침.
