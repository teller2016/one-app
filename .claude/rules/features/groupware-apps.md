---
paths:
  - "src/main/features/schedule/**"
  - "src/main/features/attendance/**"
  - "src/main/features/overtime/**"
  - "src/main/features/weekly/**"
  - "src/main/features/mail/**"
  - "src/renderer/features/schedule/**"
  - "src/renderer/features/attendance/**"
  - "src/renderer/features/overtime/**"
  - "src/renderer/features/weekly/**"
  - "src/renderer/features/mail/**"
---

# 그룹웨어 기능 (일정 등록 · 출퇴근 · 야근 결재 · 주간보고 · 메일)

> 로그인·쿠키는 전부 공용 세션 모듈 담당 — `groupware-session` 규칙을 함께 볼 것.

## 일정 등록
`renderer/features/schedule` + `main/features/schedule`

비즈박스 그룹웨어에 하루 일정을 puppeteer 로 자동 등록. 하루 작업은 **타임라인 카드**(행마다 계산된 시작→종료·소요시간 칩, 12:30 종료 뒤 점심 구분선, 헤더에 합계·OT — 점심 규칙 12.5/13.5 는 `config.ts` 와 동기)로 중간중간 기록(종료시간 TimePicker + 일정명 + [추가], 시간순 자동 정렬, 추가 행에 다음 시작 시각 표시). 날짜·시작 시간은 상단 툴바 한 줄(시작은 TimePicker), 실행 로그는 실행 전엔 숨김.

**작업 항목과 시작 시각**(`ScheduleWorklog` = `{ items, startTime }`)이 **`userData/worklog.json`** 에 IPC(`schedule:worklog:get/set`, 렌더러 300ms 디바운스)로 즉시 저장되어 탭 이동·재시작·강제 종료에도 유지된다(예전 배열 형식 저장본은 읽을 때 자동 승격, [비우기]는 항목만 지우고 시작 시각은 유지, 기본값 `SCHEDULE_DEFAULT_START_TIME`. 날짜 선택은 오등록 방지를 위해 저장하지 않고 매번 '오늘'로 시작).

⚠️ localStorage 는 이 앱에서 강제 종료 시 디스크 flush 가 안 돼 유실된다(2026-07-29 실측) — 보존할 데이터에 쓰지 말 것.

등록·복사 시 `종료시간(십진) 일정명` 줄 텍스트로 변환하며(10:30→`10.5`), **[노션용 복사]** 버튼으로 그 형식 그대로 클립보드에 복사(노션 기록용), [비우기]는 확인 다이얼로그 경유. 계정 정보는 **환경설정 탭**에서 입력 → `safeStorage` 로 암호화 저장. 실행 시 자동화 브라우저가 열리며, 완료 후에도 확인용으로 유지된다.

## 출퇴근
`renderer/features/attendance` + `main/features/attendance`

사이드바 하단 고정 위젯. headless puppeteer 로 **공용 그룹웨어 세션 쿠키를 주입**해(`gotoWithSession`, 로그인 화면 안 거침) userMain.do 근태 위젯(`#tab1`/`#tab2`)에서 출퇴근 시각을 읽고, 찍을 때는 그룹웨어 자체 함수 `fnAttendCheck(1=출근, 4=퇴근)`를 호출(confirm 자동 수락). 계정은 환경설정의 비즈박스 계정 공용(로그인은 공용 세션 모듈이 담당 — `runAttendance(action)` 는 계정 인자를 받지 않는다). 실수 방지를 위해 클릭 시 앱에서 확인 대화상자를 거친다.

### 출퇴근 리마인더
`main/features/attendance/scheduler.ts` + `reminders.ts`

환경설정에서 **요일별(월~금)로 출근·퇴근 알림 시각**을 각각 지정(체크박스+시각). 메인 스케줄러가 매 30초 현재 시각을 확인해, 설정 시각(±2분, 슬립 대비)이 되면 근태 상태를 조회(`runAttendance('status')`)하고 **이미 찍었으면 건너뛰고 안 찍었을 때만** 알림(스마트 스킵).

