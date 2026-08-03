# One App — Claude 작업 가이드

> 이 파일은 Claude Code가 자동으로 읽는 프로젝트 지침입니다. 작업 전 반드시 참고하세요.
> (사용자·코드·문서 모두 **한국어**를 사용합니다.)

## 프로젝트 개요
- **One App**: macOS 데스크톱 앱. 하나의 창에서 사내 도구(일정 등록, VPN 등)를 관리하는 **워크스페이스형 허브**.
- UX: 왼쪽 **사이드바 + 탑바 + 메인 영역**. 기능이 늘수록 사이드바에 섹션이 추가되는 구조. 룩앤필은 `DESIGN.md`(Linear/Raycast 무드 다크 테마) 기준.

## 기술 스택
- **Electron + React + TypeScript**
- 빌드/패키징: **Electron Forge + Vite**
- 런타임: Node.js 22 · Electron 43 · React 18

## 명령어
| 명령 | 설명 |
|------|------|
| `npm start` | 개발 모드 실행 (핫리로드) |
| `npx tsc --noEmit` | 타입 검사 (커밋 전 권장) |
| `npm run lint` | ESLint |
| `npm run make` | 배포용 `.app`/`.dmg` 패키징 |

## 프로젝트 구조 (feature 중심 — Bulletproof React 스타일)
```
src/
├── main/                        # 🖥️ 메인 프로세스 (Node)
│   ├── main.ts                  #  진입점: 창 생성 + IPC 등록 (이름 고정)
│   ├── features/                #  기능 모듈 — ipc.ts(핸들러) + 로직을 함께 배치
│       ├── schedule/            #  일정 매크로 (puppeteer)
│       │   ├── ipc.ts           #    IPC 핸들러
│       │   ├── config.ts        #    비즈박스 URL·셀렉터·타이밍
│       │   ├── scheduleUtils.ts #    일정 파싱·시간/날짜 변환
│       │   ├── pageMacro.ts     #    브라우저 페이지 조작
│       │   └── runMacro.ts      #    실행 흐름(로그인→이동→등록)
│       ├── deploy/              #  젠킨스 배포 (REST API)
│       │   ├── ipc.ts
│       │   ├── jenkins.ts       #    빌드 트리거·상태 폴링 (crumb 처리 포함)
│       │   └── store.ts         #    프로젝트 저장 (토큰 safeStorage 암호화)
│       ├── settings/            #  환경설정
│       │   ├── ipc.ts
│       │   └── store.ts         #    설정 저장 (safeStorage 암호화)
│       ├── attendance/          #  출퇴근 (headless puppeteer)
│       │   ├── ipc.ts
│       │   ├── config.ts        #    그룹웨어 URL·셀렉터·플래그
│       │   ├── attend.ts        #    로그인→근태 조회/찍기
│       │   ├── reminders.ts     #    요일별 출퇴근 리마인더 설정 저장(평문 JSON)
│       │   └── scheduler.ts     #    매 30초 확인→시각 되면 상태조회 후 알림
│       ├── mirror/              #  폰 미러링 (scrcpy CLI)
│       │   ├── ipc.ts
│       │   └── scrcpy.ts        #    scrcpy 실행·상태 추적 + adb 기기 감지
│       ├── vpn/                 #  VPN (openvpn CLI + management 인터페이스)
│       │   ├── ipc.ts
│       │   ├── config.ts        #    바이너리 탐색·런타임 파일 경로
│       │   ├── totp.ts          #    RFC 6238 TOTP (Google OTP 자동 생성)
│       │   ├── store.ts         #    계정·시크릿 저장 (safeStorage 암호화)
│       │   └── openvpn.ts       #    root 데몬 실행·상태 추적·연결/해제
│       ├── weekly/              #  주간보고 (headless puppeteer)
│       │   ├── ipc.ts
│       │   ├── config.ts        #    그룹웨어 개인별 주간 화면 셀렉터
│       │   └── collect.ts       #    로그인→FE챕터→개인별 주간→datas 캡처
│       ├── groupware/           #  그룹웨어 세션 (공통 인프라 — 로그인 1회를 여러 기능이 공유)
│       │   ├── config.ts        #    로그인 URL·셀렉터·세션 TTL(20분)
│       │   └── session.ts       #    로그인→쿠키 확보·캐시 + gotoWithSession(쿠키 주입 이동)
│       ├── notify/              #  알림 (공통 인프라)
│       │   └── notify.ts        #    앱을 앞으로 + 알럿(dialog) 표시, '이동' 시 섹션 이동
│       ├── prs/                 #  PR (Gitea — 생성·머지·목록)
│       │   ├── ipc.ts
│       │   ├── gitea.ts         #    전역 PR 검색·브랜치·생성·머지·승인 수
│       │   └── store.ts         #    조직 필터 (prs.json 평문 — 빠른 PR 저장소는 프로젝트 레지스트리 파생)
│       ├── projects/            #  프로젝트 레지스트리 (공통 인프라 — 다른 기능이 참조)
│       │   ├── ipc.ts
│       │   └── store.ts         #    CRUD·조회 헬퍼 (projects.json 평문, 변경 시 projects:changed)
│       ├── jira/                #  Jira 내 이슈 (REST v3)
│       │   ├── ipc.ts
│       │   └── jira.ts          #    내 이슈 조회·상태 전환 (Basic Auth)
│       ├── mail/                #  비즈박스 메일 (리버스 엔지니어링 HTTP API)
│       │   ├── ipc.ts
│       │   ├── config.ts        #    메일 엔드포인트·셀렉터
│       │   ├── session.ts       #    로그인 1회 → 쿠키 세션 재사용
│       │   └── mail.ts          #    안읽은 수·목록·본문 조회
│       ├── nightwatch/          #  Jira 티켓 무인 분석 (claude CLI — 수동 트리거)
│       │   ├── ipc.ts
│       │   ├── engine.ts        #    후보 조회·분석 실행/대기열·변조 검증·산출물 관리
│       │   ├── mission.ts       #    미션 템플릿·claude spawn·stream-json 파싱
│       │   └── store.ts         #    config/state 원장 (userData/nightwatch, 원자 쓰기)
│       ├── applink/             #  applink.kr 딥링크 생성
│       │   ├── ipc.ts
│       │   ├── create.ts        #    딥링크 생성 API 호출 (메인에서 서버측 호출)
│       │   └── store.ts         #    API 키 저장 (safeStorage 암호화)
│       └── tray/                #  메뉴바 트레이
│           └── tray.ts          #    열기·출퇴근 찍기·종료 메뉴
│   └── lib/                     #  메인 공통 유틸
│       ├── http.ts              #    fetchWithTimeout — 기본 15초 타임아웃 fetch 래퍼
│       ├── store.ts             #    userData JSON 읽기/쓰기 + safeStorage 암복호화
│       ├── util.ts              #    sleep·localDateKey
│       ├── broadcast.ts         #    모든 창에 webContents.send
│       └── groupware.ts         #    withGroupwareLogin — 그룹웨어 로그인 직렬화 큐
├── preload/preload.ts           # 🌉 contextBridge (window.oneApp) (이름 고정)
├── renderer/                    # 🎨 React UI
│   ├── renderer.tsx             #  React 마운트 진입점 (이름 고정)
│   ├── app/App.tsx              #  앱 셸(사이드바/탑바/메인) + SECTIONS + ToastProvider
│   ├── components/              #  공용 UI — Sidebar · Button · Input · Textarea · FormRow ·
│   │                            #  SectionHeader · Banner · RefreshButton · Collapsible ·
│   │                            #  Icon(SVG) · Badge · StatusDot · TextLink · FileTrigger ·
│   │                            #  Segment · Toast(useToast) · Modal · ConfirmDialog(useConfirm) ·
│   │                            #  EmptyState · Markdown · DatePicker · TimePicker · Checkbox · Select ·
│   │                            #  Pagination
│   ├── lib/                     #  공용 훅·유틸
│   │   ├── theme.ts             #    테마 전환 — data-theme 적용·localStorage 미러·useThemeMode 훅
│   │   ├── usePolling.ts        #    usePolling(주기 폴링)·useTick(시계 틱 리렌더)
│   │   └── useCopy.ts           #    클립보드 복사 + 결과 토스트
│   ├── features/                #  기능별 폴더 — index.ts 가 공개 API
│   │   ├── schedule/
│   │   │   ├── components/ScheduleSection.tsx
│   │   │   └── index.ts
│   │   ├── deploy/
│   │   │   ├── components/      #  Section(오케스트레이션)·Card·Form·Badge·DetailPanel
│   │   │   ├── lib/format.ts    #  키·시간 포맷 헬퍼
│   │   │   └── index.ts
│   │   ├── settings/            #  (schedule 과 동일 구조)
│   │   ├── attendance/          #  출퇴근 위젯 (사이드바 하단 고정)
│   │   ├── vpn/                 #  VPN 위젯 (사이드바 하단 고정)
│   │   ├── mirror/              #  폰 미러링 위젯 (사이드바 하단 고정)
│   │   ├── mail/                #  메일 위젯(사이드바 상단) + 리더 모달 (MailWidget·MailModal)
│   │   ├── weekly/              #  주간보고 — 좌우 2단(팀 목록 RosterRow + 상세 Detail). components(Section·RosterRow·Detail·Chips) + lib/report.ts(T/OT·MM 가공)
│   │   ├── prs/                 #  PR 대시보드 — 열린 PR 목록(승인 수·상대시간)
│   │   ├── jira/                #  Jira 내 이슈 — 목록·상태 전환, 클릭 시 브라우저로
│   │   ├── nightwatch/          #  Nightwatch — 티켓 분석 대시보드 (후보·리포트·미션 로그)
│   │   ├── projects/            #  프로젝트 — 중앙 레지스트리 CRUD (Section·Form·Card)
│   │   └── applink/             #  applink.kr 딥링크 생성
│   ├── styles/                  #  SCSS — index.scss 진입점 + 기능별 분리
│   │   ├── index.scss           #    @use 모음 (새 기능은 _<기능>.scss 추가)
│   │   ├── _base.scss           #    디자인 토큰·믹스인·공통 클래스 (DESIGN.md 가 기준)
│   │   ├── _layout.scss         #    사이드바·탑바·메인 (셸)
│   │   ├── _schedule.scss       #    일정 등록
│   │   ├── _settings.scss       #    환경설정
│   │   ├── _deploy.scss         #    배포
│   │   ├── _vpn.scss            #    VPN 위젯 고유 요소 (배치는 _base.scss 의 공용 .sbw)
│   │   ├── _weekly.scss         #    주간보고
│   │   ├── _prs.scss            #    PR 대시보드
│   │   ├── _jira.scss           #    Jira 내 이슈
│   │   ├── _mail.scss           #    메일 위젯·리더 모달
│   │   ├── _nightwatch.scss     #    Nightwatch
│   │   ├── _projects.scss       #    프로젝트 레지스트리
│   │   ├── _applink.scss        #    딥링크
│   │   └── _markdown.scss       #    마크다운 렌더(react-markdown) 공통
│   └── types/global.d.ts        #  window.oneApp 타입
└── shared/types.ts              # 🔗 프로세스 간 공용 타입
```
- **규칙**: 기능 간 참조는 `features/<기능>/index.ts`(공개 API)로만. 기능 내부 파일을 다른 기능에서 직접 import 하지 않는다.

