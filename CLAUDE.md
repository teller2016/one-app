# One App — Claude 작업 가이드

> 이 파일은 Claude Code가 자동으로 읽는 프로젝트 지침입니다. 작업 전 반드시 참고하세요.
> (사용자·코드·문서 모두 **한국어**를 사용합니다.)

## 프로젝트 개요
- **One App**: macOS 데스크톱 앱. 하나의 창에서 사내 도구(일정 등록, VPN 등)를 관리하는 **워크스페이스형 허브**.
- UX: 왼쪽 **사이드바 + 탭 + 메인 영역**. 기능이 늘수록 사이드바에 섹션이 추가되는 구조.

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
│   └── features/                #  기능 모듈 — ipc.ts(핸들러) + 로직을 함께 배치
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
│       └── notify/              #  알림 (공통 인프라)
│           └── notify.ts        #    앱을 앞으로 + 알럿(dialog) 표시, '이동' 시 섹션 이동
├── preload/preload.ts           # 🌉 contextBridge (window.oneApp) (이름 고정)
├── renderer/                    # 🎨 React UI
│   ├── renderer.tsx             #  React 마운트 진입점 (이름 고정)
│   ├── app/App.tsx              #  앱 셸(사이드바/탭/메인) + SECTIONS
│   ├── components/              #  공용 UI — Sidebar · Button · Input ·
│   │                            #  FormRow · SectionHeader · Banner · RefreshButton
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
│   │   └── weekly/              #  주간보고 — 좌우 2단(팀 목록 RosterRow + 상세 Detail). components(Section·RosterRow·Detail·Chips) + lib/report.ts(T/OT·MM 가공)
│   ├── styles/                  #  SCSS — index.scss 진입점 + 기능별 분리
│   │   ├── index.scss           #    @use 모음 (새 기능은 _<기능>.scss 추가)
│   │   ├── _base.scss           #    변수·리셋·공통(btn, placeholder)
│   │   ├── _layout.scss         #    사이드바·탭바·메인
│   │   ├── _schedule.scss       #    일정 등록 (환경설정도 공용)
│   │   ├── _deploy.scss         #    배포
│   │   ├── _attendance.scss     #    출퇴근 위젯
│   │   ├── _vpn.scss            #    VPN 위젯
│   │   └── _weekly.scss         #    주간보고
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
2. `src/renderer/app/App.tsx` 의 `SECTIONS`에 항목 추가 + `renderMain()`에 분기 추가
3. `src/renderer/styles/_<기능>.scss` 작성 + `index.scss`에 `@use` 추가
4. (파일·프로세스·네이티브 작업이 필요하면) 아래도 함께:
   - `src/main/features/<기능>/ipc.ts` 에 핸들러 작성 → `main.ts`에서 `register...Ipc()` 호출 (로직 파일도 같은 폴더에)
   - `src/preload/preload.ts` 에 API 노출
   - `src/shared/types.ts` 에 타입 추가 + `src/renderer/types/global.d.ts` 의 `window.oneApp` 타입 갱신

