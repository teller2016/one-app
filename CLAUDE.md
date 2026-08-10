# One App — Claude 작업 가이드

> macOS 데스크톱 앱. 하나의 창에서 사내 도구를 관리하는 **워크스페이스형 허브**(사이드바 + 탑바 + 메인 영역).
> 사용자·코드·문서 모두 **한국어**를 사용합니다.

## 기술 스택
- **Electron + React + TypeScript** / 빌드·패키징 **Electron Forge + Vite**
- 런타임: Node.js 22 · Electron 43 · React 18
- 스타일: SCSS (`sass-embedded`) — 룩앤필 기준은 `DESIGN.md`

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
├── main/                     # 🖥️ 메인 프로세스 (Node)
│   ├── main.ts               #   진입점: 창 생성 + register*Ipc() 호출  ← 파일명 고정
│   ├── features/<기능>/      #   ipc.ts(핸들러) + 로직 + store.ts 를 한 폴더에
│   └── lib/                  #   공통 유틸 — http · store · util · broadcast · groupware · moIpc · sanitize
├── preload/preload.ts        # 🌉 contextBridge (window.oneApp)          ← 파일명 고정
├── renderer/                 # 🎨 React UI
│   ├── renderer.tsx          #   React 마운트 진입점                      ← 파일명 고정
│   ├── app/App.tsx           #   앱 셸(사이드바/탑바/메인) + SECTIONS + ToastProvider
│   ├── components/           #   공용 UI (Button·Modal·DatePicker·Pagination …)
│   ├── lib/                  #   공용 훅 — theme · usePolling · useCopy · usePopover
│   ├── features/<기능>/      #   components/ + lib/ + index.ts(공개 API)
│   └── styles/               #   index.scss + _base.scss(토큰) + _<기능>.scss
├── mobile/                   # 📱 MO 터미널 페이지 (Vite 엔트리 mobile_window, plain TS)
├── mobile-app/               # 📱 MO 앱 셸 (Vite 엔트리 mobile_app_window, 렌더러 재사용)
└── shared/                   # 🔗 프로세스 공용 — types.ts · terminal-protocol.ts · mo-protocol.ts
```

**기능 목록**
- **섹션**(`App.tsx` 의 `SECTIONS` 순 — **첫 항목이 앱을 열었을 때의 화면**): 터미널 · Jira · Nightwatch · PR · 배포 · 프로젝트 · 딥링크 · 결재 · 일정 등록 · 주간보고 · 환경설정
- **사이드바 위젯**: 메일(상단) · 폰 미러링 · VPN · 출퇴근(하단 — 야근 결재 모달 진입점 포함)
- **섹션이 아닌 화면**: 변경사항(터미널 드로어 + MO '변경' 탭) · 야근 결재 모달(출퇴근 위젯 — 본문은 결재 섹션의 폼 재사용)
- **공통 인프라**: `groupware`(로그인 세션) · `notify`(알림) · `projects`(프로젝트 레지스트리) · `tray`

## ⚠️ 반드시 지킬 것
- **진입점 파일명 고정**: `src/main/main.ts`, `src/preload/preload.ts`, `src/renderer/renderer.tsx` 의 **파일 이름**이 빌드 산출물 이름(`main.js`/`preload.js`)이 된다. 바꾸면 실행이 깨진다.
- **컨텍스트 분리 유지**: main(Node) / preload(bridge) / renderer(React). 렌더러에서 Node API 직접 사용 금지.
- **통신은 IPC + contextBridge 경유**: 렌더러↔메인은 preload 에 노출한 `window.oneApp` API로만. (`nodeIntegration` 켜지 말 것)
- **공용 타입은 `src/shared/types.ts`에** 두고 3개 컨텍스트에서 import.
- **비밀/계정 정보 커밋 금지**: 비밀번호는 `safeStorage`로 암호화해 userData 에만 저장. 코드·리포에 하드코딩 X. `.env`/`settings.json`(계정) 커밋 금지.
- **⚠️ 그룹웨어 접근은 공용 세션(`main/features/groupware/session.ts`)을 쓸 것** — 같은 계정 동시 로그인은 서버가 거부한다.
- **⚠️ 보존할 데이터를 localStorage 에 저장하지 말 것** — 강제 종료 시 flush 안 됨(2026-07-29 실측). IPC 로 userData JSON 에 저장한다.

## 컨벤션
- 코드 주석·문서·대화는 **한국어**.
- **기능 간 참조는 `features/<기능>/index.ts`(공개 API)로만.** 기능 내부 파일을 다른 기능에서 직접 import 하지 않는다.
- **공용 UI 컴포넌트를 쓸 것** (`renderer/components/`) — 네이티브 `input[type=date/time]`·원시 체크박스·`<select>` 직접 사용 금지, `.btn`/`.input` 등 공통 클래스 직접 사용 금지. 이모지 대신 공용 `Icon`.
- **공통 유틸 재사용 (중복 정의 금지)** — 렌더러 `lib/`(usePolling·useCopy·usePopover), 메인 `lib/`(fetchWithTimeout·store·broadcast·util). 특히 **전역 fetch 직접 사용 금지**(타임아웃 없어 IPC hang).
- **색·크기·모션은 `_base.scss` 토큰(`var(--*)`)에서** — hex·px 매직넘버 금지. 기준은 `DESIGN.md`.
- 커밋: 한국어 conventional commit (`feat`/`fix`/`refactor`/`docs`/`chore`). **Claude 서명(Co-Authored-By 등) 넣지 말 것.** → **`/commit` 스킬 사용.**
- 새 기능(섹션) 추가는 **`/new-section` 스킬** 참고 (렌더러→SECTIONS→SCSS→IPC→타입 순서).
- 새 라이브러리/기술 도입 전 **공식 문서 확인**. 큰 리팩터링은 사용자 승인 후 진행.

## 트러블슈팅 (개발 전반)
- `npm install` 시 `ETARGET No matching version` → **npm 캐시 손상**. `npm cache clean --force` 후 `rm -f package-lock.json && npm install`.
- **dev 모드에서 화면이 비면(`504 Outdated Optimize Dep`)** → `rm -rf node_modules/.vite*` 후 재시작. (엔트리별 `cacheDir` 분리가 이미 되어 있다 — 엔트리 추가 시에도 분리 필수)
- **핫리로드 범위**: 렌더러만 HMR. `src/main`/`src/preload` 변경은 **Electron 재시작 안 됨** → `npm start` 재실행.
- 개발 모드 DevTools 자동 오픈은 꺼둠(`main.ts`). 필요하면 창에서 `⌘⌥I`.
- `npm i` 후 `posix_spawnp failed` → `node-pty` 의 `spawn-helper` 실행 권한 문제. `package.json` 의 `postinstall` 확인.

## 상세 규칙은 `.claude/rules/` 에 있다
작업 대상 파일을 열면 아래 규칙이 **자동으로 로드**된다. 기능 상세·함정·실측 기록은 CLAUDE.md 가 아니라 여기에 쓴다.

| 파일 | 적용 경로 | 내용 |
|------|-----------|------|
| `main-process.md` | `src/main/**` · `src/preload/**` · `src/shared/**` | 공통 유틸·IPC 등록·`handleShared`(MO 화이트리스트) |
| `renderer-ui.md` | `src/renderer/**` · `src/mobile-app/**` (ts·tsx) | 공용 컴포넌트 목록·피커 팝오버·공통 훅 |
| `styles.md` | `**/*.scss` · `DESIGN.md` | SCSS 작성법·공통 클래스·비브런시 셸·폰 스타일 |
| `groupware-session.md` | 그룹웨어 계열 main 기능 | 공용 세션·`gotoWithSession`·쿠키 함정 |
| `build-packaging.md` | `forge.config.ts` · `vite.*.config.ts` | external 의존성·node-pty 패키징·cacheDir |
| `features/terminal.md` | terminal · `src/mobile/**` | tmux 백엔드·attach 프로토콜·xterm 6 함정·MO 접속 |
| `features/mo-app.md` | `src/mobile-app/**` · moIpc · rpc | RPC shim·broadcast fan-out·폰 셸 |
| `features/approval.md` | approval | 결재 3종(야근·휴가·지출결의서)·BrowserWindow 자동화 함정 |
| `features/groupware-apps.md` | schedule · attendance · weekly · mail | 네 기능의 동작·실측 함정 |
| `features/devops.md` | projects · deploy · prs · jira · nightwatch | 프로젝트 레지스트리·젠킨스·Gitea·Jira·분석 미션 |
| `features/system.md` | settings · vpn · mirror · notify · tray · applink | 위젯·알림 인프라·adb 함정 |
| `features/changes.md` | changes | git 상태·diff·푸시, 경로 탈출 방어 |

**스킬**: `/commit`(커밋) · `/new-section`(새 기능 추가)
**로드맵**: `ROADMAP.md`
