# 결재 도우미 (단독 배포판)

그룹웨어(gw.forbiz.co.kr) 결재를 대신 작성해 주는 단독 실행 앱. 시작 화면에서 둘 중 하나를 고른다.

| 결재 | 하는 일 |
|------|---------|
| **야근 결재** | 전자결재 연장근무내역서를 작성해 **상신까지** 한다 (결재선이 '본인'이라 미결함에서 스스로 승인) |
| **지출결의서(개인)** | 주차요금·석식대 항목을 **채워만 두고** 화면을 남긴다 — 첨부·결재상신은 사용자가 직접 |

야근 결재는 One App 본체의 `src/main/features/approval`(`overtime.ts`) + `OvertimeModal` 을 **Windows 동료에게 실행 파일로 건네줄 수 있게** 뽑아낸 것이고, 지출결의서는 이 앱에만 있다.

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
   - 소속은 야근 결재 근무자 표의 '소속' 칸에 들어갑니다 (예: `플랫폼서비스사업부문 FE`)

### 야근 결재

4. 날짜·근무시간·업무 대상·수행 내용·사유를 채우고 **[상신하기]**
   - **[미리보기]** 를 누르면 상신하지 않고 작성된 결재 화면만 띄워 확인할 수 있습니다
5. 상신 후 **[결재하러 가기]** → 그룹웨어 미결함에서 **[결재]** 를 눌러야 완료됩니다

### 지출결의서(개인)

4. 대상 월을 고르고, 올릴 항목을 채웁니다
   - **주차요금** — 만원권·5천원권 장수를 넣으면 공급대가가 계산됩니다((만원×10,000 + 5천원×5,000) ÷ 2), 증빙일자는 그 달 말일
   - **석식대** — 날짜·금액을 줄마다 추가 (적요는 `N월 N일 연장근로 석식비` 로 자동)
5. **[작성 시작]** — 항목마다 '찾기' 창이 열리고 닫힙니다. **건드리지 말고 기다리세요.**
   (표준적요·증빙유형·카드는 찾기 창에서 골라야 코드가 채워집니다. 카드는 양식의 사용자 이름으로 자동 검색)