## 주요 기능 메모
- **일정 등록** (`renderer/features/schedule` + `main/features/schedule`): 비즈박스 그룹웨어에 하루 일정을 puppeteer로 자동 등록. 계정 정보는 **환경설정 탭**에서 입력 → `safeStorage`로 암호화 저장. 실행 시 자동화 브라우저가 열리며, 완료 후에도 확인용으로 유지됨.
- **환경설정** (`renderer/features/settings` + `main/features/settings`): 비즈박스 ID/비밀번호 관리.
- **출퇴근** (`renderer/features/attendance` + `main/features/attendance`): 사이드바 하단 고정 위젯. headless puppeteer로 그룹웨어(gw.forbiz.co.kr) 로그인 후 userMain.do 근태 위젯(`#tab1`/`#tab2`)에서 출퇴근 시각을 읽고, 찍을 때는 그룹웨어 자체 함수 `fnAttendCheck(1=출근, 4=퇴근)`를 호출(confirm 자동 수락). 계정은 환경설정의 비즈박스 계정 공용. 실수 방지를 위해 클릭 시 앱에서 확인 대화상자를 거침.
- **VPN** (`renderer/features/vpn` + `main/features/vpn`): 사이드바 하단 위젯. Homebrew `openvpn` CLI(**필수 의존성**, `/opt/homebrew/sbin/openvpn`)를 osascript 관리자 인증으로 root 데몬 실행하고, management 인터페이스(127.0.0.1 TCP + 비밀번호 파일)로 자격증명 전달·상태 추적·해제(SIGTERM). 비밀번호는 Google OTP — 위젯 설정에 TOTP 시크릿 키를 저장하면 자동 생성(`totp.ts`, RFC 6238), 없으면 매번 수동 입력. 계정·시크릿은 `safeStorage` 암호화로 `userData/vpn.json`에 저장. **앱을 종료해도 VPN 데몬은 유지**되고, 재시작 시 `userData/vpn/session.json`으로 management에 재접속해 상태 복원. openvpn 로그는 `userData/vpn/openvpn.log`(root 소유).
- **주간보고** (`renderer/features/weekly` + `main/features/weekly`): FE챕터 공유일정의 **개인별 주간** 화면을 headless puppeteer 로 수집해 팀원별 T/OT·MM 을 카드+차트(chart.js)로 표시. 엑셀 다운로드 없이 페이지의 `calendarExcelSave()` form submit 을 후킹해 `datas`(JSON payload)를 가로챈다(익스텐션 `fe-schedule-extension` 이식). 주간 이동은 페이지 함수 `beforeWeek()`/`nextWeek()`, 현재 주는 iframe 전역 `startDate`/`endDate`(YYYYMMDD)로 판별. 개인별 주간 진입/주간 이동 직후 일정 목록이 ajax 로 늦게 채워지므로 **datasExcel 행 수 안정화 대기 + 캡처 재시도**가 들어 있음(제거하면 빈 결과 레이스 재발). T/OT 규칙: 하루 8시간까지 T, 초과분 OT, MM=시간÷8÷20.6. 전체 MM 제외 프로젝트는 칩 클릭으로 토글(localStorage `weekly:mmExcluded`, 기본 FE·전사·본부·휴가·연차·시차). 계정은 환경설정의 비즈박스 계정 공용.
- **알림** (`main/features/notify`): 알림 공통 인프라. `notify({title, body, section})` 호출 시 앱 창을 앞으로 가져와(`app.focus({steal:true})`) **알럿(`dialog.showMessageBox`)** 으로 표시하고, '이동' 버튼을 누르면 `app:navigate` IPC 로 해당 섹션 이동(App.tsx `onNavigate` 구독). macOS 미서명/개발 모드에서 Electron `Notification` 이 표시되지 않아(UNErrorDomain 1) OS 알림 권한과 무관한 알럿 방식을 사용한다. 창이 닫혀 있으면(맥) 알럿만 독립적으로 뜬다. 창 참조는 `main.ts`에서 `setNotifyWindow()` 로 등록. 사용처: ①배포 완료/실패 알림(환경설정 `settings.notifyDeploy` on/off) ②출퇴근 리마인더. 환경설정에 **테스트 알림 버튼**(`notify:test` IPC → `window.oneApp.testNotification()`)이 있어 모양 확인 가능. 새 알림이 필요하면 이 모듈을 재사용.
- **출퇴근 리마인더** (`main/features/attendance/scheduler.ts` + `reminders.ts`): 환경설정에서 **요일별(월~금)로 출근·퇴근 알림 시각**을 각각 지정(체크박스+시각). 메인 스케줄러가 매 30초 현재 시각을 확인해, 설정 시각(±2분, 슬립 대비)이 되면 근태 상태를 조회(`runAttendance('status')`)하고 **이미 찍었으면 건너뛰고 안 찍었을 때만** 알림(스마트 스킵). 상태 확인 실패(계정 없음·VPN 등)면 놓치지 않도록 알림을 띄운다(실패 알림은 하루 1회). 평일만, 기본 하루 한 번(중복 방지). **반복 알림**(`repeat: {enabled, minutes}`, 1~120분)을 켜면 설정 시각 이후 안 찍은 동안 N분 간격으로 재알림 — 앱을 늦게 켜도 발화하고, 찍은 게 확인되면 그날은 멈추며, 알럿을 안 닫고 있는 동안은 반복하지 않는다(닫은 시점부터 다시 카운트). 설정은 `userData/reminders.json`(평문). 스케줄러는 저장값을 매 tick 읽으므로 저장 후 재시작 불필요.
- **배포** (`renderer/features/deploy` + `main/features/deploy`): 프로젝트별 젠킨스 잡을 REST API로 트리거하고 상태(대기→빌드중→성공/실패)를 폴링해 표시. 대상별 [커밋 내역]으로 빌드에 포함된 커밋(changeSet)·시작자·revision 확인 가능. 프로젝트 하나에 배포 대상 여러 개(스토어·어드민 등) 등록 가능. 젠킨스 URL·계정은 배포 탭에서 프로젝트별로 등록하고, API 토큰(또는 비밀번호)은 `safeStorage`로 암호화해 `userData/deploy.json`에 저장. 인증은 Basic Auth + API 토큰 권장(비밀번호 인증은 CSRF crumb 자동 처리).

