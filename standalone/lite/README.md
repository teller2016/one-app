# One App Lite (단독 배포판)

One App 본체에서 **동료에게 건네줄 수 있는 기능만** 뽑아 Windows·macOS 실행 파일로 만든 앱. 화면 이름은 "One App Lite", 실행 파일은 `OneAppLite`.

| 화면 | 하는 일 |
|------|---------|
| **결재** | 본체 결재 섹션 그대로 — 야근 결재 · 휴가신청서 · 지출결의서(개인) 작성 + [전자결재 상신함 열기]. 세 결재 모두 **작성만** 하고 [상신]은 사용자가 창에서 직접 누른다 |
| **티켓 보고** | Jira 티켓을 프로젝트·기간으로 모아 상태·담당자·레이블·유형으로 걸러낸 뒤 `SSB-111 티켓명` 같은 형식으로 **한 번에 복사** (형식은 템플릿으로 바꿀 수 있다) |
| **환경설정** | 비즈박스 사번·비밀번호 · 결재 소속 · Jira 주소·이메일·API 토큰 · 테마 |

- **본체 코드를 복사하지 않는다** — `@one/*`(= `../../src`) alias 로 본체 파일을 **직접 import** 해 번들한다. 본체를 고치면 다음 빌드에 그대로 실린다. 빌드 산출물은 본체 없이 단독으로 돈다.
- **의존성 없음** — 브라우저 자동화는 Electron 자체 `BrowserWindow` 라 받는 사람 PC 에 Chrome 이 필요 없다.
- **계정은 각자 PC 에만** — 비밀번호·API 토큰은 Electron `safeStorage`(Windows DPAPI · macOS 키체인)로 암호화해 `userData/settings.json` 에 저장한다.
- **인터넷만 있으면 동작** — 그룹웨어·Jira Cloud 모두 외부에서 접근된다.

> ⚠️ **2.0(One App Lite)은 1.x(OvertimeApproval · "결재 도우미")와 저장 위치가 다르다.** 실행 파일명이 바뀌어 `userData` 경로와 키체인 항목이 달라졌으므로, 1.x 를 쓰던 사람은 **계정을 다시 입력**해야 한다(2026-09-03 사용자 승인). 야근 결재도 1.x 의 '자동 상신'이 아니라 본체와 같은 '작성만' 이다.

---

## 받는 사람용 사용 안내 (그대로 전달해도 되는 문구)

1. `OneAppLite-win32-x64-2.0.0.zip` 압축을 풀고 폴더 안의 **`OneAppLite.exe`** 실행
   (폴더째로 옮겨야 실행됩니다 — exe 하나만 빼내면 동작하지 않습니다)
2. 처음 실행하면 Windows 가 *"Windows의 PC 보호"* 경고를 띄웁니다 → **추가 정보 → 실행**
   (사내 배포용 미서명 앱이라 나오는 경고입니다)
3. 첫 화면(환경설정)에서 **사번(ID)·비밀번호**를 저장 (그룹웨어 로그인 계정)
   - **결재 소속**은 야근 결재 근무자 표의 '소속' 칸과 휴가신청서 제목에 그대로 들어갑니다(예: `FE챕터 플랫폼기술부문`). **비워 두면 야근·휴가 결재를 시작할 수 없습니다** — 기본값은 없습니다
   - 티켓 보고를 쓰려면 **Jira 주소·이메일·API 토큰**도 저장 (토큰은 Atlassian 계정 설정 → 보안 → API 토큰 만들기)

### 결재

4. 상단 [결재] → 종류 카드를 고르고 폼을 채운 뒤 **[작성 시작]**
   - 자동화 창이 뜨고 채워지는 것이 보입니다. **끝날 때까지 건드리지 마세요.**
5. 작성이 끝나면 창이 그대로 남습니다 → **그 창에서 [상신](지출결의서는 첨부 후 [결재상신])을 직접** 누르세요
   - 앱은 상신하지 않습니다. 완료 화면의 [전자결재 상신함 열기]로 올라간 문서를 확인할 수 있습니다

### 티켓 보고

4. 상단 [티켓 보고] → **프로젝트**를 고르고 **기간**(월 / 직접 / 전체)과 **기준**(갱신일·생성일·해결일)을 정한 뒤 **[조회]**
   - 조회한 조건은 저장되어 다음에 열 때 자동으로 다시 조회됩니다