6. 작성이 끝나면 지출결의서 창이 그대로 떠 있습니다 → **첨부파일 등록 후 [결재상신]** → 결재선·참조 지정 화면에서 마무리
   - 앱은 **상신하지 않습니다**. 상신은 그 화면에서 직접 하세요.

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
│   ├── ipc.ts         계정·기본값·야근 상신·지출결의서 IPC 핸들러
│   ├── config.ts      그룹웨어 URL·셀렉터 (GW·OVERTIME·EXPEND)
│   ├── browser.ts     자동화 헬퍼 (BrowserWindow · evalInPage · fireInPage · 팝업 · releasePage)
│   ├── gw.ts          로그인 (야근·지출결의서 공용)
│   ├── submit.ts      야근 결재: 양식 대기 → 작성 → 상신 · 결과 판정
│   ├── expend.ts      지출결의서: 양식 목록 → 팝업 → 항목추가 → 찾기 선택 → 저장
│   ├── keeper.ts      사용자에게 남긴 작업 창 + 숨은 opener 창 관리
│   ├── store.ts       settings.json (safeStorage 암호화) + 마지막 작성 내용
│   └── util.ts        sleep · withTimeout
├── preload/preload.ts window.overtimeApp 노출
├── renderer/
│   ├── App.tsx        셸(뒤로·제목·설정) + 화면 전환
│   ├── views/         PickKind · SettingsForm · OvertimeForm · ExpendForm
│   ├── components/    Button · Input · DatePicker · TimePicker · DoneCard …
│   └── lib/           expendCalc (공급대가·말일·적요 — main 과 같은 규칙)
└── shared/types.ts    공용 타입
```

### ⚠️ 그룹웨어 자동화에서 걸렸던 함정 (2026-07 실측 — 건드리기 전에 읽을 것)

| 증상 | 원인 | 대응 |
|------|------|------|
| 찾기 창을 여는 호출이 안 돌아옴 | `executeJavaScript` 로 **window.open/close 를 실행하면 응답이 오지 않는다** | `fireInPage` — 발화만 하고 창 상태로 판정 |
| 두 번째 찾기부터 멈춤 | 그룹웨어가 창 이름을 재사용(`UserCmmCodePop`) | `patchPopupOpener` 로 매번 새 이름 |
| 찾기 결과가 "없다"고 실패 | 결과 1건이면 창이 스스로 선택·반영하고 닫힘 | 부모의 **코드 칸**으로만 성공 판정 |
| 공급가액·부가세가 0 | 자동계산이 **keyup** 핸들러에 걸려 있음 | 값 설정 후 `keyup` 발화 |
| [결재상신] 후 창만 닫힘 | URL 직접 열기 → `window.opener` 없음 | **양식 목록에서 클릭**해 팝업으로 열기 |
| 결재선 창이 떴다가 사라짐 | 그 창을 열고 `self.close()` 하는데, Electron 자식 창의 `outlivesOpener` 기본값이 false | `attachOpenerChain` — 체인 전체에 `outlivesOpener: true` |
| 작업 창이 안 닫힘 | 페이지 이탈 가드 + 팝업의 `disableDialogs` | `will-prevent-unload` 처리, `disableDialogs` 사용 금지 |
| 사용자가 누른 확인창이 저절로 승낙됨 | 자동화용 `confirm→true` 가 남아 있었음 | 작업 완료 시 `releasePage` 로 원복 |

### One App 본체와의 관계

`config.ts` 의 셀렉터·URL 과 `submit.ts` 의 판정 로직은 본체
`src/main/features/approval/` 와 **같은 내용을 복사**해 둔 것이다.
그룹웨어 화면이 바뀌면 **양쪽을 함께 수정**해야 한다.

⚠️ **자동화 방식은 양쪽이 같다.** 본체가 puppeteer 를 쓰던 시절에는 이 앱만
`BrowserWindow` 를 썼지만, 본체도 같은 방식으로 전환했다(`main/lib/browser.ts`).
`evalInPage`·`waitInPage`·팝업 처리의 함정은 양쪽에 똑같이 적용된다.

| | One App 본체 | 이 앱 |
|---|---|---|
| 브라우저 자동화 | `main/lib/browser.ts` | 같은 방식, 코드만 별도 복사 (`src/main/browser.ts`) |
| 로그인 | 공용 세션 `groupware/session.ts` | 자체 `gw.ts` 의 `login()` |
| 계정 | 본체 환경설정 공용 | 이 앱 설정 화면 (별도 저장) |

⚠️ **야근 결재의 동작은 양쪽이 다르다 — 의도된 차이다.**

| | One App 본체 | 이 앱 |
|---|---|---|
| 야근 결재 마무리 | 작성만 하고 **창을 사용자에게 넘긴다**<br>([상신]은 사용자가 직접) | **[상신]까지 자동으로 누른다**<br>(`#hidDocID` 새 문서 id 로 성공 판정) |
| 지출결의서 마무리 | 작성만 (첨부·상신은 사용자) | 작성만 (첨부·상신은 사용자) — 같음 |

본체는 눈으로 확인하고 올리는 흐름이고(`approval/overtime.ts:214`), 이 앱은 폼 하나만
있는 단독 앱이라 상신까지 끝낸다. **한쪽 방침을 다른 쪽에 옮기지 말 것.**

**동기화할 때 볼 것** — 본체가 먼저 정리하고 이 앱이 따라가지 못한 것들이다.
같은 버그를 두 번 고치지 않으려면 알고 있어야 한다.

- 날짜·표기 유틸: 본체는 `shared/date.ts`·`shared/approval-format.ts` 로 통합했고,
  이 앱은 `submit.ts`·`expend.ts`·`expendCalc.ts`·`OvertimeForm.tsx` 안에 같은 계산을
  복사해 두고 있다. 실제로 **드리프트가 났던 곳이다** — 본체 `formatHoursTotal` 의
  `start === end` 가드가 이 앱 `submit.ts` 에만 빠져 있어 시작=종료일 때
  '0시간' 이 기입됐다(2026-08-26 수정). 본체 파일을 고치면 이 4곳을 함께 확인할 것
- 셀렉터·URL: 본체는 `EXPEND_CONFIG` 로 뺐고, 이 앱은 일부가 호출부에 하드코딩돼 있다
- 본체에만 있는 기능(휴가신청서·결재 홈·상신함 열기)은 이 앱에 없다 — 옮길 대상이 아니다

⚠️ `evalInPage` 로 넘기는 함수는 문자열로 직렬화되므로 **바깥 스코프 변수를 참조할 수 없다** — 필요한 값은 반드시 인자로 넘긴다.
