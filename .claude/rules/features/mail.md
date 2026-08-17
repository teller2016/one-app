---
paths:
  - "src/main/features/mail/**"
  - "src/renderer/features/mail/**"
---

# 메일 (비즈박스 · 인증코드)

> 로그인·쿠키는 전부 공용 세션 모듈이 담당한다 — `groupware-session` 규칙을 함께 볼 것. 계정은 환경설정의 비즈박스 공용.

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
