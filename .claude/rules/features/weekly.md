---
paths:
  - "src/main/features/weekly/**"
  - "src/renderer/features/weekly/**"
---

# 주간보고 (FE챕터 개인별 주간)

> 로그인·쿠키는 전부 공용 세션 모듈이 담당한다 — `groupware-session` 규칙을 함께 볼 것. 계정은 환경설정의 비즈박스 공용.

`renderer/features/weekly` + `main/features/weekly`

FE챕터 공유일정의 **개인별 주간** 화면을 숨긴 자동화 창으로 수집해(로그인은 공용 세션 쿠키 주입 → `portalUrl` 직행) 팀원별 T/OT·MM 을 카드+차트(chart.js)로 표시. 엑셀 다운로드 없이 페이지의 `calendarExcelSave()` form submit 을 후킹해 `datas`(JSON payload)를 가로챈다(익스텐션 `fe-schedule-extension` 이식). 주간 이동은 페이지 함수 `beforeWeek()`/`nextWeek()`, 현재 주는 iframe 전역 `startDate`/`endDate`(YYYYMMDD)로 판별.

개인별 주간 진입/주간 이동 직후 일정 목록이 ajax 로 늦게 채워지므로 **datasExcel 행 수 안정화 대기 + 캡처 재시도**가 들어 있음(제거하면 빈 결과 레이스 재발).

T/OT 규칙: 하루 8시간까지 T, 초과분 OT, MM=시간÷8÷20.6. 전체 MM 제외 프로젝트는 칩 클릭으로 토글(localStorage `weekly:mmExcluded`, 기본 FE·전사·본부·휴가·연차·시차). 주 기준은 기본 일~토(페이지 단위)이며, 툴바 **[월~일 기준] 체크박스**(localStorage `weekly:monWeek`)를 켜면 두 주(일~토 ×2)를 수집해 월~토+다음 주 일요일을 이어 붙인다(수집 시간 증가, 데드라인 +60초).

⚠️ 주간 이동(특히 `beforeWeek()`) 시 페이지가 이전 주 행을 `datas` 에 누적한 채 남기므로, **캡처 행을 대상 주 날짜(MM.DD) 집합으로 한정하는 필터가 필수**(`mmddSet`·`dayMmdd`, 제거하면 여러 주 합산 재발 — 2026-07 실측 확인).
