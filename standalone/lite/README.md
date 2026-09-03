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

## 배포 (`/release` 스킬)

산출물과 **받는 사람용 안내**는 배포 전용 public 리포에 둔다 — 소스는 올리지 않는다.

> Claude 로 작업할 때는 **`/release`** 를 쓴다 — 변경점 정리 → 버전 제안 → 승인 → 아래 스크립트 실행 →
> 결과 확인 → **팀원 공지 문구**까지 만들어 준다. `npm run release` 직접 호출은 훅이 막는다
> (`.claude/hooks/require-build-skill.mjs` — public 릴리스는 되돌리기 어렵다).

> **배포 리포**: <https://github.com/teller2016/one-app-lite>
> **팀원에게 주는 링크**: <https://github.com/teller2016/one-app-lite/releases/latest> — 한 번만 공유하면 다음 배포에도 그대로 유효하다.
> **받는 사람용 사용 안내의 정본은 그 리포의 README** 다(설치·첫 설정·결재·티켓 보고·문제 해결). 사용법이 바뀌면 여기가 아니라 **그쪽을 고친다.**

```bash
cd standalone/lite
npm run release                      # 2.0.0 → 2.0.1 (patch)
npm run release -- --minor           # 2.0.0 → 2.1.0
npm run release -- --version=2.5.0   # 직접 지정
npm run release -- --notes="티켓 보고 필터 버그 수정"
npm run release -- --dry-run         # 빌드까지만, 업로드 직전에 멈춘다
npm run release -- --skip-build      # 이미 만든 산출물로 업로드만 (dry-run 다음에 이어서)
```

스크립트(`scripts/release.mjs`)가 하는 일 — ① `gh` 인증 확인 → ② `npm run typecheck` → ③ 버전 bump → ④ **`CHANGELOG.md` 에서 그 버전 항목을 릴리스 노트로** 읽기(없으면 중단 — `--notes` 로 대신 줄 수 있다) → ⑤ `out/make` 비우고 **Windows·macOS 빌드** → ⑥ macOS 서명 검증 → ⑦ 이번 버전 zip 만 골라 `gh release create v<버전>` 으로 업로드 + `CHANGELOG.md` 를 배포 리포에 올림 → ⑧ 공유 링크 출력(클립보드 복사).

**버전 자리는 `CHANGELOG.md` 항목 표기로 정한다**(`[주의]` → a · `[추가]`/`[변경]` → b · `[개선]`/`[수정]` → c — 규칙 표는 그 파일 머리말). `/release` 가 판단하고, 스크립트는 표기보다 낮게 올렸으면 경고한다.

- **맥 한 대에서 두 플랫폼이 다 나온다** — zip maker 만 쓰므로 Windows 산출물도 크로스 빌드된다.
- **커밋·태그는 스크립트가 하지 않는다.** 올라간 `package.json` 버전은 `/commit` 으로 따로 커밋한다.
- 같은 태그가 이미 있으면 **업로드 전에 멈춘다**(받은 사람과 버전이 어긋나는 것을 막는다).
- 산출물이 한 플랫폼만 나오면 경고만 하고 진행한다 — 그 OS 팀원은 못 받으니 확인할 것.

### 앱 안의 새 버전 확인 + 자동 설치 (2.0.1 부터)
`src/main/update.ts` 가 **배포 리포의 최신 릴리스**를 조회해(`update:check`) 현재 버전과 비교하고, 새 버전이면 제목바 아래 배너를 띄운다. **[지금 업데이트]** 를 누르면 앱이 zip 을 받아 검증·압축 해제하고, 헬퍼 스크립트에 교체를 맡긴 뒤 종료 → 헬퍼가 바꿔 끼우고 다시 띄운다(`updateInstall.ts` · `updateCore.ts`). 환경설정 **'버전'** 그룹에서 수동 확인·설치도 된다.

**Squirrel(electron autoUpdater)을 쓰지 않는 이유** — macOS 는 Apple Developer ID 서명이 필수고 Windows 는 `Setup.exe` 설치본이 필요한데(맥에서 빌드 불가), 우리는 자가서명 + zip 이다. 대신 직접 구현했고, 그 덕에 **앱이 받은 파일에는 검역 표시(quarantine · Zone.Identifier)가 붙지 않아** 업데이트에서는 Mac 의 `xattr`·Windows SmartScreen 안내가 필요 없다.