5. 결과 위의 **상태·담당자·레이블·유형** 셀렉트와 검색창으로 걸러내고, 필요하면 체크박스로 원하는 행만 고릅니다
6. **[N건 복사]** → 붙여넣기. 기본 형식은 `SSB-111 티켓명` 이고, 템플릿 칸에서 바꿀 수 있습니다
   - 템플릿 칸 옆 **`(i)`** 를 누르면 쓸 수 있는 자리표시자 목록이 펼쳐집니다 — 각 항목에 설명과 첫 티켓의 실제 값이 함께 보이고, 누르면 커서 자리에 삽입됩니다
   - 자리표시자: `{key}` `{summary}` `{status}` `{type}` `{assignee}` `{reporter}` `{priority}` `{labels}` `{project}` `{parent}` `{parentSummary}` `{url}` `{created}` `{resolved}` `{updated}` · 탭은 `\t`, 줄바꿈은 `\n`
   - 프리셋: 번호 / 티켓명 / 번호 티켓명 / 번호 티켓명 (상태) / 탭 구분(표 붙이기) / 링크만
   - 고급: [JQL 직접 입력]을 켜면 조건 대신 입력한 JQL 을 그대로 보냅니다

---

## 빌드

```bash
cd standalone/lite
npm install
npm run make:win     # → out/make/zip/win32/x64/OneAppLite-win32-x64-2.0.0.zip
npm run make:mac     # → out/make/zip/darwin/arm64/OneAppLite-darwin-arm64-2.0.0.zip
```

- **본체 리포 안에서 빌드해야 한다** — `@one/*` 가 `../../src` 를 가리키므로 이 폴더만 떼어 내면 빌드가 안 된다. (산출물은 단독으로 돈다)
- **Windows 는 zip 만** 만든다. 설치 프로그램(Squirrel `Setup.exe`)이나 단일 portable exe 는 NSIS/mono·wine 이 필요해 맥에서 바로 만들 수 없다.
- 실행 파일 이름을 영문(`OneAppLite.exe`)으로 고정한 이유: 맥에서 만든 zip 의 한글 파일명이 Windows 탐색기에서 깨질 수 있다.
- **macOS 는 자가서명 인증서 `One App Sign` 으로 서명**된다(`forge.config.ts` 의 postPackage 훅).
  adhoc 서명이면 리빌드마다 서명이 바뀌어 `safeStorage` 의 키체인 접근이 끊기고 **저장한 계정이 날아간다**.
  인증서가 없는 맥에서는 서명 없이 통과하므로, 그 경우 리빌드 후 계정 재입력이 필요할 수 있다.
- 맥 산출물을 다른 맥에 전달하면 Gatekeeper 가 막는다 → **우클릭 → 열기**(또는 시스템 설정 → 개인정보 보호 및 보안 → *확인 없이 열기*).
- `npm install` 이 `ETARGET No matching version` 으로 실패하면 npm 캐시 손상이다 → `npm cache clean --force` 후 `rm -f package-lock.json && npm install`(본체 CLAUDE.md 트러블슈팅과 같다).

## 개발

```bash
npm start          # 개발 모드 (렌더러만 HMR — main/preload 수정 시 재시작 필요)
npm run typecheck  # tsc --noEmit — 본체 파일까지 따라가며 검사한다
npm run icon       # 아이콘 3종 재생성 (본체 아이콘을 바꿨을 때만)
```

본체 `npm start` 와 동시에 띄워도 된다(포트가 다르다). 단, **설정 파일은 본체와 공유하지 않는다** — 앱 이름이 달라 `userData` 가 `One App` 이 아닌 `OneAppLite` 다. 개발 인스턴스와 패키징 앱은 같은 `OneAppLite` userData 를 쓴다.

### 아이콘
본체 `assets/icon.png` 의 **색만 바꿔** 쓴다 — 모양이 같아야 같은 계열 앱으로 읽히고, 색이 달라야 Dock·탐색기에서 구분된다. 본체는 액센트 블루, 이쪽은 그린이다.