## 트러블슈팅
- `npm install` 시 `ETARGET No matching version`(존재하지 않는 버전) → **npm 캐시 손상**. `npm cache clean --force` 후 `rm -f package-lock.json && npm install`.
- `puppeteer`는 `vite.main.config.ts`에서 **external 처리**(번들 제외, 런타임 로드). 무거운 네이티브 의존성 추가 시 동일하게 external 고려.
- 개발 모드 DevTools 자동 오픈은 꺼둠(`main.ts`). 필요하면 창에서 `⌘⌥I`.
- **핫리로드 범위**: 렌더러만 HMR 적용. `src/main`/`src/preload` 변경은 리빌드는 되지만 **Electron 재시작 안 됨** → `npm start` 를 다시 실행해야 반영.

## 컨벤션
- 코드 주석·문서·대화는 **한국어**.
- **스타일은 SCSS** (`sass-embedded`, Vite 기본 지원 — `vite.renderer.config.ts`에서 modern-compiler API 사용). BEM 클래스를 `&__`/`&--` 네스팅으로 작성하고, 새 기능은 `styles/_<기능>.scss` 파일로 분리해 `index.scss`에 `@use` 추가.
- **공용 UI는 `components/`의 컴포넌트 사용** — 버튼 `Button`(variant: primary/ghost/danger), 입력 `Input`, 라벨+입력 행 `FormRow`, 섹션 제목 `SectionHeader`, 경고 배너 `Banner`, 새로고침 아이콘 `RefreshButton`. `.btn`/`.input` 등 공통 클래스 직접 사용 금지.
- 공통 레이아웃 클래스(`_base.scss`): 섹션 컨테이너 `.section`, 폼 액션 `.form-actions`, 독립 라벨 `.form-label`, 힌트 `.hint`, 주석 `.note`, 아이콘 버튼 `.icon-btn`.
- 커밋: 한국어 conventional commit (`feat`/`fix`/`refactor`/`docs`/`chore`). **커밋 메시지에 Claude 서명(Co-Authored-By 등) 넣지 말 것.** → **`/commit` 스킬 사용.**
- 새 라이브러리/기술 도입 전 **공식 문서 확인**. 큰 리팩터링은 사용자 승인 후 진행.
- 자세한 로드맵은 `ROADMAP.md` 참고.