알럿의 **[지금 출근/퇴근 찍기]** 버튼으로 그 자리에서 바로 찍을 수 있고(성공/실패 결과 알럿 표시, 성공 시 그날 리마인더 중지 + `attendance:changed` 이벤트로 사이드바 위젯 즉시 갱신), 상태 확인 실패(계정 없음·VPN 등)면 놓치지 않도록 알림을 띄운다(실패 알림은 하루 1회). 평일만, 기본 하루 한 번(중복 방지).

**반복 알림**(`repeat: {enabled, minutes}`, 1~120분)을 켜면 설정 시각 이후 안 찍은 동안 N분 간격으로 재알림 — 앱을 늦게 켜도 발화하고, 찍은 게 확인되면 그날은 멈추며, 알럿을 안 닫고 있는 동안은 반복하지 않는다(닫은 시점부터 다시 카운트). 설정은 `userData/reminders.json`(평문). 스케줄러는 저장값을 매 tick 읽으므로 저장 후 재시작 불필요.

## 야근 결재 (연장근무내역서 상신)
`renderer/features/overtime` + `main/features/overtime`

진입점은 **출퇴근 위젯의 아이콘 버튼**(`sbw__overtime`) → `OvertimeModal`. **상신(쓰기) 흐름이라 MO(폰) 셸에서는 이 클래스를 숨겨 제외**한다.

headless 브라우저로 전자결재 **연장근무내역서 양식 팝업**(`EAAppDocPop.do?form_id=41`)을 URL 로 직접 열어 제목·근무자 표·업무내용을 채우고 [상신]까지 자동화한다. 결재선 기본값이 '본인'이라 **승인은 사용자가 미결함에서 직접** 한다. 완료 후 모달의 '결재하러 가기'가 `docViewUrl(docId)` 를 기본 브라우저로 연다. 그룹웨어 화면이 바뀌면 `config.ts` 의 `selectors` 만 고치면 된다.

로그인은 공용 세션이 아니라 `withGroupwareLogin()` **직렬화 큐**를 경유한다(쓰기 흐름이라 E2E 검증이 어려워 `gotoWithSession` 이관 보류 — `groupware-session` 규칙 참고). 시스템 설치 Chrome 을 쓴다(`channel: 'chrome'` — 배포판에 Chromium 을 동봉하지 않기 위함).

⚠️ **함정 (제거하면 조용히 실패한다)**
- `waitFormReady` 는 제목·에디터 본문뿐 아니라 **품의번호(`#ddlNumberingID`)·결재라인 JSON(`#hidAppDocLine`)·[상신] 버튼의 jQuery click 핸들러 바인딩**까지 확인한다. 덜 로드된 상태에서 누르면 **경고만 뜨고 조용히 무시**된다.
- 본문은 **이중 iframe**(`#editorView` → `#dzeditor_0`) 안의 contentEditable 문서를 직접 수정한다.
- [상신]은 좌표 클릭이 로딩 오버레이에 가로채이므로 **JS `.click()` 으로 핸들러를 직접 발화**한다.
- 성공 판정은 `#hidDocID` 가 **새 문서 id 로 바뀌는 것**이고, 실패는 커스텀 다이얼로그 `.PUDD-UI-Message`(네이티브 dialog 아님)의 문구다 — `page.on('dialog')` 로는 못 잡는다.
- 30초 내 응답을 확인 못 하면 **재시도하지 말라고 안내**한다(이미 상신됐을 수 있음). 모듈 스코프 `running` 플래그로 동시 실행도 막는다.

업무 대상·수행 내용·연장근무 사유는 마지막 값을 `userData/overtime.json`(평문)에 저장해 다음 입력 기본값으로 쓴다.

## 주간보고
`renderer/features/weekly` + `main/features/weekly`

FE챕터 공유일정의 **개인별 주간** 화면을 headless puppeteer 로 수집해 팀원별 T/OT·MM 을 카드+차트(chart.js)로 표시. 엑셀 다운로드 없이 페이지의 `calendarExcelSave()` form submit 을 후킹해 `datas`(JSON payload)를 가로챈다(익스텐션 `fe-schedule-extension` 이식). 주간 이동은 페이지 함수 `beforeWeek()`/`nextWeek()`, 현재 주는 iframe 전역 `startDate`/`endDate`(YYYYMMDD)로 판별.

