---
paths:
  - "src/main/features/schedule/**"
  - "src/main/features/attendance/**"
  - "src/main/features/weekly/**"
  - "src/main/features/mail/**"
  - "src/renderer/features/schedule/**"
  - "src/renderer/features/attendance/**"
  - "src/renderer/features/weekly/**"
  - "src/renderer/features/mail/**"
---

# 그룹웨어 기능 (일정 등록 · 출퇴근 · 주간보고 · 메일)

> 로그인·쿠키는 전부 공용 세션 모듈 담당 — `groupware-session` 규칙을 함께 볼 것.

## 일정 등록
`renderer/features/schedule` + `main/features/schedule`

비즈박스 그룹웨어에 하루 일정을 자동 등록(자동화 창 — `lib/browser.ts`, 사용자가 보게 띄운다. 로그인은 공용 세션 쿠키 주입 → `portalUrl` 직행). 하루 작업은 **타임라인 카드**(행마다 계산된 시작→종료·소요시간 칩, 12:30 종료 뒤 점심 구분선, 헤더에 합계·OT — 점심 규칙 12.5/13.5 는 `config.ts` 와 동기)로 중간중간 기록(종료시간 TimePicker + 일정명 + [추가], 시간순 자동 정렬, 추가 행에 다음 시작 시각 표시). 날짜·시작 시간은 상단 툴바 한 줄(시작은 TimePicker), 실행 로그는 실행 전엔 숨김.

**작업 항목과 시작 시각**(`ScheduleWorklog` = `{ items, startTime }`)이 **`userData/worklog.json`** 에 IPC(`schedule:worklog:get/set`, 렌더러 300ms 디바운스)로 즉시 저장되어 탭 이동·재시작·강제 종료에도 유지된다(예전 배열 형식 저장본은 읽을 때 자동 승격, [비우기]는 항목만 지우고 시작 시각은 유지, 기본값 `SCHEDULE_DEFAULT_START_TIME`. 날짜 선택은 오등록 방지를 위해 저장하지 않고 매번 '오늘'로 시작).

⚠️ localStorage 는 이 앱에서 강제 종료 시 디스크 flush 가 안 돼 유실된다(2026-07-29 실측) — 보존할 데이터에 쓰지 말 것.

등록·복사 시 `종료시간(십진) 일정명` 줄 텍스트로 변환하며(10:30→`10.5`), **[노션용 복사]** 버튼으로 그 형식 그대로 클립보드에 복사(노션 기록용), [비우기]는 확인 다이얼로그 경유. 계정 정보는 **환경설정 탭**에서 입력 → `safeStorage` 로 암호화 저장. 실행 시 자동화 브라우저가 열리며, 완료 후에도 확인용으로 유지된다.

## 출퇴근
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

## 주간보고
`renderer/features/weekly` + `main/features/weekly`

FE챕터 공유일정의 **개인별 주간** 화면을 숨긴 자동화 창으로 수집해(로그인은 공용 세션 쿠키 주입 → `portalUrl` 직행) 팀원별 T/OT·MM 을 카드+차트(chart.js)로 표시. 엑셀 다운로드 없이 페이지의 `calendarExcelSave()` form submit 을 후킹해 `datas`(JSON payload)를 가로챈다(익스텐션 `fe-schedule-extension` 이식). 주간 이동은 페이지 함수 `beforeWeek()`/`nextWeek()`, 현재 주는 iframe 전역 `startDate`/`endDate`(YYYYMMDD)로 판별.

개인별 주간 진입/주간 이동 직후 일정 목록이 ajax 로 늦게 채워지므로 **datasExcel 행 수 안정화 대기 + 캡처 재시도**가 들어 있음(제거하면 빈 결과 레이스 재발).

T/OT 규칙: 하루 8시간까지 T, 초과분 OT, MM=시간÷8÷20.6. 전체 MM 제외 프로젝트는 칩 클릭으로 토글(localStorage `weekly:mmExcluded`, 기본 FE·전사·본부·휴가·연차·시차). 주 기준은 기본 일~토(페이지 단위)이며, 툴바 **[월~일 기준] 체크박스**(localStorage `weekly:monWeek`)를 켜면 두 주(일~토 ×2)를 수집해 월~토+다음 주 일요일을 이어 붙인다(수집 시간 증가, 데드라인 +60초).