## ⚠️ 반드시 지킬 것
- **진입점 파일명 고정**: `src/main/main.ts`, `src/preload/preload.ts`, `src/renderer/renderer.tsx` 의 **파일 이름**이 빌드 산출물 이름(`main.js`/`preload.js`)이 됨. 바꾸면 실행이 깨짐.
- **컨텍스트 분리 유지**: main(Node) / preload(bridge) / renderer(React). 렌더러에서 Node API 직접 사용 금지.
- **통신은 IPC + contextBridge 경유**: 렌더러↔메인은 preload에 노출한 `window.oneApp` API로만. (`nodeIntegration` 켜지 말 것)
- **공용 타입은 `src/shared/types.ts`에** 두고 3개 컨텍스트에서 import.
- **비밀/계정 정보 커밋 금지**: 비밀번호는 `safeStorage`로 암호화해 userData에만 저장. 코드·리포에 하드코딩 X. `.env`/`settings.json`(계정) 커밋 금지.

## 새 기능(섹션) 추가 방법
1. `src/renderer/features/<기능>/components/<기능>Section.tsx` 작성 + `index.ts` 로 export
2. `src/renderer/app/App.tsx` 의 `SECTIONS`에 항목 추가 (`render` 필드에 컴포넌트 — switch 분기 없음)
3. `src/renderer/styles/_<기능>.scss` 작성 + `index.scss`에 `@use` 추가
4. (파일·프로세스·네이티브 작업이 필요하면) 아래도 함께:
   - `src/main/features/<기능>/ipc.ts` 에 핸들러 작성 → `main.ts`에서 `register...Ipc()` 호출 (로직 파일도 같은 폴더에)
   - `src/preload/preload.ts` 에 API 노출
   - `src/shared/types.ts` 에 타입 추가 + `src/renderer/types/global.d.ts` 의 `window.oneApp` 타입 갱신

