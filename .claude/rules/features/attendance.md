---
paths:
  - "src/main/features/attendance/**"
  - "src/renderer/features/attendance/**"
---

# 출퇴근 (근태 위젯 · 리마인더)

> 로그인·쿠키는 전부 공용 세션 모듈이 담당한다 — `groupware-session` 규칙을 함께 볼 것. 계정은 환경설정의 비즈박스 공용.

`renderer/features/attendance` + `main/features/attendance`

사이드바 하단 고정 위젯(공용 `SidebarWidget` 셸 — 접히면 아이콘 타일 + 팝오버. 축소 타일에는 조회 실패를 `StatusDot fail` 로, 출퇴근 완료를 체크로 알린다). 숨긴 자동화 창에 **공용 그룹웨어 세션 쿠키를 주입**해(`gotoWithSessionInWindow`, 로그인 화면 안 거침) userMain.do 근태 위젯(`#tab1`/`#tab2`)에서 출퇴근 시각을 읽고, 찍을 때는 그룹웨어 자체 함수 `fnAttendCheck(1=출근, 4=퇴근)`를 호출(confirm 자동 수락). 계정은 환경설정의 비즈박스 계정 공용(로그인은 공용 세션 모듈이 담당 — `runAttendance(action)` 는 계정 인자를 받지 않는다). 실수 방지를 위해 클릭 시 앱에서 확인 대화상자를 거친다.

### 출퇴근 리마인더
`main/features/attendance/scheduler.ts` + `reminders.ts`

환경설정에서 **요일별(월~금)로 출근·퇴근 알림 시각**을 각각 지정(체크박스+시각). 메인 스케줄러가 매 30초 현재 시각을 확인해, 설정 시각(±2분, 슬립 대비)이 되면 근태 상태를 조회(`runAttendance('status')`)하고 **이미 찍었으면 건너뛰고 안 찍었을 때만** 알림(스마트 스킵).

알럿의 **[지금 출근/퇴근 찍기]** 버튼으로 그 자리에서 바로 찍을 수 있고(성공/실패 결과 알럿 표시, 성공 시 그날 리마인더 중지 + `attendance:changed` 이벤트로 사이드바 위젯 즉시 갱신), 상태 확인 실패(계정 없음·VPN 등)면 놓치지 않도록 알림을 띄운다(실패 알림은 하루 1회). 평일만, 기본 하루 한 번(중복 방지).

**반복 알림**(`repeat: {enabled, minutes}`, 1~120분)을 켜면 설정 시각 이후 안 찍은 동안 N분 간격으로 재알림 — 앱을 늦게 켜도 발화하고, 찍은 게 확인되면 그날은 멈추며, 알럿을 안 닫고 있는 동안은 반복하지 않는다(닫은 시점부터 다시 카운트). 설정은 `userData/reminders.json`(평문). 스케줄러는 저장값을 매 tick 읽으므로 저장 후 재시작 불필요.

**하루 단위 상태는 디스크에 남긴다**(2026-08-09) — `userData/reminder-state.json`(`date`·`done`·`failSafe`·`lastAttempt`). 메모리에만 두면 **앱을 재시작하는 순간 "오늘은 이미 처리했다"는 기억이 사라져** 반복 알림이 처음부터 다시 발화하고 '하루 1회'인 실패 폴백 알림도 재발화한다(개발 중엔 재시작마다). 날짜가 다르면 복원하지 않고 버린다.

- ⚠️ **`alertOpen`·`inProgress` 는 저장하지 않는다** — 프로세스 생명주기 상태라, 저장하면 알럿이 떠 있던 채로 죽었을 때 그날 내내 발화가 막힌다.
- **타이머 유휴화**: 설정에 켜진 슬롯이 하나도 없으면 30초 인터벌 자체를 안 돌린다(`refreshReminderSchedule()` — `reminders:set` 이 저장 후 호출하므로 재시작 없이 켜고 꺼진다). 요일 판정은 tick 이 계속 하므로 여기서는 설정만 본다(주말이어도 타이머는 돌고 tick 이 즉시 반환). ⚠️ 이득은 **리마인더를 전부 꺼둔 사용자에게만** 있다.

## 야근 결재 → **결재 기능으로 이동** (`features/approval.md`)
야근 결재(연장근무내역서)는 휴가신청서·지출결의서와 함께 **결재 섹션**(`features/approval`)으로 합쳤고,
자동화도 puppeteer 에서 **Electron BrowserWindow** 로 바뀌었다. 상세·함정은 `features/approval` 규칙을 볼 것.

출퇴근 위젯의 아이콘 버튼(`sbw__overtime`) → `OvertimeModal` 진입점은 그대로 유지된다(모달 본문은
결재 섹션의 `OvertimeForm` 재사용). **상신(쓰기) 흐름이라 MO(폰) 셸에서는 이 클래스를 숨겨 제외**한다.
사이드바를 접었을 때는 근태 아이콘 타일 → 팝오버 안에 이 버튼이 있다(공용 `SidebarWidget` — 예전엔
축소 모드에서 `.sbw__actions` 가 감춰져 진입로 자체가 없었다).