⚠️ 주간 이동(특히 `beforeWeek()`) 시 페이지가 이전 주 행을 `datas` 에 누적한 채 남기므로, **캡처 행을 대상 주 날짜(MM.DD) 집합으로 한정하는 필터가 필수**(`mmddSet`·`dayMmdd`, 제거하면 여러 주 합산 재발 — 2026-07 실측 확인).

## 메일
`renderer/features/mail` + `main/features/mail`

비즈박스 메일을 **사이드바 최상단 위젯**에서 확인. 로그인·쿠키는 **공용 세션 모듈**(`features/groupware`)에 맡기고, 그 쿠키로 `/mail2/` SPA 를 부트스트랩한 뒤 개수·목록·본문 조회는 **전부 순수 HTTP fetch**(리버스 엔지니어링 엔드포인트 — `getMailBoxCount.do`·`getMailList.do`·`readMail.do`/`readMailCont.do`). 메일 캐시는 공용 세션의 `establishedAt` 을 신원으로 삼아, 세션이 새로 수립되면 부트스트랩만 다시 한다. 로그인 페이지 응답이면 공용 세션까지 무효화하고 1회 재로그인, 동시 요청은 establish 공유.

**안읽음 폴링은 포커스 적응형**(활성 30초·백그라운드 3분, 창 복귀 시 즉시). 위젯 아이콘 클릭=브라우저로 메일함(**단 사이드바가 접혀 있으면 앱 내 모달** — 아이콘이 유일한 진입점이 되므로 `useSidebarCollapsed()` 로 분기), 제목 클릭=앱 내 **리더 모달**(좌 목록·우 본문 — 상단 세그먼트로 **받은편지함↔스팸메일함** 전환, 폴더별 `mboxSeq` 는 `getMailBoxCount` 로 동적 조회).

목록 하단에 공용 `Pagination` — `getMailList.do` 의 `page`/`pageSize`(30) 서버 페이징으로 **과거 메일까지 열람**(전체 건수는 `TotalRecordCount`). 조회 조건은 `MailListQuery`({folder, page, pageSize}) 객체로 전달하며, 응답의 `page` 를 요청 순번과 대조해 빠르게 넘길 때 **뒤늦은 응답을 버린다**.

리더 모달 세그먼트의 두 탭에는 **폴더별 안읽음 개수 뱃지**가 붙는다(0 이면 안 붙는다 — 탭을 전환하기 전에 어느 편지함에 새 메일이 있는지 알 수 있게). 값은 `getInbox` 응답의 `folderUnread`({inbox, spam})로, **이미 호출하는 `getMailBoxCount` 의 `mailboxList[].unseen` 에서 뽑으므로 추가 왕복이 없다**. 갱신은 목록을 조회하는 시점(모달 열림·폴더 전환·페이지 이동·새로고침)뿐이고, 안읽은 메일을 열면 해당 폴더 카운트를 로컬에서 −1 한다. 이를 위해 공용 `Segment` 의 `label` 이 `ReactNode` 로 넓어졌다(`.seg` 는 `inline-flex`+`gap` — 텍스트만 있는 기존 사용처는 렌더 결과 동일). ⚠️ 스팸은 도착 시점부터 읽음 상태로 들어와 이 뱃지가 대개 0 이다(아래 실측 참고) — 뱃지가 안 보이는 게 정상 동작일 수 있다.

**뱃지 안읽음 수는 폴더별 `unseen` 합**(받은편지함+스팸, 보낸·임시·휴지통 제외 — `config.ts` 의 `unreadExcludedBoxes`)으로 직접 계산한다. ⚠️ 서버의 `allunseen`/`allexist` 집계는 스팸·휴지통·임시보관을 **제외**하며(2026-07-30 실측: `allexist` = INBOX+SENT), 스팸 메일은 도착 시점부터 **읽음 상태로 들어와** 실질적으로 뱃지에 잡히지 않는다.

