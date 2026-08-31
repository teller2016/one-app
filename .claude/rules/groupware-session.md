---
paths:
  - "src/main/features/groupware/**"
  - "src/main/features/mail/**"
  - "src/main/features/attendance/**"
  - "src/main/features/weekly/**"
  - "src/main/features/schedule/**"
  - "src/main/features/approval/**"
  - "src/main/lib/groupware.ts"
---

# ⚠️ 그룹웨어 접근은 공용 세션(`features/groupware/session.ts`)을 쓸 것

같은 계정으로 **거의 동시에 로그인하면 서버가 뒤쪽을 거부**해 로그인 페이지로 되돌려보낸다(2026-07-30 실측: 시작 시 메일+근태가 각자 로그인 → 메일 4/4 실패, "계정 정보를 확인하세요" 라는 오해성 메시지. 중복 로그인 확인창은 안 뜨므로 다이얼로그 처리로는 해결 불가). 그래서 **로그인은 1회만 하고 쿠키를 공유**한다.

## ⚠️ 브라우저 자동화는 전부 Electron BrowserWindow 다 (2026-08-10 전환 완료)
`puppeteer` 는 **앱에서 완전히 빠졌다**(devDependency 로만 남아 E2E 검증에 쓴다). 로그인·근태·
일정 등록·주간보고·결재 모두 `main/lib/browser.ts` 의 자동화 창을 쓴다.

- **시스템 Chrome 의존 소멸** — 예전엔 `puppeteer.launch({channel:'chrome'})` 였다.
- 근태 조회가 **0.9초 → 0.2초**(Chrome 기동이 없어짐). 패키지에서 8.4MB 감소.
- ⚠️ **`openPage` 는 열 때 그 파티션의 쿠키를 비운다** — 동시에 돌 수 있는 기능은 파티션을
  달리해야 서로의 세션을 지우지 않는다. `AUTOMATION_PARTITION`(approval/login/attendance/
  schedule/weekly/eaBox/vacationStatus/altLogin)에 목록이 있고, `openPage(show, {partition})` 로 지정한다.

## 사용법
- `getGroupwareSession()` → 쿠키 확보(TTL 20분 캐시, 동시 요청은 하나의 로그인을 공유).
  로그인은 숨긴 BrowserWindow 로 하고 쿠키는 `ses.cookies.get({})` 으로 읽는다(httpOnly 포함).
- `peekGroupwareSession()` → **TTL 검사 없이** 캐시만 본다(재로그인 유발 없음). 폴링류 소비자(메일)가 "세션이 갈렸는지" 신원 비교에 쓴다 — 폴링이 서버를 계속 건드려 서버 세션은 살아 있으므로 TTL 만료만으로 선제 재로그인하면 20분마다 Chrome 이 떴다(2026-08-07 감사). 유효성은 실제 응답(로그인 페이지 → invalidate)으로 판정한다. 메일 세션 수립 실패에는 지수 백오프(1→2→…→15분)가 걸려 있다.
- HTTP 호출은 `session.header`(메일).
- 브라우저가 필요한 기능은 **`gotoWithSessionInWindow(page, url)`** — 쿠키를 자동화 창에 주입해
  **로그인 화면을 건너뛰고** 목표 URL 로 직행하고, 세션이 만료돼 튕기면 **1회 재로그인 후 재시도**한다.
  ⚠️ 대기 조건 인자가 없다 — `goto()` 가 로드 실패를 삼키므로 호출부가 필요한 요소를
  `waitInPage` 로 직접 기다려야 한다(포털은 상시 폴링이라 idle 이 오지 않는다).
- 인증 실패를 감지하면 `invalidateGroupwareSession()`.

## 함정
- ⚠️ 쿠키는 이름이 같고 경로만 다른 `JSESSIONID` **2개**(`gw.forbiz.co.kr` `/gw` + `.forbiz.co.kr` `/`)다 — 합친 문자열이 아니라 **도메인·경로가 붙은 객체 목록이 정본**이고 헤더는 파생값.
- ⚠️ `waitUntil` 기본값은 `networkidle2` 지만 **포털 화면(userMain.do)은 상시 폴링이 있어 idle 판정이 14~20초까지 늘어진다** — 뒤에서 필요한 요소를 직접 기다리는 호출부(근태의 `readInfo`)는 `'domcontentloaded'` 를 넘길 것.
- 참고: 근태 조회가 드물게 20초 이상 걸리는 건 **그룹웨어가 `userMain.do` 응답을 늦게 주는 경우**(단계별 계측으로 goto 구간 확인, 8회 중 1회) — 앱 코드 문제가 아니다.

## 적용 현황 — **모든 기능이 공용 세션을 쓴다** (2026-08-10 완료)
직접 로그인하는 곳은 **`session.ts` 하나뿐**이다. 나머지는 전부 쿠키를 받아 쓴다.

| 기능 | 방식 | 비고 |
|------|------|------|
| 메일 | `session.header` (순수 HTTP) | 로그인 후 브라우저 불필요 |
| 근태 | `gotoWithSessionInWindow` | 조회 4.5초 → 0.7초 → **0.2초** |
| 결재 3종 | `approval/gw.ts` 의 `gotoAsUser()` | 실패 시 폼 로그인 폴백 (아래 ⚠️) |
| 주간보고 | `gotoWithSessionInWindow(portalUrl)` | 6.2초 → **4.7초** |
| 일정 등록 | `gotoWithSessionInWindow(portalUrl)` | 4.0초 → **3.0초** |

- 상단 메뉴(`#topMenu…`)를 클릭해 들어가는 기능(일정 등록·주간보고)은 `GROUPWARE_CONFIG.portalUrl`
  (`bizbox.do` — 로그인 리다이렉트가 도착하는 셸)로 직행한다. 근태는 `mainUrl`(`userMain.do`).
- ⚠️ **결재의 폼 로그인 폴백은 지우지 말 것** — 결재를 단독 앱으로 떼어낼 때의 유일한 탈출구다
  (`features/approval` 규칙 참고). 그 폴백만 `withGroupwareLogin` 큐를 지난다.
- `withGroupwareLogin()` 큐는 이제 **공용 세션 로그인과 결재 폴백** 두 곳만 쓴다 —
  동시 로그인이 사실상 사라졌지만 폴백 경로 보호용으로 남겨 둔다.
- `standalone/` 은 별도 프로세스라 큐·세션이 공유되지 않는다.

계정은 전부 환경설정의 비즈박스 계정 공용이다.