## 주요 기능 메모
- **일정 등록** (`renderer/features/schedule` + `main/features/schedule`): 비즈박스 그룹웨어에 하루 일정을 puppeteer로 자동 등록. 하루 작업은 **타임라인 카드**(행마다 계산된 시작→종료·소요시간 칩, 12:30 종료 뒤 점심 구분선, 헤더에 합계·OT — 점심 규칙 12.5/13.5 는 `config.ts` 와 동기)로 중간중간 기록(종료시간 TimePicker + 일정명 + [추가], 시간순 자동 정렬, 추가 행에 다음 시작 시각 표시). 날짜·시작 시간은 상단 툴바 한 줄(시작은 TimePicker), 실행 로그는 실행 전엔 숨김 — **`userData/worklog.json`** 에 IPC(`schedule:worklog:get/set`, 렌더러 300ms 디바운스)로 즉시 저장되어 탭 이동·재시작·강제 종료에도 유지 (⚠️ localStorage 는 이 앱에서 강제 종료 시 디스크 flush 가 안 돼 유실됨 — 2026-07-29 실측, 보존할 데이터에 쓰지 말 것). 등록·복사 시 `종료시간(십진) 일정명` 줄 텍스트로 변환하며(10:30→`10.5`), **[노션용 복사]** 버튼으로 그 형식 그대로 클립보드에 복사(노션 기록용), [비우기]는 확인 다이얼로그 경유. 계정 정보는 **환경설정 탭**에서 입력 → `safeStorage`로 암호화 저장. 실행 시 자동화 브라우저가 열리며, 완료 후에도 확인용으로 유지됨.
- **환경설정** (`renderer/features/settings` + `main/features/settings`): 비즈박스 ID/비밀번호 관리 + **테마(시스템/라이트/다크)** — 테마는 [저장] 없이 세그먼트 변경 즉시 적용·저장(`settings:theme:set`). 적용은 `renderer/lib/theme.ts`(`<html data-theme>` + localStorage 미러 — 부팅 플래시 방지), 다크 토큰은 `_base.scss` 의 `:root[data-theme='dark']` 블록, main 은 창 생성 시 `theme`+`nativeTheme` 으로 backgroundColor 선택.
- **출퇴근** (`renderer/features/attendance` + `main/features/attendance`): 사이드바 하단 고정 위젯. headless puppeteer 로 **공용 그룹웨어 세션 쿠키를 주입**해(`gotoWithSession`, 로그인 화면 안 거침) userMain.do 근태 위젯(`#tab1`/`#tab2`)에서 출퇴근 시각을 읽고, 찍을 때는 그룹웨어 자체 함수 `fnAttendCheck(1=출근, 4=퇴근)`를 호출(confirm 자동 수락). 계정은 환경설정의 비즈박스 계정 공용(로그인은 공용 세션 모듈이 담당 — `runAttendance(action)` 는 계정 인자를 받지 않는다). 실수 방지를 위해 클릭 시 앱에서 확인 대화상자를 거침.
- **VPN** (`renderer/features/vpn` + `main/features/vpn`): 사이드바 하단 위젯. Homebrew `openvpn` CLI(**필수 의존성**, `/opt/homebrew/sbin/openvpn`)를 osascript 관리자 인증으로 root 데몬 실행하고, management 인터페이스(127.0.0.1 TCP + 비밀번호 파일)로 자격증명 전달·상태 추적·해제(SIGTERM). 비밀번호는 Google OTP — 위젯 설정에 TOTP 시크릿 키를 저장하면 자동 생성(`totp.ts`, RFC 6238), 없으면 매번 수동 입력. 계정·시크릿은 `safeStorage` 암호화로 `userData/vpn.json`에 저장. **앱을 종료해도 VPN 데몬은 유지**되고, 재시작 시 `userData/vpn/session.json`으로 management에 재접속해 상태 복원. openvpn 로그는 `userData/vpn/openvpn.log`(root 소유).
- **폰 미러링** (`renderer/features/mirror` + `main/features/mirror`): 사이드바 하단 위젯(맨 위 — 미러링→VPN→근태 순). Homebrew `scrcpy`(선택 의존성)를 spawn — 바탕화면 'Mirror USB.app'·'Control USB.app' 이식. **두 모드**: `미러링`(`-d --turn-screen-off` — 화면 미러+폰 화면 끔) / `제어`(`-d --no-video --no-audio --keyboard=uhid --mouse=uhid` — 화면 없이 맥 키보드·마우스로 폰 조작). 한 번에 한 모드만. `adb devices -l` 로 USB 기기 모델명을 표시하고 기기 없으면 버튼 비활성. scrcpy 창을 닫으면 exit 이벤트로 위젯 상태 자동 갱신(`mirror:changed`), 비정상 종료는 stderr 마지막 줄을 에러로 표시. 앱 종료 시 scrcpy 도 함께 종료됨(VPN 과 달리 독립 유지 안 함). 설정·저장 없음.
- **주간보고** (`renderer/features/weekly` + `main/features/weekly`): FE챕터 공유일정의 **개인별 주간** 화면을 headless puppeteer 로 수집해 팀원별 T/OT·MM 을 카드+차트(chart.js)로 표시. 엑셀 다운로드 없이 페이지의 `calendarExcelSave()` form submit 을 후킹해 `datas`(JSON payload)를 가로챈다(익스텐션 `fe-schedule-extension` 이식). 주간 이동은 페이지 함수 `beforeWeek()`/`nextWeek()`, 현재 주는 iframe 전역 `startDate`/`endDate`(YYYYMMDD)로 판별. 개인별 주간 진입/주간 이동 직후 일정 목록이 ajax 로 늦게 채워지므로 **datasExcel 행 수 안정화 대기 + 캡처 재시도**가 들어 있음(제거하면 빈 결과 레이스 재발). T/OT 규칙: 하루 8시간까지 T, 초과분 OT, MM=시간÷8÷20.6. 전체 MM 제외 프로젝트는 칩 클릭으로 토글(localStorage `weekly:mmExcluded`, 기본 FE·전사·본부·휴가·연차·시차). 주 기준은 기본 일~토(페이지 단위)이며, 툴바 **[월~일 기준] 체크박스**(localStorage `weekly:monWeek`)를 켜면 두 주(일~토 ×2)를 수집해 월~토+다음 주 일요일을 이어 붙인다(수집 시간 증가, 데드라인 +60초). ⚠️ 주간 이동(특히 `beforeWeek()`) 시 페이지가 이전 주 행을 `datas` 에 누적한 채 남기므로, **캡처 행을 대상 주 날짜(MM.DD) 집합으로 한정하는 필터가 필수**(`mmddSet`·`dayMmdd`, 제거하면 여러 주 합산 재발 — 2026-07 실측 확인). 계정은 환경설정의 비즈박스 계정 공용.
- **알림** (`main/features/notify`): 알림 공통 인프라. `notify({title, body, section, action})` 호출 시 앱 창을 앞으로 가져와(`app.focus({steal:true})`) **알럿(`dialog.showMessageBox`)** 으로 표시. `section` 지정 시 '이동' 버튼 → `app:navigate` IPC 로 해당 섹션 이동(App.tsx `onNavigate` 구독), `action`(버튼 라벨) 지정 시 그 버튼이 기본 버튼이 되고 **클릭 여부를 반환**해 호출부가 후속 동작을 처리한다. macOS 미서명/개발 모드에서 Electron `Notification` 이 표시되지 않아(UNErrorDomain 1) OS 알림 권한과 무관한 알럿 방식을 사용한다. 창이 닫혀 있으면(맥) 알럿만 독립적으로 뜬다. 창 참조는 `main.ts`에서 `setNotifyWindow()` 로 등록. 사용처: ①배포 완료/실패 알림(환경설정 `settings.notifyDeploy` on/off) ②출퇴근 리마인더. 환경설정에 **테스트 알림 버튼**(`notify:test` IPC → `window.oneApp.testNotification()`)이 있어 모양 확인 가능. 새 알림이 필요하면 이 모듈을 재사용.
- **출퇴근 리마인더** (`main/features/attendance/scheduler.ts` + `reminders.ts`): 환경설정에서 **요일별(월~금)로 출근·퇴근 알림 시각**을 각각 지정(체크박스+시각). 메인 스케줄러가 매 30초 현재 시각을 확인해, 설정 시각(±2분, 슬립 대비)이 되면 근태 상태를 조회(`runAttendance('status')`)하고 **이미 찍었으면 건너뛰고 안 찍었을 때만** 알림(스마트 스킵). 알럿의 **[지금 출근/퇴근 찍기]** 버튼으로 그 자리에서 바로 찍을 수 있고(성공/실패 결과 알럿 표시, 성공 시 그날 리마인더 중지 + `attendance:changed` 이벤트로 사이드바 위젯 즉시 갱신), 상태 확인 실패(계정 없음·VPN 등)면 놓치지 않도록 알림을 띄운다(실패 알림은 하루 1회). 평일만, 기본 하루 한 번(중복 방지). **반복 알림**(`repeat: {enabled, minutes}`, 1~120분)을 켜면 설정 시각 이후 안 찍은 동안 N분 간격으로 재알림 — 앱을 늦게 켜도 발화하고, 찍은 게 확인되면 그날은 멈추며, 알럿을 안 닫고 있는 동안은 반복하지 않는다(닫은 시점부터 다시 카운트). 설정은 `userData/reminders.json`(평문). 스케줄러는 저장값을 매 tick 읽으므로 저장 후 재시작 불필요.
- **배포** (`renderer/features/deploy` + `main/features/deploy`): 프로젝트별 젠킨스 잡을 REST API로 트리거하고 상태(대기→빌드중→성공/실패)를 폴링해 표시. [배포]를 누르면 **확인 모달**이 뜨는데, 환경설정에 Gitea 주소가 있으면 **이번 배포에 포함될 커밋 미리보기**(마지막 빌드 revision vs 저장소 HEAD를 Gitea compare API로 비교, `gitea.ts`)를 보여주고, 프로젝트가 **운영(PROD)으로 표시**돼 있으면(폼 체크박스, 카드에 PROD 뱃지) **대상 이름을 타이핑해야 배포 버튼이 활성화**된다(오배포 방지). 커밋 내역의 **커밋 해시는 Gitea 커밋 페이지로, 메시지 속 이슈 키(BBJ-1234)는 Jira로 링크화**(환경설정의 Gitea/Jira 주소 사용, 미설정이면 평문 — 젠킨스가 기록한 저장소 주소는 내부망이라 호스트는 설정된 Gitea 주소로 치환). 대상별 [커밋 내역]을 누르면 **공용 Modal**로 열리며, 안에 **최근 10개 빌드 이력 스트립**(성공/실패 색, 클릭 시 그 빌드의 커밋 내역으로 전환)과 **콘솔 로그 tail**(마지막 64KB, progressiveText 2단계 조회 — 크기 probe 후 끝부분만)이 있고, **빌드중이면 진행바(estimatedDuration 대비 경과)와 [중지] 버튼**(`/stop`, crumb 재시도)이 뜬다. 상태는 배포 탭을 보는 동안 1분마다 자동 새로고침(젠킨스에서 직접 돌린 빌드도 반영), 빌드중엔 5초 틱으로 진행률 갱신. 프로젝트 하나에 배포 대상 여러 개(스토어·어드민 등) 등록 가능. 젠킨스 URL·계정은 배포 탭에서 프로젝트별로 등록하고, API 토큰(또는 비밀번호)은 `safeStorage`로 암호화해 `userData/deploy.json`에 저장. 인증은 Basic Auth + API 토큰 권장(비밀번호 인증은 CSRF crumb 자동 처리).
- **PR** (`renderer/features/prs` + `main/features/prs`): push → PR 생성 → 머지 루프를 앱에서 끝내는 섹션. **빠른 PR**: **프로젝트 레지스트리의 Gitea 프로젝트**(`remoteKind==='gitea'` + owner/repo 파싱 가능)별로 최근 push 브랜치를 자동 표시(branches API, 커밋시간 정렬 — 저장소 관리는 프로젝트 탭, 여기엔 추가/삭제 UI 없음) → [PR 만들기] 모달에서 **프로젝트 defaultBranch(빈 값 develop)** 대비 커밋 확인 + 제목(브랜치명의 BBJ-#### 자동 추출)·본문(커밋 불릿) 자동 생성 → 생성 성공 시 **머지 모달로 자동 연결**. **머지**: 목록 행 [머지] → `mergeable`(컨플릭트) 사전 확인 + 방식(merge/squash/rebase) 선택 → `/pulls/{n}/merge`. 생성·머지는 **Gitea 토큰 필수**(없으면 배너 안내·버튼 숨김). 목록은 **전역 이슈 검색 API**(`/repos/issues/search?type=pulls&state=open`)로 접근 가능한 전체 저장소의 열린 PR + 리뷰 승인 수 뱃지, **조직(owner)별 그룹핑** + 조직 칩 제외 필터(`store.ts`, `userData/prs.json`), 2분 자동 새로고침.
- **프로젝트** (`renderer/features/projects` + `main/features/projects`): **프로젝트 중앙 레지스트리(관리 지점)** — 이름·로컬 경로(필수) + 원격 저장소 종류(gitea/bitbucket/기타)·주소·기본 브랜치·Jira 프로젝트 키를 `userData/projects.json`(평문 — 비밀 없음, 토큰은 환경설정 담당)에 CRUD. **새 기능이 프로젝트 경로·저장소 정보가 필요하면 자체 저장하지 말고 여기를 참조할 것**: main 은 `features/projects/store.ts` 의 조회 헬퍼(`getProject`·`findProjectByPath`·`findProjectByRepo`·`findProjectsByJiraKey`·`remoteOwnerRepo`)를 직접 import, 렌더러는 `window.oneApp.projects.*`(list/save/delete/pickDir/onChanged) + 원격 주소의 owner/repo 파싱은 `shared/types.ts` 의 `ownerRepoFromUrl`(main·렌더러 공용). 저장·삭제 시 `projects:changed` 브로드캐스트로 전 창 실시간 반영. sanitize: 로컬 경로 `~/` 치환+절대경로 정규화·끝 슬래시 제거, Jira 키 대문자, remoteKind 검증 실패 시 gitea. **PR(빠른 PR)·Nightwatch(분석 대상)는 레지스트리 참조로 전환 완료** — 배포(젠킨스)는 저장소 주소를 빌드 메타데이터에서 런타임 추출하므로 아직 자체 관리(연결 키가 없어 스키마 변경이 선행돼야 함).
- **Jira** (`renderer/features/jira` + `main/features/jira`): 내게 할당된 미해결 이슈 목록(최신 갱신순 50개, 다시열림 누락 방지 JQL 보정). 프로젝트 탭 + 타입별 그룹 카드 + 해결됨 접힘 그룹, 행에 **우선순위 화살표·상위항목 칩**, [⋯] 메뉴로 **상태 전환**(전환 목록 동적 조회)·링크 복사, 내용 확인은 클릭 → 브라우저(Jira)로. **사이드바 뱃지**에 미해결 수 표시 — 확인 안 한 새 티켓은 액센트 강조(App.tsx, localStorage `jira:seenKeys`). 인증은 환경설정 → 연동의 Jira 주소+**이메일+API 토큰**(Basic Auth, 토큰은 safeStorage 암호화) — 셋 다 있어야 동작, 미설정이면 안내 배너. REST `search/jql`(신형) 우선, 404 시 구형 `search` 폴백. 2분 자동 새로고침.
- **메일** (`renderer/features/mail` + `main/features/mail`): 비즈박스 메일을 **사이드바 최상단 위젯**에서 확인. 로그인·쿠키는 **공용 세션 모듈**(`features/groupware`)에 맡기고, 그 쿠키로 `/mail2/` SPA 를 부트스트랩한 뒤 개수·목록·본문 조회는 **전부 순수 HTTP fetch**(리버스 엔지니어링 엔드포인트 — `getMailBoxCount.do`·`getMailList.do`·`readMail.do`/`readMailCont.do`). 메일 캐시는 공용 세션의 `establishedAt` 을 신원으로 삼아, 세션이 새로 수립되면 부트스트랩만 다시 한다. 로그인 페이지 응답이면 공용 세션까지 무효화하고 1회 재로그인, 동시 요청은 establish 공유. **안읽음 폴링은 포커스 적응형**(활성 30초·백그라운드 3분, 창 복귀 시 즉시). 위젯 아이콘 클릭=브라우저로 메일함, 제목 클릭=앱 내 **리더 모달**(좌 목록·우 본문 — 상단 세그먼트로 **받은편지함↔스팸메일함** 전환, 폴더별 `mboxSeq` 는 `getMailBoxCount` 로 동적 조회). 목록 하단에 공용 `Pagination` — `getMailList.do` 의 `page`/`pageSize`(30) 서버 페이징으로 **과거 메일까지 열람**(전체 건수는 `TotalRecordCount`). 조회 조건은 `MailListQuery`({folder, page, pageSize}) 객체로 전달하며, 응답의 `page` 를 요청 순번과 대조해 빠르게 넘길 때 **뒤늦은 응답을 버린다**. **뱃지 안읽음 수는 폴더별 `unseen` 합**(받은편지함+스팸, 보낸·임시·휴지통 제외 — `config.ts` 의 `unreadExcludedBoxes`)으로 직접 계산한다. ⚠️ 서버의 `allunseen`/`allexist` 집계는 스팸·휴지통·임시보관을 **제외**하며(2026-07-30 실측: `allexist` = INBOX+SENT), 스팸 메일은 도착 시점부터 **읽음 상태로 들어와** 실질적으로 뱃지에 잡히지 않는다. 본문은 main 의 `sanitizeHtml`(script/iframe/on* 제거) + **sandbox iframe(srcDoc)** 이중 방어로 렌더하고, 링크는 기본 브라우저로만 나간다(열면 그룹웨어에서도 읽음 처리). 계정은 비즈박스 공용, 자체 파일 저장 없음.
- **Nightwatch** (`renderer/features/nightwatch` + `main/features/nightwatch`): Jira 버그 티켓을 골라 **headless `claude` CLI 미션으로 읽기 전용 분석**을 돌려 리포트+작업 프롬프트를 만든다(아침에 실제 세션에 붙여넣어 수정 작업). 흐름: 후보 조회(내 미해결 이슈 − 해결·숨김·기분석) → [분석] → **프로젝트 선택(프로젝트 레지스트리 참조 — 학습값 suggestedRepoId → Jira 키 일치 → 첫 프로젝트 순 기본 선택, 티켓의 Jira 키와 일치하는 프로젝트가 목록 앞에 정렬)** → Jira REST 로 티켓·댓글·첨부 수집 → 관찰 모드 미션 실행 → 저장소 변조 사후 검증 → 원장 기록. **이름과 달리 야간 자동 스케줄러는 없음 — 수동 트리거가 유일한 진입점**, 실행 중 추가 요청은 대기열로 순차 처리. 안전장치: `--disallowedTools Edit MultiEdit NotebookEdit` 로 편집 도구 차단 + 읽기 전용 계약 프롬프트 + 미션 전후 `git status/diff` 비교로 변조 감지(`violation_edited` 경고, patch 증거 보존). 산출물은 `userData/nightwatch/` — `reports/{key}.md`(마크다운 렌더)·`{key}.prompt.md`(복사용)·`work/{key}/`·`logs/`, 원장 `state.json`, 설정 `config.json`(Claude 계정·타임아웃 기본 40분 — 분석 대상 저장소 목록은 프로젝트 레지스트리로 이관). 비용은 stream-json 의 `total_cost_usd` 를 기록해 처리한 티켓 행에 표시. 숨김·[재분석]·30일 자동 정리·앱 시작 시 좀비 정리 포함. 1분 자동 새로고침.
- **딥링크** (`renderer/features/applink` + `main/features/applink`): applink.kr 디퍼드 딥링크(단축 URL) 생성. 클라이언트 JS 호출이 막혀 있어 **main 에서** `POST /deeplink/deeplink_create.asp` 를 호출(`X-API-KEY` + `$canonical_url`·선택 OG 필드). **API 키는 safeStorage 암호화**로 `userData/applink.json` 에만 저장. UI 는 키 관리 + 대상 URL + 접이식 공유 정보(제목·설명·이미지·PC 링크) + 생성 시 클립보드 자동 복사 + 이번 세션 생성 목록.
- **트레이·자동 시작** (`main/features/tray`): 메뉴바 아이콘(항상 표시) — One App 열기 / 출근·퇴근 찍기(확인 대화상자 → `runAttendance` → 결과 알럿 + `attendance:changed` 로 위젯 갱신) / 종료. 창을 닫아도 macOS 에선 앱이 상주하므로 트레이로 복귀. **로그인 시 자동 시작**은 환경설정 → 일반 토글(`app:autostart:get/set` IPC, OS 로그인 아이템이 원본이라 파일 저장 없음, 패키징 앱에서 실질 동작).

## 트러블슈팅
- `npm install` 시 `ETARGET No matching version`(존재하지 않는 버전) → **npm 캐시 손상**. `npm cache clean --force` 후 `rm -f package-lock.json && npm install`.
- `puppeteer`는 `vite.main.config.ts`에서 **external 처리**(번들 제외, 런타임 로드). 무거운 네이티브 의존성 추가 시 동일하게 external 고려.
- 개발 모드 DevTools 자동 오픈은 꺼둠(`main.ts`). 필요하면 창에서 `⌘⌥I`.
- **핫리로드 범위**: 렌더러만 HMR 적용. `src/main`/`src/preload` 변경은 리빌드는 되지만 **Electron 재시작 안 됨** → `npm start` 를 다시 실행해야 반영.

## 컨벤션
- 코드 주석·문서·대화는 **한국어**.
- **UI 스타일 기준은 `DESIGN.md`** — 색·크기·모션은 반드시 `_base.scss` 토큰(`var(--*)`)과 타이포 믹스인(`type-*`)에서 가져온다 (hex·px 매직넘버 금지). 이모지·텍스트 글리프 대신 공용 `Icon` 컴포넌트(Lucide path) 사용.
- **스타일은 SCSS** (`sass-embedded`, Vite 기본 지원 — `vite.renderer.config.ts`에서 modern-compiler API 사용). BEM 클래스를 `&__`/`&--` 네스팅으로 작성하고, 새 기능은 `styles/_<기능>.scss` 파일로 분리해 `index.scss`에 `@use` 추가. 믹스인이 필요하면 파일 최상단에 `@use './base' as *;`.
- **공용 UI는 `components/`의 컴포넌트 사용** — 버튼 `Button`(variant: primary/ghost/danger · size: md/sm · loading), 입력 `Input`(small)·`Textarea`(code), 라벨+입력 행 `FormRow`, 섹션 제목 `SectionHeader`(icon), 배너 `Banner`(variant: warning/danger/info), 새로고침 `RefreshButton`, 열고닫기 `Collapsible`(icon·storageKey), 아이콘 `Icon`, 상태 뱃지 `Badge`·`StatusDot`, 링크형 버튼 `TextLink`, 파일 선택 `FileTrigger`, 세그먼트 `Segment`, 토스트 `useToast`, 모달 `Modal`(title·onClose·wide — Escape/오버레이 클릭 닫힘, 부모가 조건부 렌더로 제어), 확인 다이얼로그 `useConfirm`(promise 기반 window.confirm 대체 — `await confirm({title, danger})`), 빈 상태 `EmptyState`(icon·message·hint), 마크다운 렌더 `Markdown`, 날짜 선택 `DatePicker`(미니 캘린더 팝오버 — "YYYY-MM-DD"), 시간 선택 `TimePicker`(타이핑 허용 + N분 단위 리스트 — "HH:MM", `step` 기본 30분·`small` 변형), 체크박스 `Checkbox`(label 래핑·클릭 토글 — `danger`: 운영 확인용), 셀렉트 `Select`(`options` prop — TimePicker 계열 커스텀 팝오버 드롭다운, `small` 변형), 페이지네이션 `Pagination`(`page`(1-based)·`pageSize`·`total`·`onChange` — 서버 페이징 목록 공용. `1 … 6 [7] 8 … 616` 창 방식 + 좌측 "31–60 / 18,475건" 요약, 한 페이지면 아무것도 렌더 안 함, `span`·`unitLabel` 로 조정). **네이티브 `input[type=date/time]`·원시 `<input type=checkbox>`·`<select>` 직접 사용 금지** — 항상 공용 컴포넌트 사용. `.btn`/`.input` 등 공통 클래스 직접 사용 금지, 기능 scss 에서 공용 클래스 크기 오버라이드 금지(size variant 사용).
- **공통 유틸 재사용 (중복 정의 금지)** — 렌더러: 주기 폴링·시계 틱은 `lib/usePolling.ts`(usePolling·useTick), 클립보드 복사+토스트는 `lib/useCopy.ts`. 메인: REST 호출은 `main/lib/http.ts` 의 `fetchWithTimeout`(전역 fetch 직접 사용 금지 — 타임아웃이 없어 소켓 hang 시 IPC 가 영영 안 풀림, `import { fetchWithTimeout as fetch }` 패턴), userData JSON·safeStorage 암복호화는 `main/lib/store.ts`(readUserJson·writeUserJson·encryptSecret·decryptSecret), 전 창 이벤트는 `main/lib/broadcast.ts`, `sleep`·`localDateKey` 는 `main/lib/util.ts`.
- **⚠️ 그룹웨어 접근은 `features/groupware/session.ts` 의 공용 세션을 쓸 것.** 같은 계정으로 **거의 동시에 로그인하면 서버가 뒤쪽을 거부**해 로그인 페이지로 되돌려보낸다(2026-07-30 실측: 시작 시 메일+근태가 각자 로그인 → 메일 4/4 실패, "계정 정보를 확인하세요" 라는 오해성 메시지. 중복 로그인 확인창은 안 뜨므로 다이얼로그 처리로는 해결 불가). 그래서 **로그인은 1회만 하고 쿠키를 공유**한다.
  - `getGroupwareSession()` → 쿠키 확보(TTL 20분 캐시, 동시 요청은 하나의 로그인을 공유). HTTP 호출은 `session.header`(메일), 브라우저가 필요한 기능은 **`gotoWithSession(page, url, waitUntil?)`** — 쿠키를 주입해 **로그인 화면을 건너뛰고** 목표 URL 로 직행하고, 세션이 서버에서 만료돼 튕기면 **1회 재로그인 후 재시도**한다. 인증 실패를 감지하면 `invalidateGroupwareSession()`.
  - ⚠️ 쿠키는 이름이 같고 경로만 다른 `JSESSIONID` **2개**(`gw.forbiz.co.kr` `/gw` + `.forbiz.co.kr` `/`)다 — 합친 문자열이 아니라 **도메인·경로가 붙은 객체 목록이 정본**이고 헤더는 파생값.
  - ⚠️ `waitUntil` 기본값은 `networkidle2` 지만 **포털 화면(userMain.do)은 상시 폴링이 있어 idle 판정이 14~20초까지 늘어진다** — 뒤에서 필요한 요소를 직접 기다리는 호출부(근태의 `readInfo`)는 `'domcontentloaded'` 를 넘길 것.
  - 적용 현황: **메일·근태는 공용 세션**(근태 조회 4.5초 → **0.7초**, 6~7배). **주간보고·야근결재·일정 등록은 아직 각자 로그인**하며 `main/lib/groupware.ts` 의 `withGroupwareLogin()` 직렬화 큐를 경유한다(공용 세션의 로그인도 같은 큐를 지나므로 서로 충돌하지 않음). 이들도 `gotoWithSession` 으로 옮기면 같은 이득을 얻지만, 야근결재는 상신(쓰기) 흐름이라 E2E 검증이 어려워 보류했다. `standalone/` 은 별도 프로세스라 큐·세션이 공유되지 않는다.
  - 참고: 근태 조회가 드물게 20초 이상 걸리는 건 **그룹웨어가 `userMain.do` 응답을 늦게 주는 경우**(단계별 계측으로 goto 구간 확인, 8회 중 1회) — 앱 코드 문제가 아니다.
- 공통 레이아웃 클래스(`_base.scss`): 섹션 컨테이너 `.section`, 폼 액션 `.form-actions`, 독립 라벨 `.form-label`, 힌트 `.hint`, 주석 `.note`, 아이콘 버튼 `.icon-btn`, 중첩 패널 `.panel-sunken(--log)`, 빈 상태 `.empty-state`, 스피너 `.spinner`, 진행바 `.progress`, **사이드바 위젯 `.sbw`**(VPN·미러링·근태 공용 — `[아이콘][점+텍스트][우측 액션]` 한 줄 + `__sub`/`__error` 확장).
- **비브런시 셸 주의**: 창은 `vibrancy: 'sidebar'` — html/body/.sidebar 는 **투명 유지**, 불투명 채색은 `.content`(--bg)에서만. **BrowserWindow 에 backgroundColor 지정 금지**(재질이 가려짐). 탑바는 `.content` 위 absolute 프로스트 오버레이(--frost + backdrop-blur)라 높이(44px) 변경 시 `.main` padding-top 동기화.
- 커밋: 한국어 conventional commit (`feat`/`fix`/`refactor`/`docs`/`chore`). **커밋 메시지에 Claude 서명(Co-Authored-By 등) 넣지 말 것.** → **`/commit` 스킬 사용.**
- 새 라이브러리/기술 도입 전 **공식 문서 확인**. 큰 리팩터링은 사용자 승인 후 진행.
- 자세한 로드맵은 `ROADMAP.md` 참고.