본문은 main 의 `sanitizeHtml`(script/iframe/on* 제거) + **sandbox iframe(srcDoc)** 이중 방어로 렌더하고, 링크는 기본 브라우저로만 나간다(열면 그룹웨어에서도 읽음 처리). 조회 계정은 비즈박스 공용이다(아래 인증코드 탭만 별도 계정 파일을 쓴다).

### 팀 공용 계정 인증코드 (피그마)
리더 모달 세그먼트의 **세 번째 탭 '인증코드'**(`AuthCodePanel`) — 팀 공용 피그마 계정(zeplin_fe1/fe2)의 메일함에서 로그인 인증코드를 뽑아 **누르는 즉시 클립보드에 넣는다**(코드를 받는 목적이 붙여넣기라서).

**계정 등록은 환경설정 → [추가 비즈박스 계정]**(`AltAccountsCard` — mail 기능이 `index.ts` 로 공개하고 `SettingsSection` 이 렌더한다). 조회 화면과 등록 화면을 가른 이유는 계정 관리가 다른 계정 설정과 한자리에 있어야 찾기 쉽기 때문이다. 비밀번호는 `safeStorage` 로 암호화해 `userData/alt-mail-accounts.json` 에 두고 렌더러로는 `loginId` 만 나간다. 같은 아이디를 다시 추가하면 비밀번호만 갱신하며, **빈 비밀번호로는 덮어쓰지 않는다**(실수로 로그인이 깨지지 않게). 채널은 `handleShared` 가 아니라 `ipcMain.handle` — 쓰기·비밀 정보라 MO(폰)에 열지 않는다.

내 계정 경로와 갈라지는 지점:
- 로그인은 **`loginWithAccount()`** — 공용 세션 캐시와 분리되고 전용 파티션(`AUTOMATION_PARTITION.altLogin`)을 쓴다. ⚠️ `login` 파티션을 재사용하면 `openPage` 가 쿠키를 비워 **메일 위젯·근태의 공용 세션이 통째로 날아간다**.
- 세션은 계정별 **메모리 캐시(15분)** + 동시 요청 공유(그룹웨어는 같은 계정 동시 로그인을 거부한다). 디스크에 남기지 않는다.
- 파라미터 빌더(`mailListParams`·`mailBoxCountParams`)와 파서(`parse.ts`)는 내 계정 경로와 **공유**한다.

⚠️ 실측 함정 (2026-08-13, 실계정 정찰):
- **메일 전용 계정은 `portletEmailList.do` 가 JSON 을 주지 않는다**(HTML 반환 — 포털 위젯 권한이 없다). 그래서 `bootstrapMail()` 이 portlet → 부트스트랩 HTML 정규식(`emailInHtml`) 순으로 이메일을 파악한다.
- 로그인 후 리다이렉트가 `userMain.do` 가 아니라 **`bizboxMailEx.do`** 다. 로그인 화면으로 튕기는 것은 아니라서 `isLoginUrl` 실패 판정은 그대로 통과한다.
- **`mboxSeq` 가 계정마다 다르다**(내 계정 INBOX=1977 / zeplin_fe1=1990) — 동적 조회 필수. 게다가 `getMailBoxCount.do` 에 **빈 `id`·`domain` 을 주면 `mailboxList` 가 아예 오지 않는다**.
- **코드는 7자리이고 0으로 시작할 수 있다**(실측 `0432458`) → **문자열로 다룰 것**(숫자 변환 금지). 본문 하단 피그마 주소의 우편번호(`94102`)가 오탐 후보라 폴백 정규식의 자릿수 하한은 6이다.
- 인증 메일 식별은 **발신자(`no-reply@email.figma.com`) + 제목** 을 모두 봐야 한다 — 같은 발신자로 초대·공유 알림도 온다.
- 인증 메일이 **하루 5통씩** 오고 대부분 **이미 읽음 상태**다 → 안읽음 필터로는 찾을 수 없다. 최신 1건을 고른 뒤 10분(`freshMs`)이 지났으면 `stale` 로 만료 경고를 붙여 보낸다.
- **읽음 상태를 건드리지 않는다** — 팀원과 함께 보는 메일함이라 읽음 처리를 겸하는 `readMail.do` 대신 **`readMailCont.do` 만 GET** 한다(이것만으로 본문이 온다. `getToken.do` 선행도 불필요).