개인별 주간 진입/주간 이동 직후 일정 목록이 ajax 로 늦게 채워지므로 **datasExcel 행 수 안정화 대기 + 캡처 재시도**가 들어 있음(제거하면 빈 결과 레이스 재발).

T/OT 규칙: 하루 8시간까지 T, 초과분 OT, MM=시간÷8÷20.6. 전체 MM 제외 프로젝트는 칩 클릭으로 토글(localStorage `weekly:mmExcluded`, 기본 FE·전사·본부·휴가·연차·시차). 주 기준은 기본 일~토(페이지 단위)이며, 툴바 **[월~일 기준] 체크박스**(localStorage `weekly:monWeek`)를 켜면 두 주(일~토 ×2)를 수집해 월~토+다음 주 일요일을 이어 붙인다(수집 시간 증가, 데드라인 +60초).

⚠️ 주간 이동(특히 `beforeWeek()`) 시 페이지가 이전 주 행을 `datas` 에 누적한 채 남기므로, **캡처 행을 대상 주 날짜(MM.DD) 집합으로 한정하는 필터가 필수**(`mmddSet`·`dayMmdd`, 제거하면 여러 주 합산 재발 — 2026-07 실측 확인).

## 메일
`renderer/features/mail` + `main/features/mail`

비즈박스 메일을 **사이드바 최상단 위젯**에서 확인. 로그인·쿠키는 **공용 세션 모듈**(`features/groupware`)에 맡기고, 그 쿠키로 `/mail2/` SPA 를 부트스트랩한 뒤 개수·목록·본문 조회는 **전부 순수 HTTP fetch**(리버스 엔지니어링 엔드포인트 — `getMailBoxCount.do`·`getMailList.do`·`readMail.do`/`readMailCont.do`). 메일 캐시는 공용 세션의 `establishedAt` 을 신원으로 삼아, 세션이 새로 수립되면 부트스트랩만 다시 한다. 로그인 페이지 응답이면 공용 세션까지 무효화하고 1회 재로그인, 동시 요청은 establish 공유.

**안읽음 폴링은 포커스 적응형**(활성 30초·백그라운드 3분, 창 복귀 시 즉시). 위젯 아이콘 클릭=브라우저로 메일함(**단 사이드바가 접혀 있으면 앱 내 모달** — 아이콘이 유일한 진입점이 되므로 `useSidebarCollapsed()` 로 분기), 제목 클릭=앱 내 **리더 모달**(좌 목록·우 본문 — 상단 세그먼트로 **받은편지함↔스팸메일함** 전환, 폴더별 `mboxSeq` 는 `getMailBoxCount` 로 동적 조회).

목록 하단에 공용 `Pagination` — `getMailList.do` 의 `page`/`pageSize`(30) 서버 페이징으로 **과거 메일까지 열람**(전체 건수는 `TotalRecordCount`). 조회 조건은 `MailListQuery`({folder, page, pageSize}) 객체로 전달하며, 응답의 `page` 를 요청 순번과 대조해 빠르게 넘길 때 **뒤늦은 응답을 버린다**.

**뱃지 안읽음 수는 폴더별 `unseen` 합**(받은편지함+스팸, 보낸·임시·휴지통 제외 — `config.ts` 의 `unreadExcludedBoxes`)으로 직접 계산한다. ⚠️ 서버의 `allunseen`/`allexist` 집계는 스팸·휴지통·임시보관을 **제외**하며(2026-07-30 실측: `allexist` = INBOX+SENT), 스팸 메일은 도착 시점부터 **읽음 상태로 들어와** 실질적으로 뱃지에 잡히지 않는다.

본문은 main 의 `sanitizeHtml`(script/iframe/on* 제거) + **sandbox iframe(srcDoc)** 이중 방어로 렌더하고, 링크는 기본 브라우저로만 나간다(열면 그룹웨어에서도 읽음 처리). 계정은 비즈박스 공용, 자체 파일 저장 없음.