```
배너 [지금 업데이트] → 확인 다이얼로그
  → 다운로드(진행률, 60초 무응답이면 중단) → 크기·sha256 검증(GitHub asset digest)
  → 압축 해제 (mac: ditto -xk · win: tar, 없으면 Expand-Archive) → 앱 찾기
  → 헬퍼 스크립트 기록·실행 (mac: /bin/sh · win: PowerShell -ExecutionPolicy Bypass)
  → app.quit()  ┈┈ 여기까지의 실패는 전부 배너에 안내 + [받은 폴더 열기]/[릴리스 페이지] 폴백
헬퍼: 앱 종료 대기 → 옛 앱을 .bak 으로 → 새 앱 이동 → 재실행 → .bak·스테이지 삭제
      실패하면 .bak 원복 후 원래 앱 재실행. 로그: <temp>/OneAppLite-update.log
```

- **자동 설치가 막히는 경우**(`installBlocked` → [받기]로 릴리스 페이지): 이 PC 용 zip 이 없음(Intel 맥) · 개발 인스턴스 · macOS App Translocation(다운로드 폴더에서 바로 실행) · Windows 에서 exe 가 앱 폴더 구조(`resources/app.asar`) 안에 없거나 바탕화면·홈 폴더 자체인 경우 · 앱이 있는 폴더에 쓰기 불가.
- Windows 헬퍼는 **이 맥에서 실행해 볼 수 없다.** 백업 이름 바꾸기 재시도(백신 잠금) · 드라이브가 다르면 복사 후 삭제 · 한글 경로는 인자 대신 스크립트 본문에 박고 UTF-8 BOM 으로 저장(PowerShell 5.1) — 이 가정들은 `updateCore.test.ts` 가 지킨다. 그룹 정책이 스크립트를 막는 PC 는 **앱을 끄기 전에** 프로브 스크립트로 확인해 폴백으로 빠진다.
- 조회 실패(사내망에서 GitHub 차단·오프라인)는 **조용히 무시**한다 — 앱 동작을 막지 않는다.
- ⚠️ 리포 주소는 `scripts/release.mjs` 와 `src/main/update.ts` **두 곳의 `REPO` 상수**에 있다. 바꾸면 함께 바꾼다(올리는 곳과 보는 곳이 같아야 한다).
- ⚠️ zip 이름 `OneAppLite-<platform>-<arch>-<버전>.zip` 은 `pickAsset()` 이 이 PC 용 파일을 고르는 근거다 — forge maker-zip 기본 이름이며 바꾸지 않는다.
- **테스트 훅**: `ONE_APP_LITE_FORCE_UPDATE_TAG=v2.0.0` 을 주고 띄우면 그 태그를 새 버전으로 취급한다(버전 비교 무시). 패키징 앱으로 교체 흐름을 실제로 돌려볼 때 쓴다:
  `ONE_APP_LITE_FORCE_UPDATE_TAG=v2.0.0 out/OneAppLite-darwin-arm64/OneAppLite.app/Contents/MacOS/OneAppLite`
  (개발 인스턴스에서는 다운로드·압축 해제까지만 하고 "교체하지 않습니다" 로 멈춘다 — 교체할 번들이 없다. ⚠️ 패키징 앱과 dev 는 userData 가 같아 **단일 인스턴스 락이 겹친다** — 둘을 동시에 띄우지 말 것.)

### 빌드만 하기

```bash
npm install
npm run make:win     # → out/make/zip/win32/x64/OneAppLite-win32-x64-<버전>.zip
npm run make:mac     # → out/make/zip/darwin/arm64/OneAppLite-darwin-arm64-<버전>.zip
```

