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

## 프로젝트 구조
```
src/
├── main/                    # 🖥️ 메인 프로세스 (Node)
│   ├── main.ts              #  진입점: 창 생성 + IPC 등록
│   ├── settings.ts          #  설정 저장 (safeStorage 로 비밀번호 암호화)
│   ├── ipc/                 #  IPC 핸들러 (기능별)
│   │   ├── schedule.ts
│   │   └── settings.ts
│   └── schedule/            #  일정 매크로 (puppeteer) — 앱 내부 실행
│       ├── config.ts        #    비즈박스 URL·셀렉터·타이밍
│       ├── scheduleUtils.ts #    일정 파싱·시간/날짜 변환
│       ├── pageMacro.ts     #    브라우저 페이지 조작
│       └── runMacro.ts      #    실행 흐름(로그인→이동→등록)
├── preload/preload.ts       # 🌉 contextBridge (window.oneApp)
├── renderer/                # 🎨 React UI
│   ├── renderer.tsx         #  React 마운트 진입점
│   ├── App.tsx              #  앱 셸(사이드바/탭/메인) + SECTIONS
│   ├── components/          #  공용 UI (Sidebar 등)
│   ├── features/            #  기능별 폴더 (schedule, settings ...)
│   ├── styles/index.css
│   └── global.d.ts          #  window.oneApp 타입
└── shared/types.ts          # 🔗 프로세스 간 공용 타입
```

## ⚠️ 반드시 지킬 것
- **진입점 파일명 고정**: `src/main/main.ts`, `src/preload/preload.ts`, `src/renderer/renderer.tsx` 의 **파일 이름**이 빌드 산출물 이름(`main.js`/`preload.js`)이 됨. 바꾸면 실행이 깨짐.
- **컨텍스트 분리 유지**: main(Node) / preload(bridge) / renderer(React). 렌더러에서 Node API 직접 사용 금지.
- **통신은 IPC + contextBridge 경유**: 렌더러↔메인은 preload에 노출한 `window.oneApp` API로만. (`nodeIntegration` 켜지 말 것)
- **공용 타입은 `src/shared/types.ts`에** 두고 3개 컨텍스트에서 import.
- **비밀/계정 정보 커밋 금지**: 비밀번호는 `safeStorage`로 암호화해 userData에만 저장. 코드·리포에 하드코딩 X. `.env`/`settings.json`(계정) 커밋 금지.

## 새 기능(섹션) 추가 방법
1. `src/renderer/features/<기능>/<기능>Section.tsx` 컴포넌트 작성
2. `src/renderer/App.tsx` 의 `SECTIONS`에 항목 추가 + `renderMain()`에 분기 추가
3. (파일·프로세스·네이티브 작업이 필요하면) 아래도 함께:
   - `src/main/ipc/<기능>.ts` 에 핸들러 작성 → `main.ts`에서 `register...Ipc()` 호출
   - `src/preload/preload.ts` 에 API 노출
   - `src/shared/types.ts` 에 타입 추가 + `src/renderer/global.d.ts` 의 `window.oneApp` 타입 갱신

## 주요 기능 메모
- **일정 등록** (`features/schedule` + `main/schedule`): 비즈박스 그룹웨어에 하루 일정을 puppeteer로 자동 등록. 계정 정보는 **환경설정 탭**에서 입력 → `safeStorage`로 암호화 저장. 실행 시 자동화 브라우저가 열리며, 완료 후에도 확인용으로 유지됨.
- **환경설정** (`features/settings` + `main/settings.ts`): 비즈박스 ID/비밀번호 관리.

## 트러블슈팅
- `npm install` 시 `ETARGET No matching version`(존재하지 않는 버전) → **npm 캐시 손상**. `npm cache clean --force` 후 `rm -f package-lock.json && npm install`.
- `puppeteer`는 `vite.main.config.ts`에서 **external 처리**(번들 제외, 런타임 로드). 무거운 네이티브 의존성 추가 시 동일하게 external 고려.
- 개발 모드 DevTools 자동 오픈은 꺼둠(`main.ts`). 필요하면 창에서 `⌘⌥I`.

## 컨벤션
- 코드 주석·문서·대화는 **한국어**.
- 커밋: 한국어 conventional commit (`feat`/`fix`/`refactor`/`docs`/`chore`). **커밋 메시지에 Claude 서명(Co-Authored-By 등) 넣지 말 것.** → **`/commit` 스킬 사용.**
- 새 라이브러리/기술 도입 전 **공식 문서 확인**. 큰 리팩터링은 사용자 승인 후 진행.
- 자세한 로드맵은 `ROADMAP.md` 참고.
