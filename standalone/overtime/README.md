# 야근 결재 상신 (단독 배포판)

그룹웨어(gw.forbiz.co.kr) 전자결재 **연장근무내역서**를 대신 작성해 상신하는 단독 실행 앱.
One App 본체의 `src/main/features/overtime` + `OvertimeModal` 을 **Windows 동료에게 실행 파일로 건네줄 수 있게** 뽑아낸 것이다.

- **의존성 없음** — 브라우저 자동화를 puppeteer 대신 Electron 자체 `BrowserWindow` 로 하므로, 받는 사람 PC 에 Chrome 을 따로 깔 필요가 없다.
- **계정은 각자 PC 에만** — 사번·비밀번호는 Electron `safeStorage`(Windows DPAPI · macOS 키체인)로 암호화해 `userData/settings.json` 에 저장한다.
- **인터넷만 있으면 동작** — 비즈박스 그룹웨어는 외부에서도 접근되므로 사내망·VPN 이 필요하지 않다.

---

## 받는 사람용 사용 안내 (그대로 전달해도 되는 문구)

1. `OvertimeApproval-win32-x64-1.0.0.zip` 압축을 풀고 폴더 안의 **`OvertimeApproval.exe`** 실행
   (폴더째로 옮겨야 실행됩니다 — exe 하나만 빼내면 동작하지 않습니다)
2. 처음 실행하면 Windows 가 *"Windows의 PC 보호"* 경고를 띄웁니다 → **추가 정보 → 실행**
   (사내 배포용 미서명 앱이라 나오는 경고입니다)
3. 첫 화면에서 **사번(ID)·비밀번호·소속**을 저장 (그룹웨어 로그인 계정)
   - 소속은 연장근무내역서 근무자 표의 '소속' 칸에 그대로 들어갑니다 (예: `플랫폼서비스사업부문 FE`)
4. 날짜·근무시간·업무 대상·수행 내용·사유를 채우고 **[상신하기]**
   - **[미리보기]** 를 누르면 상신하지 않고 작성된 결재 화면만 띄워 확인할 수 있습니다
5. 상신 후 **[결재하러 가기]** → 그룹웨어 미결함에서 **[결재]** 를 눌러야 완료됩니다
   (결재선이 '본인'이라 스스로 승인해야 끝납니다)

문제가 생기면 설정에서 **[작업 중 브라우저 창 보이기]** 를 켜고 다시 실행하면 어느 단계에서 막혔는지 볼 수 있습니다.

---

## 빌드

```bash
cd standalone/overtime
npm install
npm run make:win     # → out/make/zip/win32/x64/OvertimeApproval-win32-x64-1.0.0.zip
npm run make:mac     # → out/make/zip/darwin/arm64/OvertimeApproval-darwin-arm64-1.0.0.zip
```

- **Windows 는 zip 만** 만든다. 설치 프로그램(Squirrel `Setup.exe`)이나 단일 portable exe 는 NSIS/mono·wine 이 필요해 맥에서 바로 만들 수 없다.
- 실행 파일 이름을 영문(`OvertimeApproval.exe`)으로 고정한 이유: 맥에서 만든 zip 의 한글 파일명이 Windows 탐색기에서 깨질 수 있다.
- **macOS 는 자가서명 인증서 `One App Sign` 으로 서명**된다(`forge.config.ts` 의 postPackage 훅).
  adhoc 서명이면 리빌드마다 서명이 바뀌어 `safeStorage` 의 키체인 접근이 끊기고 **저장한 계정이 날아간다**.
  인증서가 없는 맥에서는 서명 없이 통과하므로, 그 경우 리빌드 후 계정 재입력이 필요할 수 있다.
- 맥 산출물을 다른 맥에 전달하면 Gatekeeper 가 막는다 → **우클릭 → 열기**(또는 시스템 설정 → 개인정보 보호 및 보안 → *확인 없이 열기*).

## 개발

```bash
npm start          # 개발 모드 (렌더러만 HMR — main/preload 수정 시 재시작 필요)
npm run typecheck  # tsc --noEmit
```

---

## 구조

```
src/
├── main/
│   ├── main.ts        진입점(창 하나) + 단일 인스턴스 락 · Windows 메뉴바 숨김
│   ├── ipc.ts         계정·기본값·상신 IPC 핸들러
│   ├── config.ts      그룹웨어 URL·셀렉터  ← One App 본체와 같은 내용을 유지
│   ├── browser.ts     자동화 헬퍼 (숨긴 BrowserWindow · evalInPage · waitInPage)
│   ├── submit.ts      로그인 → 양식 대기 → 작성 → 상신 · 결과 판정
│   ├── store.ts       settings.json (safeStorage 암호화) + 마지막 작성 내용
│   └── util.ts        sleep · withTimeout
├── preload/preload.ts window.overtimeApp 노출
├── renderer/          단일 창 UI — 설정 화면 · 상신 폼 · 완료 화면
└── shared/types.ts    공용 타입
```

### One App 본체와의 관계

`config.ts` 의 셀렉터·URL 과 `submit.ts` 의 판정 로직은 본체
`src/main/features/overtime/` 와 **같은 내용을 복사**해 둔 것이다.
그룹웨어 화면이 바뀌면 **양쪽을 함께 수정**해야 한다.

자동화 방식만 다르다.

| | One App 본체 | 이 앱 |
|---|---|---|
| 브라우저 | puppeteer + 시스템 Chrome | Electron 내장 Chromium |
| 페이지 실행 | `page.evaluate` | `evalInPage` (함수를 문자열로 주입) |
| 조건 대기 | `page.waitForFunction` | `waitInPage` (폴링) |
| 계정 | 본체 환경설정 공용 | 이 앱 설정 화면 (별도 저장) |

⚠️ `evalInPage` 로 넘기는 함수는 문자열로 직렬화되므로 **바깥 스코프 변수를 참조할 수 없다** — 필요한 값은 반드시 인자로 넘긴다.