- **본체 리포 안에서 빌드해야 한다** — `@one/*` 가 `../../src` 를 가리키므로 이 폴더만 떼어 내면 빌드가 안 된다. (산출물은 단독으로 돈다)
- **Windows 는 zip 만** 만든다. 설치 프로그램(Squirrel `Setup.exe`)이나 단일 portable exe 는 NSIS/mono·wine 이 필요해 맥에서 바로 만들 수 없다.
- 실행 파일 이름을 영문(`OneAppLite.exe`)으로 고정한 이유: 맥에서 만든 zip 의 한글 파일명이 Windows 탐색기에서 깨질 수 있다.
- **macOS 는 자가서명 인증서 `One App Sign` 으로 서명**된다(`forge.config.ts` 의 postPackage 훅).
  adhoc 서명이면 리빌드마다 서명이 바뀌어 `safeStorage` 의 키체인 접근이 끊기고 **저장한 계정이 날아간다**.
  인증서가 없는 맥에서는 서명 없이 통과하므로, 그 경우 리빌드 후 계정 재입력이 필요할 수 있다.
- ⚠️ **자가서명은 받는 맥에서 검증되지 않는다** — 그 인증서를 그쪽이 모르기 때문이다(계정 유실을 막으려고 **빌드 간 서명을 고정**하는 것이 목적이지, Gatekeeper 를 통과하려는 것이 아니다). 게다가 인터넷에서 받은 zip 에는 quarantine 이 붙어 macOS 15+ 는 '우클릭 → 열기' 우회도 막는다. 받는 사람 안내는 **`xattr -dr com.apple.quarantine /Applications/OneAppLite.app`** 한 줄이 가장 확실하다(배포 리포 README 에 적혀 있다). 없애려면 Apple Developer 계정($99/년)으로 공증(notarize)해야 한다.
- Windows 도 미서명이라 **SmartScreen 경고**가 매 버전 뜬다(추가 정보 → 실행). 없애려면 OV/EV 코드 서명 인증서가 필요하다 — 사내 소규모 배포에는 권하지 않는다.
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
├── scripts/
│   ├── make-icon.mjs          본체 아이콘의 **색만** 바꿔 위 3개를 만든다 (npm run icon)
│   └── release.mjs            버전 bump → 양 플랫폼 빌드 → GitHub Releases 업로드 (npm run release)
├── forge.config.ts            executableName · 아이콘 · macOS 자가서명 훅 · ZIP maker
├── vite.{main,preload,renderer}.config.ts
│                              `@one` alias(= ../../src) · 렌더러는 react dedupe + fs.allow(리포 루트)
├── tsconfig.json              paths { "@one/*": ["../../src/*"] }
└── src/
    ├── shared/update.ts       UpdateInfo · UpdateProgress · UpdateInstallResult — 새 버전 확인·설치 (이 앱만의 타입)
    ├── main/
    │   ├── main.ts            창 하나 + 본체 IPC 등록(registerSettingsIpc · registerApprovalIpc · registerJiraReportIpc) + registerUpdateIpc
    │   ├── update.ts          최신 릴리스 조회(update:check) · 설치 진입(update:install) · 폴백 폴더 열기(update:open-folder)
    │   ├── updateInstall.ts   다운로드 → 검증 → 압축 해제 → 헬퍼 실행 → app.quit() (교체 대상 판정 포함)
    │   ├── updateCore.ts      순수 로직 — 버전 비교 · 이 PC 용 zip 고르기 · mac/win 헬퍼 스크립트 본문 (electron 미의존)
    │   └── updateCore.test.ts 위 순수 로직 테스트 — **루트 `npm test`** 가 돌린다(이 폴더 tsc 는 *.test.ts 를 제외)
    ├── preload/preload.ts     window.oneApp — 본체 preload 의 **부분집합** (settings · approval · jira.report · update · openExternal)
    └── renderer/
        ├── renderer.tsx       본체 initTheme + 마운트
        ├── App.tsx            셸(제목바 세그먼트 [결재 | 티켓 보고] · 환경설정 · 새 버전 배너) — 본문은 본체 ApprovalSection · JiraReportPanel
        ├── views/SettingsView.tsx  이 앱만의 화면 (본체 환경설정의 부분집합 + 버전/업데이트 확인, 채널은 본체와 같은 settings:set)
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
