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

## 화면 구조 (2026-09-30 리디자인 — 목업 Weekly.dc.html)
- 섹션 제목 없음. 주 이동(`[‹] 지난주 (범위 모노) [›] [이번주]`)은 `TopbarSlot` left, `월~일 기준` 체크 + [주간보고 분석]은 right.
- 결과가 있으면 요약 띠(44 · 바닥선 — 기간 모노 pill · 인원 pill · 미달/초과 fail) → 풀블리드 2단: 명단 280(패널 면 · 행 66 · 선택 = 틴트 + 좌측 2px 바) · 상세(그라운드 · padding 18 22 · gap 14). **둘 다 자기 스크롤**(예전 sticky 명단은 폐기).
- 38시간이 아니면(미달·초과) 시간·진행바는 **`--warning`**(예전 `--danger` 에서 목업대로 바꿈). 상세 머리 시간은 모노 22/500.
- 차트는 chart.js 옵션으로 목업 모양을 낸다: 요일마다 T·OT 두 막대(폭 14)를 프로젝트 색으로 쌓고 **OT 는 같은 색 50%**(`chartTheme.withAlpha`), 격자선 없음·왼쪽 축과 바닥선만, 눈금 모노 10 흐린 잉크, **chart.js 범례는 끄고 HTML 범례**(막대 = T/OT 견본, 도넛 = 프로젝트 견본 목록). 도넛은 150 · cutout 69% · 조각 경계선 없음.
- ⚠️ 차트 캔버스는 **높이가 고정된 칸 안에** 둔다(막대 188 · 도넛 150, `maintainAspectRatio: false`) — 칸 높이가 없으면 캔버스가 세로로 무한히 자란다.
- MM 칩은 공용 `.chip`(제외 = 점선·흐림·취소선) + 내부만 `weekly-chip__*`(이름 500 · "T 22h (0.13)" 모노 11.5 · OT 주의색). 상세 일정은 패널(머리 42) 안 3열 그리드, 블록 = 가라앉은 면 + T(accent)/OT(busy) 점 없는 뱃지 + [Copy] xs + 한 줄 말줄임 일정.