- 다른 색으로 바꾸려면 `npm run icon -- --hue=285` (0~359. 285=퍼플 · 190=틸 · 330=핑크). 오렌지는 본체 개발 인스턴스의 `DEV` 밴드가 쓰므로 피한다.
- ⚠️ **hue 만 돌리면 안 된다** — 채도·명도가 같아도 초록·노랑 계열은 휘도가 훨씬 높아 형광색처럼 뜬다(실측: 블루 #1C82E5 휘도 0.45 → 같은 s·l 의 그린 0.68). 그래서 픽셀별로 **원본과 같은 휘도**가 되는 명도를 이분법으로 찾는다.
- PNG 디코드·인코드는 본체 `scripts/lib/png.mjs` 를 공용으로 쓴다(`npm run icon:dev` 와 같은 코덱). 이미지 라이브러리 의존성은 없고, `.icns`·`.ico` 는 macOS 기본 도구(`sips`·`iconutil`)와 직접 조립으로 만든다.

---

## 구조

```
standalone/lite/
├── assets/                    icon.png · icon.icns(mac) · icon.ico(win) — 커밋한다
├── scripts/make-icon.mjs      본체 아이콘의 **색만** 바꿔 위 3개를 만든다 (npm run icon)
├── forge.config.ts            executableName · 아이콘 · macOS 자가서명 훅 · ZIP maker
├── vite.{main,preload,renderer}.config.ts
│                              `@one` alias(= ../../src) · 렌더러는 react dedupe + fs.allow(리포 루트)
├── tsconfig.json              paths { "@one/*": ["../../src/*"] }
└── src/
    ├── main/main.ts           창 하나 + 본체 IPC 등록(registerSettingsIpc · registerApprovalIpc · registerJiraReportIpc)
    ├── preload/preload.ts     window.oneApp — 본체 preload 의 **부분집합** (settings · approval · jira.report · openExternal)
    └── renderer/
        ├── renderer.tsx       본체 initTheme + 마운트
        ├── App.tsx            셸(제목바 세그먼트 [결재 | 티켓 보고] · 환경설정) — 본문은 본체 ApprovalSection · JiraReportPanel
        ├── views/SettingsView.tsx  이 앱만의 화면 (본체 환경설정의 부분집합, 채널은 본체와 같은 settings:set)
        ├── styles/index.scss  본체 base · approval · jira 를 @use + 셸 스타일(_app.scss)
        └── types/global.d.ts  window.oneApp 의 부분집합 타입 — 아래 '왜 부분집합인가'
```

**본체에서 가져오는 것** — 전부 electron·node 내장 모듈만 쓰는 순수 모듈이다.

| 계층 | 본체 파일 |
|------|-----------|
| main | `features/approval/*`(ipc·overtime·vacation·expend·eaBox·gw·keeper·store) · `features/jira/report.ts`(+ jira.ts·store.ts) · `features/settings/{ipc,store}.ts` · `features/groupware/{session,config}.ts` · `lib/{browser,store,http,util,groupware,windowState,devInstance,moIpc,sanitize}.ts` |
| renderer | `features/approval`(index) · `features/jira/components/JiraReportPanel.tsx` · `components/*` · `lib/{theme,errMsg,useCopy,usePopover,…}` · `styles/{_base,_approval,_jira}.scss` |
| shared | `types.ts` · `date.ts` · `approval-format.ts` · `jira-report.ts` |

### 왜 preload·global.d.ts 가 부분집합인가
본체 컴포넌트를 import 하면 tsc 가 그 파일까지 검사한다. `window.oneApp` 타입을 이 앱이 실제로 노출하는 채널만으로 선언해 두면, **이 앱에 없는 채널을 부르는 컴포넌트를 들여왔을 때 빌드 전에 걸린다**(런타임에 `undefined` 호출로 터지는 대신). 그래서 본체 `global.d.ts` 를 통째로 가져오지 않는다.

- 같은 이유로 `features/jira` 는 **index 가 아니라 컴포넌트 파일을 직접 import** 한다 — index 가 `JiraSection`(터미널 세션·작업 시작 채널 의존)까지 내보내기 때문이다.
- 본체에서 결재·보고 컴포넌트가 새 채널을 쓰게 되면 `preload.ts` 와 `global.d.ts` 를 함께 늘린다. 채널 이름·인자·반환 모양은 본체 preload 와 **똑같이** 맞춘다.

### ⚠️ 함정 (2026-09-03 재구성 때 확인)
| 증상 | 원인 | 대응 |
|------|------|------|
| 렌더러가 "Invalid hook call" 로 죽음 | 본체 파일은 본체 `node_modules/react`, 이 앱 파일은 이 앱의 react 를 각자 해석 → React 두 벌 | `vite.renderer.config.ts` 의 `resolve.dedupe: ['react','react-dom']` + package.json 의 react 버전을 **본체와 같게** 유지 |
| dev 서버가 본체 파일을 403 으로 거부 | Vite 는 프로젝트 루트 밖 파일을 서빙하지 않는다 | `server.fs.allow: [리포 루트]` |
| prod 에서 폰트가 안 뜸 | `loadFile`(file://) 에서 base `/` 는 파일시스템 루트 | `base: './'` (본체와 같은 이유) |
| 리빌드 후 저장한 계정이 사라짐 | 서명이 바뀌면 safeStorage 키체인 접근이 끊긴다 · 실행 파일명을 바꾸면 userData·키체인 항목이 바뀐다 | `One App Sign` 자가서명 유지 · `EXECUTABLE` 을 바꾸지 말 것 |

### One App 본체와의 관계 (요약)
- **같은 코드가 돈다** — 복사본이던 1.x(`standalone/overtime`)에서는 `formatHoursTotal` 의 `start === end` 가드가 이 앱에만 빠져 '0시간' 이 기입되는 드리프트가 실제로 났다(2026-08-26). 2.0 부터는 그런 동기화 항목이 없다.
- 결재 마무리 방침도 본체와 같다 — 작성만, [상신]은 사용자가.
- 결재 소속은 환경설정 '결재 소속'(`approvalDept`) → 본체 `approval/store.ts` 의 `getWorkerDept()` 가 읽는다. **기본값은 없다**(2026-09-03 사용자 결정) — 비면 본체 `approval/ipc.ts` 가 야근·휴가 작성을 막고 안내한다.
